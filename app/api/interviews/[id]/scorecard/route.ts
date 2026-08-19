import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  scores: z.record(z.string().max(120), z.number().min(0).max(5)),
  overallScore: z.number().min(0).max(5),
  recommendation: z.enum(["strong_hire", "hire", "mixed", "no_hire", "strong_no_hire"]),
  evidence: z.string().trim().min(10).max(6000),
  risks: z.string().trim().max(4000).default(""),
  dissent: z.string().trim().max(4000).default(""),
  submit: z.boolean().default(false),
  expectedVersion: z.number().int().positive().optional()
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "scorecards:submit");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const interview = await client.query<{ id: string }>(
        `select interviews.id from interviews
         left join interview_participants participants on participants.interview_id=interviews.id and participants.user_id=$3
         where interviews.id=$1 and interviews.organization_id=$2
           and (participants.user_id is not null or $4::boolean)`,
        [id, context.organization.id, context.user.id, ["owner", "admin", "founder", "recruiter"].includes(context.role)]
      );
      if (!interview.rows[0]) throw new AtsError("You are not assigned to this interview", 403, "NOT_ASSIGNED");
      const existing = await client.query<{ state: string; version: number }>(
        "select state, version from scorecards where interview_id=$1 and interviewer_user_id=$2 for update",
        [id, context.user.id]
      );
      if (existing.rows[0]?.state === "submitted") throw new AtsError("Submitted feedback is locked", 409, "SCORECARD_LOCKED");
      if (existing.rows[0] && payload.expectedVersion && existing.rows[0].version !== payload.expectedVersion) {
        throw new AtsError("Scorecard changed since you opened it", 409, "STALE_VERSION");
      }
      const scorecard = await client.query<{ id: string; version: number; state: string }>(
        `insert into scorecards (interview_id, interviewer_user_id, scores, overall_score, recommendation, evidence, risks, dissent, state, submitted_at)
         values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,case when $9='submitted' then now() else null end)
         on conflict (interview_id, interviewer_user_id) do update set scores=excluded.scores,
           overall_score=excluded.overall_score, recommendation=excluded.recommendation, evidence=excluded.evidence,
           risks=excluded.risks, dissent=excluded.dissent, state=excluded.state, submitted_at=excluded.submitted_at,
           version=scorecards.version+1, updated_at=now()
         returning id, version, state`,
        [id, context.user.id, JSON.stringify(payload.scores), payload.overallScore, payload.recommendation,
          payload.evidence, payload.risks, payload.dissent, payload.submit ? "submitted" : "draft"]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "interview", aggregateId: id,
        eventType: payload.submit ? "scorecard.submitted" : "scorecard.saved", actorUserId: context.user.id,
        data: { scorecard_id: scorecard.rows[0].id }
      });
      return { ...scorecard.rows[0], eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to save scorecard");
  }
}
