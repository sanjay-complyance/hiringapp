import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({ jobId: databaseId, provider: z.enum(["openai", "anthropic"]), applicationIds: z.array(databaseId).max(200).optional() });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "ai:use");
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const connection = await client.query("select id from ai_connections where organization_id=$1 and provider=$2 and status='active'", [context.organization.id, payload.provider]);
      if (!connection.rowCount) throw new AtsError("Selected AI provider is not connected", 409, "PROVIDER_NOT_CONNECTED");
      const batch = await client.query<{ id: string }>(
        `insert into agent_batches (organization_id, job_id, provider, created_by) values ($1,$2,$3,$4) returning id`,
        [context.organization.id, payload.jobId, payload.provider, context.user.id]
      );
      const applications = await client.query<{ id: string }>(
        `select id from applications where organization_id=$1 and job_id=$2 and state in ('active','on_hold')
          and ($3::uuid[] is null or id=any($3::uuid[])) order by created_at`,
        [context.organization.id, payload.jobId, payload.applicationIds?.length ? payload.applicationIds : null]
      );
      if (!applications.rows.length) throw new AtsError("No eligible applications were selected", 400, "EMPTY_BATCH");
      for (const application of applications.rows) {
        await client.query("insert into agent_batch_items (batch_id, application_id) values ($1,$2)", [batch.rows[0].id, application.id]);
      }
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "agent_batch", aggregateId: batch.rows[0].id,
        eventType: "agent.batch_created", actorUserId: context.user.id,
        data: { job_id: payload.jobId, provider: payload.provider, count: applications.rows.length }
      });
      return { id: batch.rows[0].id, count: applications.rows.length, eventId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to create AI batch");
  }
}
