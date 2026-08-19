import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  stageId: databaseId,
  title: z.string().trim().min(2).max(200),
  kind: z.enum(["phone", "video", "onsite", "assessment"]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional().nullable(),
  meetingUrl: z.string().url().max(1000).optional().nullable(),
  location: z.string().trim().max(300).optional().nullable(),
  participantUserIds: z.array(databaseId).min(1).max(12),
  competencyAssignments: z.array(z.object({ competency: z.string().max(160), userId: databaseId })).max(30).default([])
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "interviews:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const application = await client.query<{ job_id: string }>(
        "select job_id from applications where id=$1 and organization_id=$2",
        [id, context.organization.id]
      );
      if (!application.rows[0]) throw new AtsError("Application not found", 404, "NOT_FOUND");
      const stage = await client.query<{ id: string }>("select id from job_stages where id=$1 and job_id=$2", [payload.stageId, application.rows[0].job_id]);
      if (!stage.rows[0]) throw new AtsError("Interview stage not found", 404, "STAGE_NOT_FOUND");
      const members = await client.query<{ user_id: string }>(
        "select user_id from organization_memberships where organization_id=$1 and active=true and user_id=any($2::uuid[])",
        [context.organization.id, payload.participantUserIds]
      );
      if (members.rowCount !== new Set(payload.participantUserIds).size) throw new AtsError("Every interviewer must be an active member", 400, "INVALID_PARTICIPANT");
      const interview = await client.query<{ id: string }>(
        `insert into interviews (organization_id, application_id, stage_id, title, kind, status, starts_at, ends_at,
          meeting_url, location, organizer_user_id, competency_assignments)
         values ($1,$2,$3,$4,$5,'scheduled',$6,$7,$8,$9,$10,$11::jsonb) returning id`,
        [context.organization.id, id, payload.stageId, payload.title, payload.kind, payload.startsAt,
          payload.endsAt || null, payload.meetingUrl || null, payload.location || null, context.user.id,
          JSON.stringify(payload.competencyAssignments)]
      );
      for (const userId of new Set(payload.participantUserIds)) {
        await client.query("insert into interview_participants (interview_id, user_id) values ($1,$2)", [interview.rows[0].id, userId]);
      }
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "interview", aggregateId: interview.rows[0].id,
        eventType: "interview.scheduled", actorUserId: context.user.id,
        data: { application_id: id, starts_at: payload.startsAt, kind: payload.kind }
      });
      return { id: interview.rows[0].id, eventId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to schedule interview");
  }
}
