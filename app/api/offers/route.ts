import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  applicationId: databaseId,
  compensation: z.number().positive(),
  currency: z.string().trim().length(3).default("INR"),
  proposedStartDate: z.string().date().optional().nullable(),
  conditions: z.string().trim().max(4000).default("")
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "offers:manage");
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const application = await client.query<{
        state: string; current_stage_id: string | null; position: number | null; kind: string | null;
        required_scorecards: number; max_position: number;
      }>(
        `select applications.state, applications.current_stage_id, stages.position, stages.kind,
          coalesce(stages.required_scorecards,0) as required_scorecards,
          coalesce((select max(position) from job_stages where job_id=applications.job_id and archived_at is null),0) as max_position
         from applications left join job_stages stages on stages.id=applications.current_stage_id
         where applications.id=$1 and applications.organization_id=$2 for update of applications`,
        [payload.applicationId, context.organization.id]
      );
      const app = application.rows[0];
      if (!app) throw new AtsError("Application not found", 404, "NOT_FOUND");
      if (!['active', 'on_hold'].includes(app.state)) throw new AtsError("Offers require an active application", 409, "INVALID_APPLICATION_STATE");
      if (app.kind !== "offer" && app.position !== app.max_position) {
        throw new AtsError("Move the application to its final pipeline stage before drafting an offer", 409, "FINAL_STAGE_REQUIRED");
      }
      if (app.required_scorecards > 0) {
        const feedback = await client.query<{ count: number }>(
          `select count(distinct scorecards.id)::int as count from interviews
           join scorecards on scorecards.interview_id=interviews.id and scorecards.state='submitted'
           where interviews.application_id=$1 and interviews.stage_id=$2`,
          [payload.applicationId, app.current_stage_id]
        );
        if ((feedback.rows[0]?.count ?? 0) < app.required_scorecards) {
          throw new AtsError("Required final-round feedback is incomplete", 409, "STAGE_GATE_BLOCKED");
        }
      }
      const existing = await client.query(
        "select id from offers where application_id=$1 and status not in ('declined','withdrawn')",
        [payload.applicationId]
      );
      if (existing.rowCount) throw new AtsError("This application already has an active offer", 409, "OFFER_EXISTS");
      const inserted = await client.query<{ id: string; version: number }>(
        `insert into offers (organization_id, application_id, compensation, currency, proposed_start_date, conditions, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id, version`,
        [context.organization.id, payload.applicationId, payload.compensation, payload.currency.toUpperCase(),
          payload.proposedStartDate || null, payload.conditions, context.user.id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "offer", aggregateId: inserted.rows[0].id,
        eventType: "offer.created", actorUserId: context.user.id,
        data: { application_id: payload.applicationId }
      });
      return { ...inserted.rows[0], eventId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to create offer");
  }
}
