import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, hasPermission, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { missingHrScreenFields } from "@/lib/ats/workflow";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["move", "hold", "reject", "withdraw", "hire", "reactivate"]),
  targetStageId: databaseId.optional().nullable(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(2000).optional(),
  evidence: z.string().trim().max(4000).optional(),
  risks: z.string().trim().max(3000).optional(),
  dissent: z.string().trim().max(3000).optional(),
  overrideReason: z.string().trim().max(1000).optional()
});

function legacyStatus(state: string, stageKey: string | null) {
  if (state === "rejected" || state === "withdrawn") return "no_hire";
  if (state === "hired") return "hire";
  if (state === "on_hold") return "hold";
  if (stageKey === "hr_screen") return "round1";
  if (stageKey === "technical_decision") return "round2";
  if (stageKey === "final_panel") return "round3";
  return "new";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "applications:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    if (["reject", "withdraw"].includes(payload.action) && !payload.reason) {
      throw new AtsError("A decision reason is required", 400, "REASON_REQUIRED");
    }
    if (payload.action === "hire" && !payload.evidence) {
      throw new AtsError("Decision evidence is required to hire", 400, "EVIDENCE_REQUIRED");
    }

    const result = await withTransaction(async (client) => {
      const current = await client.query<{
        id: string; candidate_id: string; job_id: string; state: string; version: number;
        current_stage_id: string | null; current_position: number | null; current_key: string | null;
        required_scorecards: number;
        consent_status: string; availability_date: string | null; notice_period_days: number | null;
        work_mode_preference: string | null; expected_compensation: string | null;
        screening_suitability: string | null; role_interest: string | null; location_confirmed: boolean | null;
      }>(
        `select applications.id, applications.candidate_id, applications.job_id, applications.state, applications.version,
          applications.current_stage_id, stages.position as current_position, stages.stage_key as current_key,
          coalesce(stages.required_scorecards, 0) as required_scorecards,
          applications.consent_status, applications.availability_date::text, applications.notice_period_days,
          applications.work_mode_preference, applications.expected_compensation::text,
          applications.screening_suitability, applications.role_interest, applications.location_confirmed
         from applications left join job_stages stages on stages.id = applications.current_stage_id
         where applications.id=$1 and applications.organization_id=$2 for update of applications`,
        [id, context.organization.id]
      );
      const row = current.rows[0];
      if (!row) throw new AtsError("Application not found", 404, "NOT_FOUND");
      if (row.version !== payload.expectedVersion) throw new AtsError("Application changed since you opened it", 409, "STALE_VERSION");

      let nextState = row.state;
      let nextStageId = row.current_stage_id;
      let nextStageKey = row.current_key;
      let decision = false;

      if (payload.action === "move" || payload.action === "reactivate") {
        if (!payload.targetStageId) throw new AtsError("A destination stage is required", 400, "STAGE_REQUIRED");
        const target = await client.query<{ id: string; stage_key: string; position: number }>(
          "select id, stage_key, position from job_stages where id=$1 and job_id=$2 and archived_at is null",
          [payload.targetStageId, row.job_id]
        );
        if (!target.rows[0]) throw new AtsError("Destination stage not found", 404, "STAGE_NOT_FOUND");
        const movingForward = row.current_position != null && target.rows[0].position > row.current_position;
        if (movingForward && row.current_key === "hr_screen") {
          const missing = missingHrScreenFields(row);
          if (missing.length && (!payload.overrideReason || !hasPermission(context.role, "scorecards:reopen"))) {
            throw new AtsError(`Complete HR screening fields: ${missing.join(", ")}`, 409, "REQUIRED_FIELDS_MISSING");
          }
        }
        if (movingForward && row.required_scorecards > 0) {
          const submitted = await client.query<{ count: number }>(
            `select count(distinct scorecards.id)::int as count from interviews
             join scorecards on scorecards.interview_id = interviews.id and scorecards.state = 'submitted'
             where interviews.application_id=$1 and interviews.stage_id=$2`,
            [id, row.current_stage_id]
          );
          if ((submitted.rows[0]?.count ?? 0) < row.required_scorecards) {
            if (!payload.overrideReason || !hasPermission(context.role, "scorecards:reopen")) {
              throw new AtsError("Required interview feedback is incomplete", 409, "STAGE_GATE_BLOCKED");
            }
          }
        }
        nextState = "active";
        nextStageId = target.rows[0].id;
        nextStageKey = target.rows[0].stage_key;
      } else if (payload.action === "hold") {
        nextState = "on_hold";
      } else if (payload.action === "reject") {
        nextState = "rejected";
        decision = true;
      } else if (payload.action === "withdraw") {
        nextState = "withdrawn";
        decision = true;
      } else if (payload.action === "hire") {
        nextState = "hired";
        decision = true;
      }

      const updated = await client.query<{ version: number }>(
        `update applications set state=$1, current_stage_id=$2,
          stage_entered_at=case when current_stage_id is distinct from $2 then now() else stage_entered_at end,
          rejection_reason=case when $1='rejected' then $3 else rejection_reason end,
          withdrawal_reason=case when $1='withdrawn' then $3 else withdrawal_reason end,
          decided_at=case when $1 in ('rejected','withdrawn','hired') then now() else null end,
          version=version+1, updated_at=now() where id=$4 returning version`,
        [nextState, nextStageId, payload.reason ?? null, id]
      );
      await client.query("update candidates set status=$1, version=version+1, updated_at=now() where id=$2", [legacyStatus(nextState, nextStageKey), row.candidate_id]);
      if (decision) {
        await client.query(
          `insert into debriefs (application_id, outcome, evidence, risks, dissent, decision_user_id)
           values ($1,$2,$3,$4,$5,$6)`,
          [id, payload.action === "hire" ? "hire" : "reject", payload.evidence || payload.reason || "Decision recorded",
            payload.risks || "", payload.dissent || "", context.user.id]
        );
      }
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "application", aggregateId: id,
        eventType: `application.${payload.action}`, actorUserId: context.user.id,
        data: {
          from_state: row.state, to_state: nextState, from_stage: row.current_stage_id, to_stage: nextStageId,
          reason: payload.reason ?? null, override_reason: payload.overrideReason ?? null
        }
      });
      return { state: nextState, stageId: nextStageId, version: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to move application");
  }
}
