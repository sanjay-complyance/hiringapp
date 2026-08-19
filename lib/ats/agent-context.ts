import { AtsError } from "@/lib/ats/authz";
import { redactCandidateProfile, redactResume } from "@/lib/ats/agent";
import { query } from "@/lib/db";

export async function loadAgentContext(organizationId: string, applicationId: string) {
  const application = await query<{
    id: string; version: number; state: string; candidate_id: string; candidate_name: string;
    profile: Record<string, unknown>; job_id: string; job_title: string; business_reason: string;
    stage_name: string | null; rubric_id: string; rubric_name: string; criteria: unknown;
  }>(
    `select applications.id, applications.version, applications.state, candidates.id as candidate_id,
      candidates.name as candidate_name, candidates.profile, jobs.id as job_id, jobs.title as job_title,
      jobs.business_reason, stages.name as stage_name, rubric.id as rubric_id, rubric.name as rubric_name, rubric.criteria
     from applications join candidates on candidates.id=applications.candidate_id
     join jobs on jobs.id=applications.job_id left join job_stages stages on stages.id=applications.current_stage_id
     join lateral (select * from rubric_versions where job_id=jobs.id and is_active=true order by version_number desc limit 1) rubric on true
     where applications.id=$1 and applications.organization_id=$2`,
    [applicationId, organizationId]
  );
  const row = application.rows[0];
  if (!row) throw new AtsError("Application not found", 404, "NOT_FOUND");
  const [document, feedback, stages] = await Promise.all([
    query<{ extracted_text: string | null; file_name: string }>(
      `select extracted_text, coalesce(original_file_name, file_name) as file_name from resume_files
       where candidate_id=$1 and organization_id=$2 and archived_at is null order by created_at desc limit 1`,
      [row.candidate_id, organizationId]
    ),
    query<{ stage: string | null; recommendation: string | null; overall_score: string | null; evidence: string; risks: string }>(
      `select stages.name as stage, scorecards.recommendation, scorecards.overall_score::text, scorecards.evidence, scorecards.risks
       from scorecards join interviews on interviews.id=scorecards.interview_id
       left join job_stages stages on stages.id=interviews.stage_id
       where interviews.application_id=$1 and scorecards.state='submitted' order by scorecards.submitted_at`,
      [applicationId]
    ),
    query<{ stage_key: string; name: string; position: number }>(
      "select stage_key, name, position from job_stages where job_id=$1 and archived_at is null order by position",
      [row.job_id]
    )
  ]);
  return {
    application: {
      id: row.id, version: row.version, state: row.state, currentStage: row.stage_name,
      candidate: { id: row.candidate_id, name: row.candidate_name, profile: redactCandidateProfile(row.profile) },
      job: { id: row.job_id, title: row.job_title, businessReason: row.business_reason },
      rubric: { id: row.rubric_id, name: row.rubric_name, criteria: row.criteria },
      stages: stages.rows,
      submittedFeedback: feedback.rows
    },
    resume: {
      fileName: document.rows[0]?.file_name ?? "No resume",
      text: redactResume(document.rows[0]?.extracted_text ?? "No extractable resume text")
    }
  };
}
