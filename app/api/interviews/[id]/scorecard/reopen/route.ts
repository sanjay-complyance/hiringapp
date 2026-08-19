import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({ interviewerUserId: databaseId, reason: z.string().trim().min(5).max(1000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "scorecards:reopen");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const updated = await client.query<{ id: string; version: number }>(
        `update scorecards set state='draft', submitted_at=null, reopened_by=$1, reopened_reason=$2,
          version=version+1, updated_at=now()
         where interview_id=$3 and interviewer_user_id=$4 and state='submitted'
           and interview_id in (select id from interviews where organization_id=$5)
         returning id, version`,
        [context.user.id, payload.reason, id, payload.interviewerUserId, context.organization.id]
      );
      if (!updated.rows[0]) throw new AtsError("Submitted scorecard not found", 404, "NOT_FOUND");
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "interview", aggregateId: id,
        eventType: "scorecard.reopened", actorUserId: context.user.id,
        data: { scorecard_id: updated.rows[0].id, reason: payload.reason }
      });
      return { ...updated.rows[0], eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to reopen scorecard");
  }
}
