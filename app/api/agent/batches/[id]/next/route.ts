import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  completion: z.object({ applicationId: databaseId, runId: databaseId.nullable(), succeeded: z.boolean(), errorCode: z.string().max(100).nullable() }).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "ai:use");
    const { id } = await params;
    const payload = schema.parse(await request.json().catch(() => ({})));
    const result = await withTransaction(async (client) => {
      const batch = await client.query<{ provider: "openai" | "anthropic"; status: string; created_by: string }>(
        "select provider, status, created_by from agent_batches where id=$1 and organization_id=$2 for update",
        [id, context.organization.id]
      );
      if (!batch.rows[0]) throw new AtsError("Batch not found", 404, "NOT_FOUND");
      if (batch.rows[0].created_by !== context.user.id && !["owner", "admin"].includes(context.role)) {
        throw new AtsError("Only the batch owner can resume it", 403, "FORBIDDEN");
      }
      if (payload.completion) {
        await client.query(
          `update agent_batch_items set status=$1, run_id=$2, error_code=$3, updated_at=now()
           where batch_id=$4 and application_id=$5 and status='running'`,
          [payload.completion.succeeded ? "completed" : "failed", payload.completion.runId,
            payload.completion.errorCode, id, payload.completion.applicationId]
        );
      }
      await client.query(
        "update agent_batch_items set status='queued', updated_at=now() where batch_id=$1 and status='running' and updated_at < now() - interval '10 minutes'",
        [id]
      );
      const next = await client.query<{ application_id: string }>(
        `select application_id from agent_batch_items where batch_id=$1 and status='queued'
         order by updated_at for update skip locked limit 1`,
        [id]
      );
      if (next.rows[0]) {
        await client.query(
          "update agent_batch_items set status='running', attempts=attempts+1, updated_at=now() where batch_id=$1 and application_id=$2",
          [id, next.rows[0].application_id]
        );
        await client.query("update agent_batches set status='running', updated_at=now() where id=$1", [id]);
      } else {
        const counts = await client.query<{ pending: number; failed: number }>(
          `select count(*) filter (where status in ('queued','running'))::int as pending,
            count(*) filter (where status='failed')::int as failed from agent_batch_items where batch_id=$1`, [id]
        );
        if ((counts.rows[0]?.pending ?? 0) === 0) {
          await client.query("update agent_batches set status=$1, updated_at=now() where id=$2", [counts.rows[0]?.failed ? "failed" : "completed", id]);
          await recordEvent(client, {
            organizationId: context.organization.id, aggregateType: "agent_batch", aggregateId: id,
            eventType: "agent.batch_finished", actorUserId: context.user.id,
            data: { failed: counts.rows[0]?.failed ?? 0 }
          });
        }
      }
      return { applicationId: next.rows[0]?.application_id ?? null, provider: batch.rows[0].provider, done: !next.rows[0] };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to continue AI batch");
  }
}
