import { NextResponse } from "next/server";
import { z } from "zod";
import { agentProposalSchema } from "@/lib/ats/agent";
import { assertSameOrigin, AtsError, hasPermission, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { missingHrScreenFields } from "@/lib/ats/workflow";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1500).optional(),
  overrideReason: z.string().trim().max(1000).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "ai:use");
    const { id } = await params;
    const review = reviewSchema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const proposalResult = await client.query<{
        id: string; application_id: string | null; kind: string; payload: unknown; base_version: number | null; status: string;
      }>(
        "select id, application_id, kind, payload, base_version, status from agent_proposals where id=$1 and organization_id=$2 for update",
        [id, context.organization.id]
      );
      const proposalRow = proposalResult.rows[0];
      if (!proposalRow) throw new AtsError("Proposal not found", 404, "NOT_FOUND");
      if (proposalRow.status !== "pending") throw new AtsError("Proposal has already been reviewed", 409, "ALREADY_REVIEWED");
      if (review.action === "reject") {
        await client.query("update agent_proposals set status='rejected', reviewed_by=$1, reviewed_at=now() where id=$2", [context.user.id, id]);
        const eventId = await recordEvent(client, {
          organizationId: context.organization.id, aggregateType: "agent_proposal", aggregateId: id,
          eventType: "agent.proposal_rejected", actorUserId: context.user.id, data: { note: review.note ?? null }
        });
        return { status: "rejected", eventId };
      }

      const proposal = agentProposalSchema.shape.proposals.element.parse(proposalRow.payload);
      if (!proposalRow.application_id) throw new AtsError("Proposal has no application context", 409, "CONTEXT_MISSING");
      const application = await client.query<{
        id: string; candidate_id: string; job_id: string; version: number; current_stage_id: string | null;
        consent_status: string; availability_date: string | null; notice_period_days: number | null;
        work_mode_preference: string | null; expected_compensation: string | null;
        screening_suitability: string | null; role_interest: string | null; location_confirmed: boolean | null;
      }>(
        `select id, candidate_id, job_id, version, current_stage_id, consent_status, availability_date::text,
          notice_period_days, work_mode_preference, expected_compensation::text, screening_suitability,
          role_interest, location_confirmed
         from applications where id=$1 and organization_id=$2 for update`,
        [proposalRow.application_id, context.organization.id]
      );
      const app = application.rows[0];
      if (!app) throw new AtsError("Application no longer exists", 409, "CONTEXT_MISSING");
      if (proposalRow.base_version !== null && app.version !== proposalRow.base_version) {
        throw new AtsError("Application changed after this proposal was generated", 409, "STALE_PROPOSAL");
      }

      if (proposal.kind === "task") {
        if (!hasPermission(context.role, "tasks:manage") || !proposal.task) throw new AtsError("Task proposal is incomplete or not permitted", 403, "FORBIDDEN");
        await client.query(
          `insert into hiring_tasks (organization_id, application_id, job_id, assigned_user_id, title, description, due_at, created_by)
           values ($1,$2,$3,$4,$5,$6,now() + make_interval(days => $7),$4)`,
          [context.organization.id, app.id, app.job_id, context.user.id, proposal.task.title, proposal.task.description, proposal.task.dueInDays]
        );
      } else if (proposal.kind === "evaluation") {
        if (!hasPermission(context.role, "applications:manage") || !proposal.evaluation) throw new AtsError("Evaluation proposal is incomplete or not permitted", 403, "FORBIDDEN");
        const rubric = await client.query<{ id: string }>("select id from rubric_versions where job_id=$1 and is_active=true order by version_number desc limit 1", [app.job_id]);
        if (!rubric.rows[0]) throw new AtsError("Active rubric is missing", 409, "RUBRIC_MISSING");
        await client.query(
          `insert into evaluations (application_id, rubric_version_id, source, provider, prompt_version, score, max_score,
            eligibility, evidence, gaps, created_by)
           select $1,$2,'ai',runs.provider,runs.prompt_version,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8
           from agent_proposals proposals join agent_runs runs on runs.id=proposals.run_id where proposals.id=$9`,
          [app.id, rubric.rows[0].id, proposal.evaluation.score, proposal.evaluation.maxScore,
            JSON.stringify(proposal.evaluation.eligibility), JSON.stringify(proposal.evaluation.criteria),
            JSON.stringify(proposal.evaluation.gaps), context.user.id, id]
        );
      } else if (proposal.kind === "stage_change") {
        if (!hasPermission(context.role, "applications:manage") || !proposal.recommendedStageKey) throw new AtsError("Stage proposal is incomplete or not permitted", 403, "FORBIDDEN");
        const [target, current] = await Promise.all([
          client.query<{ id: string; position: number }>("select id, position from job_stages where job_id=$1 and stage_key=$2 and archived_at is null", [app.job_id, proposal.recommendedStageKey]),
          client.query<{ position: number; required_scorecards: number; stage_key: string }>("select position, required_scorecards, stage_key from job_stages where id=$1", [app.current_stage_id])
        ]);
        if (!target.rows[0]) throw new AtsError("Suggested stage no longer exists", 409, "STAGE_MISSING");
        const movingForward = current.rows[0] && target.rows[0].position > current.rows[0].position;
        if (movingForward && current.rows[0].stage_key === "hr_screen") {
          const missing = missingHrScreenFields(app);
          if (missing.length && (!review.overrideReason || !hasPermission(context.role, "scorecards:reopen"))) {
            throw new AtsError(`Complete HR screening fields: ${missing.join(", ")}`, 409, "REQUIRED_FIELDS_MISSING");
          }
        }
        if (movingForward && current.rows[0].required_scorecards > 0) {
          const scores = await client.query<{ count: number }>(
            `select count(*)::int as count from scorecards join interviews on interviews.id=scorecards.interview_id
             where interviews.application_id=$1 and interviews.stage_id=$2 and scorecards.state='submitted'`,
            [app.id, app.current_stage_id]
          );
          if ((scores.rows[0]?.count ?? 0) < current.rows[0].required_scorecards &&
              (!review.overrideReason || !hasPermission(context.role, "scorecards:reopen"))) {
            throw new AtsError("Required feedback is incomplete", 409, "STAGE_GATE_BLOCKED");
          }
        }
        await client.query(
          "update applications set state='active', current_stage_id=$1, stage_entered_at=now(), version=version+1, updated_at=now() where id=$2",
          [target.rows[0].id, app.id]
        );
      } else if (proposal.kind === "rubric_change") {
        if (!hasPermission(context.role, "jobs:manage") || !proposal.rubric) throw new AtsError("Rubric proposal is incomplete or not permitted", 403, "FORBIDDEN");
        if (proposal.rubric.criteria.some((criterion) => !criterion.hard && criterion.max <= 0) ||
            new Set(proposal.rubric.criteria.map((criterion) => criterion.id)).size !== proposal.rubric.criteria.length) {
          throw new AtsError("Rubric criteria are invalid", 400, "INVALID_RUBRIC");
        }
        await client.query("update rubric_versions set is_active=false where job_id=$1 and is_active=true", [app.job_id]);
        await client.query(
          `insert into rubric_versions (job_id, version_number, name, criteria, created_by)
           select $1, coalesce(max(version_number),0)+1, $2, $3::jsonb, $4 from rubric_versions where job_id=$1`,
          [app.job_id, proposal.title, JSON.stringify(proposal.rubric.criteria), context.user.id]
        );
      }

      await client.query("update agent_proposals set status='approved', reviewed_by=$1, reviewed_at=now() where id=$2", [context.user.id, id]);
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "application", aggregateId: app.id,
        eventType: "agent.proposal_approved", actorUserId: context.user.id,
        data: { proposal_id: id, kind: proposal.kind, override_reason: review.overrideReason ?? null }
      });
      return { status: "approved", eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to review proposal");
  }
}
