import { NextResponse } from "next/server";
import { z } from "zod";
import { recruitingAgent, recruitingSystemPrompt } from "@/lib/ats/agent";
import { loadAgentContext } from "@/lib/ats/agent-context";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { decryptCredential } from "@/lib/ats/crypto";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

const schema = z.object({
  applicationId: databaseId,
  provider: z.enum(["openai", "anthropic"]),
  request: z.string().trim().min(3).max(6000),
  threadId: databaseId.optional().nullable()
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireApiContext(request, "ai:use");
    const payload = schema.parse(await request.json());
    const [connection, usage] = await Promise.all([
      query<{ id: string; encrypted_key: string; model: string }>(
        "select id, encrypted_key, model from ai_connections where organization_id=$1 and provider=$2 and status='active'",
        [member.organization.id, payload.provider]
      ),
      query<{ tokens: string }>(
        `select coalesce(sum(input_tokens + output_tokens),0)::text as tokens from agent_runs
         where organization_id=$1 and created_at >= date_trunc('month', now()) and status='completed'`,
        [member.organization.id]
      )
    ]);
    if (!connection.rows[0]) throw new AtsError(`${payload.provider === "openai" ? "OpenAI" : "Claude"} is not connected`, 409, "PROVIDER_NOT_CONNECTED");
    if (Number(usage.rows[0]?.tokens ?? 0) >= member.organization.ai_monthly_token_limit) {
      throw new AtsError("The monthly AI usage limit has been reached", 429, "AI_BUDGET_REACHED");
    }
    const context = await loadAgentContext(member.organization.id, payload.applicationId);
    let threadId = payload.threadId;
    if (threadId) {
      const thread = await query("select id from agent_threads where id=$1 and organization_id=$2 and owner_user_id=$3", [threadId, member.organization.id, member.user.id]);
      if (!thread.rowCount) throw new AtsError("Private thread not found", 404, "THREAD_NOT_FOUND");
    } else {
      const thread = await query<{ id: string }>(
        `insert into agent_threads (organization_id, owner_user_id, application_id, job_id, title)
         values ($1,$2,$3,$4,$5) returning id`,
        [member.organization.id, member.user.id, payload.applicationId, context.application.job.id, `Review ${context.application.candidate.name}`]
      );
      threadId = thread.rows[0].id;
    }
    const run = await query<{ id: string }>(
      `insert into agent_runs (organization_id, thread_id, application_id, provider, model, prompt_version, created_by)
       values ($1,$2,$3,$4,$5,'recruiting-v1',$6) returning id`,
      [member.organization.id, threadId, payload.applicationId, payload.provider, connection.rows[0].model, member.user.id]
    );
    await query("insert into agent_messages (thread_id, role, body) values ($1,'user',$2)", [threadId, payload.request]);

    let providerResult;
    try {
      providerResult = await recruitingAgent(payload.provider).run({
        apiKey: decryptCredential(connection.rows[0].encrypted_key),
        model: connection.rows[0].model,
        system: recruitingSystemPrompt,
        prompt: `Recruiter request:\n${payload.request}\n\nRead-only hiring context:\n${JSON.stringify(context)}`
      });
    } catch {
      await query("update agent_runs set status='failed', error_code='PROVIDER_REQUEST_FAILED', completed_at=now() where id=$1", [run.rows[0].id]);
      throw new AtsError("The AI provider could not complete this request", 502, "PROVIDER_REQUEST_FAILED");
    }

    const saved = await withTransaction(async (client) => {
      await client.query(
        `update agent_runs set status='completed', input_tokens=$1, output_tokens=$2, provider_request_id=$3, completed_at=now() where id=$4`,
        [providerResult.inputTokens, providerResult.outputTokens, providerResult.requestId, run.rows[0].id]
      );
      await client.query("insert into agent_messages (thread_id, role, body) values ($1,'assistant',$2)", [threadId, providerResult.output.answer]);
      const proposalIds: string[] = [];
      for (const proposal of providerResult.output.proposals) {
        const inserted = await client.query<{ id: string }>(
          `insert into agent_proposals (organization_id, run_id, application_id, kind, title, payload, evidence, base_version)
           values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) returning id`,
          [member.organization.id, run.rows[0].id, payload.applicationId, proposal.kind, proposal.title,
            JSON.stringify(proposal), JSON.stringify(proposal.evidence), context.application.version]
        );
        proposalIds.push(inserted.rows[0].id);
      }
      const eventId = await recordEvent(client, {
        organizationId: member.organization.id, aggregateType: "application", aggregateId: payload.applicationId,
        eventType: "agent.proposals_created", actorUserId: member.user.id,
        data: { run_id: run.rows[0].id, proposal_count: proposalIds.length, provider: payload.provider }
      });
      return { proposalIds, eventId };
    });
    return NextResponse.json({
      threadId,
      runId: run.rows[0].id,
      answer: providerResult.output.answer,
      proposals: providerResult.output.proposals.map((proposal, index) => ({ ...proposal, id: saved.proposalIds[index], status: "pending" })),
      usage: { inputTokens: providerResult.inputTokens, outputTokens: providerResult.outputTokens }
    });
  } catch (error) {
    return jsonFromError(error, "Unable to run recruiting copilot");
  }
}
