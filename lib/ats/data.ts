import { query } from "@/lib/db";

export async function getDashboardData(organizationId: string, userId: string) {
  const [summary, jobs, tasks, interviews, activity] = await Promise.all([
    query<{
      open_jobs: number;
      active_applications: number;
      overdue_tasks: number;
      upcoming_interviews: number;
      pending_approvals: number;
    }>(
      `select
        (select count(*)::int from jobs where organization_id = $1 and state = 'open') as open_jobs,
        (select count(*)::int from applications where organization_id = $1 and state = 'active') as active_applications,
        (select count(*)::int from hiring_tasks where organization_id = $1 and status = 'open' and due_at < now()) as overdue_tasks,
        (select count(*)::int from interviews where organization_id = $1 and status = 'scheduled' and starts_at >= now()) as upcoming_interviews,
        ((select count(*) from jobs where organization_id = $1 and state = 'pending_approval') +
         (select count(*) from offers where organization_id = $1 and status = 'pending_approval'))::int as pending_approvals`,
      [organizationId]
    ),
    query<{
      id: string; title: string; department: string; state: string; priority: string; openings: number;
      target_date: string | null; recruiter_name: string | null; hiring_manager_name: string | null;
      total: number; active: number; on_hold: number; rejected: number; hired: number; overdue: number;
    }>(
      `select jobs.id, jobs.title, jobs.department, jobs.state, jobs.priority, jobs.openings,
        jobs.target_date::text, recruiter.name as recruiter_name, manager.name as hiring_manager_name,
        count(applications.id)::int as total,
        count(applications.id) filter (where applications.state = 'active')::int as active,
        count(applications.id) filter (where applications.state = 'on_hold')::int as on_hold,
        count(applications.id) filter (where applications.state = 'rejected')::int as rejected,
        count(applications.id) filter (where applications.state = 'hired')::int as hired,
        count(applications.id) filter (
          where applications.state = 'active' and stages.sla_hours is not null
            and applications.stage_entered_at + make_interval(hours => stages.sla_hours) < now()
        )::int as overdue
       from jobs
       left join app_users recruiter on recruiter.id = jobs.recruiter_id
       left join app_users manager on manager.id = jobs.hiring_manager_id
       left join applications on applications.job_id = jobs.id
       left join job_stages stages on stages.id = applications.current_stage_id
       where jobs.organization_id = $1
       group by jobs.id, recruiter.name, manager.name
       order by case jobs.state when 'open' then 0 when 'pending_approval' then 1 else 2 end,
         case jobs.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
         jobs.created_at desc`,
      [organizationId]
    ),
    query<{
      id: string; title: string; description: string; status: string; priority: string; due_at: string | null; version: number;
      candidate_name: string | null; job_title: string | null; assigned_name: string | null; assigned_user_id: string | null;
    }>(
      `select tasks.id, tasks.title, tasks.description, tasks.status, tasks.priority, tasks.due_at::text, tasks.version,
        candidates.name as candidate_name, jobs.title as job_title, users.name as assigned_name, tasks.assigned_user_id
       from hiring_tasks tasks
       left join applications on applications.id = tasks.application_id
       left join candidates on candidates.id = applications.candidate_id
       left join jobs on jobs.id = coalesce(tasks.job_id, applications.job_id)
       left join app_users users on users.id = tasks.assigned_user_id
       where tasks.organization_id = $1 and tasks.status = 'open'
         and (tasks.assigned_user_id = $2 or tasks.assigned_user_id is null)
       order by tasks.due_at asc nulls last, tasks.created_at desc
       limit 8`,
      [organizationId, userId]
    ),
    query<{
      id: string; title: string; starts_at: string | null; status: string; kind: string;
      candidate_id: string; candidate_name: string; job_title: string; meeting_url: string | null;
    }>(
      `select interviews.id, interviews.title, interviews.starts_at::text, interviews.status, interviews.kind,
        candidates.id as candidate_id, candidates.name as candidate_name, jobs.title as job_title, interviews.meeting_url
       from interviews
       join applications on applications.id = interviews.application_id
       join candidates on candidates.id = applications.candidate_id
       join jobs on jobs.id = applications.job_id
       where interviews.organization_id = $1 and interviews.status = 'scheduled' and interviews.starts_at >= now()
       order by interviews.starts_at asc
       limit 6`,
      [organizationId]
    ),
    query<{
      id: string; aggregate_type: string; aggregate_id: string; event_type: string; data: Record<string, unknown>;
      actor_name: string | null; created_at: string;
    }>(
      `select events.id::text, events.aggregate_type, events.aggregate_id, events.event_type, events.data,
        users.name as actor_name, events.created_at::text
       from domain_events events
       left join app_users users on users.id = events.actor_user_id
       where events.organization_id = $1
       order by events.id desc
       limit 10`,
      [organizationId]
    )
  ]);

  return { summary: summary.rows[0], jobs: jobs.rows, tasks: tasks.rows, interviews: interviews.rows, activity: activity.rows };
}

export async function getJobs(organizationId: string) {
  const result = await query<{
    id: string; title: string; code: string | null; department: string; business_reason: string; openings: number;
    priority: string; state: string; target_date: string | null; location: string; work_mode: string;
    recruiter_name: string | null; hiring_manager_name: string | null; total: number; active: number; hired: number;
  }>(
    `select jobs.id, jobs.title, jobs.code, jobs.department, jobs.business_reason, jobs.openings, jobs.priority,
      jobs.state, jobs.target_date::text, jobs.location, jobs.work_mode, recruiter.name as recruiter_name,
      manager.name as hiring_manager_name, count(applications.id)::int as total,
      count(applications.id) filter (where applications.state in ('active','on_hold'))::int as active,
      count(applications.id) filter (where applications.state = 'hired')::int as hired
     from jobs
     left join app_users recruiter on recruiter.id = jobs.recruiter_id
     left join app_users manager on manager.id = jobs.hiring_manager_id
     left join applications on applications.job_id = jobs.id
     where jobs.organization_id = $1
     group by jobs.id, recruiter.name, manager.name
     order by jobs.created_at desc`,
    [organizationId]
  );
  return result.rows;
}

export async function getJobDetail(organizationId: string, jobId: string, includeCompensation: boolean) {
  const [job, stages, applications, rubric, members] = await Promise.all([
    query<{
      id: string; title: string; code: string | null; department: string; business_reason: string; openings: number;
      priority: string; state: string; target_date: string | null; employment_type: string; location: string;
      work_mode: string; compensation_min: string | null; compensation_max: string | null; compensation_currency: string;
      version: number; recruiter_id: string | null; hiring_manager_id: string | null; recruiter_name: string | null;
      hiring_manager_name: string | null; approved_by_name: string | null; approved_at: string | null;
    }>(
      `select jobs.id, jobs.title, jobs.code, jobs.department, jobs.business_reason, jobs.openings, jobs.priority,
        jobs.state, jobs.target_date::text, jobs.employment_type, jobs.location, jobs.work_mode,
        case when $3 then jobs.compensation_min::text else null end as compensation_min,
        case when $3 then jobs.compensation_max::text else null end as compensation_max,
        jobs.compensation_currency, jobs.version, jobs.recruiter_id, jobs.hiring_manager_id,
        recruiter.name as recruiter_name, manager.name as hiring_manager_name, approver.name as approved_by_name,
        jobs.approved_at::text
       from jobs
       left join app_users recruiter on recruiter.id = jobs.recruiter_id
       left join app_users manager on manager.id = jobs.hiring_manager_id
       left join app_users approver on approver.id = jobs.approved_by
       where jobs.organization_id = $1 and jobs.id = $2`,
      [organizationId, jobId, includeCompensation]
    ),
    query<{
      id: string; stage_key: string; name: string; kind: string; position: number; sla_hours: number | null;
      required_scorecards: number; competency_template: string[];
    }>(
      `select id, stage_key, name, kind, position, sla_hours, required_scorecards, competency_template
       from job_stages where job_id = $1 and archived_at is null order by position`,
      [jobId]
    ),
    query<{
      id: string; candidate_id: string; candidate_name: string; years: number | null; state: string; version: number;
      current_stage_id: string | null; stage_name: string | null; stage_key: string | null; stage_entered_at: string;
      owner_name: string | null; score: string | null; max_score: string | null; eligibility: Record<string, unknown> | null;
      evaluation_id: string | null; source: string; follow_up_at: string | null; rejection_reason: string | null;
      overdue: boolean; document_id: string | null;
    }>(
      `select applications.id, candidates.id as candidate_id, candidates.name as candidate_name,
        case when jsonb_typeof(candidates.profile -> 'years') = 'number' then (candidates.profile ->> 'years')::numeric else null end as years,
        applications.state, applications.version, applications.current_stage_id, stages.name as stage_name,
        stages.stage_key, applications.stage_entered_at::text, owner.name as owner_name,
        evaluation.score::text, evaluation.max_score::text, evaluation.eligibility, evaluation.id as evaluation_id,
        applications.source, applications.follow_up_at::text, applications.rejection_reason,
        (applications.state = 'active' and stages.sla_hours is not null and
          applications.stage_entered_at + make_interval(hours => stages.sla_hours) < now()) as overdue,
        documents.id::text as document_id
       from applications
       join candidates on candidates.id = applications.candidate_id
       left join job_stages stages on stages.id = applications.current_stage_id
       left join app_users owner on owner.id = applications.owner_user_id
       left join lateral (
         select evaluations.* from evaluations where evaluations.application_id = applications.id
         order by evaluations.created_at desc limit 1
       ) evaluation on true
       left join lateral (
         select resume_files.id from resume_files where resume_files.candidate_id = candidates.id and archived_at is null
         order by resume_files.created_at desc limit 1
       ) documents on true
       where applications.organization_id = $1 and applications.job_id = $2
       order by case applications.state when 'active' then 0 when 'on_hold' then 1 when 'hired' then 2 else 3 end,
         evaluation.score desc nulls last, lower(candidates.name)`,
      [organizationId, jobId]
    ),
    query<{ id: string; version_number: number; name: string; criteria: Array<Record<string, unknown>> }>(
      `select id, version_number, name, criteria from rubric_versions
       where job_id = $1 and is_active = true order by version_number desc limit 1`,
      [jobId]
    ),
    query<{ id: string; name: string; email: string; role: string }>(
      `select users.id, users.name, users.email, memberships.role
       from organization_memberships memberships join app_users users on users.id = memberships.user_id
       where memberships.organization_id = $1 and memberships.active = true and users.active = true
       order by users.name`,
      [organizationId]
    )
  ]);
  return { job: job.rows[0] ?? null, stages: stages.rows, applications: applications.rows, rubric: rubric.rows[0] ?? null, members: members.rows };
}

export async function getCandidates(organizationId: string, includePii: boolean) {
  const result = await query<{
    id: string; name: string; email: string | null; phone: string | null; years: number | null; archived_at: string | null;
    applications: number; active_applications: number; latest_job: string | null; latest_stage: string | null;
    latest_state: string | null; document_id: string | null; created_at: string;
  }>(
    `select candidates.id, candidates.name,
      case when $2 then candidates.normalized_email else null end as email,
      case when $2 then candidates.normalized_phone else null end as phone,
      case when jsonb_typeof(candidates.profile -> 'years') = 'number' then (candidates.profile ->> 'years')::numeric else null end as years,
      candidates.archived_at::text, count(applications.id)::int as applications,
      count(applications.id) filter (where applications.state in ('active','on_hold'))::int as active_applications,
      recent.job_title as latest_job, recent.stage_name as latest_stage, recent.state as latest_state,
      documents.id::text as document_id, candidates.created_at::text
     from candidates
     left join applications on applications.candidate_id = candidates.id and applications.organization_id = $1
     left join lateral (
       select jobs.title as job_title, stages.name as stage_name, candidate_apps.state
       from applications candidate_apps
       join jobs on jobs.id = candidate_apps.job_id
       left join job_stages stages on stages.id = candidate_apps.current_stage_id
       where candidate_apps.candidate_id = candidates.id and candidate_apps.organization_id = $1
       order by candidate_apps.updated_at desc limit 1
     ) recent on true
     left join lateral (
       select resume_files.id from resume_files where resume_files.candidate_id = candidates.id and archived_at is null
       order by resume_files.created_at desc limit 1
     ) documents on true
     where candidates.organization_id = $1
     group by candidates.id, recent.job_title, recent.stage_name, recent.state, documents.id
     order by candidates.archived_at nulls first, lower(candidates.name)`,
    [organizationId, includePii]
  );
  return result.rows;
}

export async function getCandidateDetail(
  organizationId: string,
  candidateId: string,
  includeCompensation: boolean,
  includePii: boolean,
  currentUserId: string
) {
  const [candidate, documents, applications, communications, interviews, tasks, offers, notes, activity, proposals, stages, members] = await Promise.all([
    query<{
      id: string; name: string; profile: Record<string, unknown>; archived_at: string | null; version: number; created_at: string;
    }>(
      `select id, name, case when $3 then profile else profile - 'contacts' end as profile,
        archived_at::text, version, created_at::text
       from candidates where organization_id = $1 and id = $2`,
      [organizationId, candidateId, includePii]
    ),
    query<{
      id: string; file_name: string; content_type: string; size_bytes: number; sha256: string | null;
      extraction_status: string; created_at: string;
    }>(
      `select id::text, coalesce(original_file_name, file_name) as file_name, content_type, size_bytes, sha256,
        extraction_status, created_at::text from resume_files
       where organization_id = $1 and candidate_id = $2 and archived_at is null and $3::boolean order by created_at desc`,
      [organizationId, candidateId, includePii]
    ),
    query<{
      id: string; job_id: string; job_title: string; state: string; version: number; current_stage_id: string | null; stage_name: string | null;
      stage_key: string | null; source: string; consent_status: string; availability_date: string | null;
      notice_period_days: number | null; work_mode_preference: string | null; current_compensation: string | null;
      expected_compensation: string | null; compensation_currency: string; follow_up_at: string | null;
      screening_suitability: string | null; role_interest: string | null; location_confirmed: boolean | null;
      rejection_reason: string | null; owner_user_id: string | null; score: string | null; max_score: string | null;
      eligibility: Record<string, unknown> | null; evidence: Record<string, unknown> | null; gaps: unknown[] | null;
    }>(
      `select applications.id, jobs.id as job_id, jobs.title as job_title, applications.state, applications.version,
        applications.current_stage_id, stages.name as stage_name, stages.stage_key, applications.source, applications.consent_status,
        applications.availability_date::text, applications.notice_period_days, applications.work_mode_preference,
        case when $3 then applications.current_compensation::text else null end as current_compensation,
        case when $3 then applications.expected_compensation::text else null end as expected_compensation,
        applications.compensation_currency, applications.screening_suitability, applications.role_interest,
        applications.location_confirmed, applications.follow_up_at::text, applications.rejection_reason, applications.owner_user_id,
        evaluation.score::text, evaluation.max_score::text, evaluation.eligibility, evaluation.evidence, evaluation.gaps
       from applications
       join jobs on jobs.id = applications.job_id
       left join job_stages stages on stages.id = applications.current_stage_id
       left join lateral (
         select evaluations.* from evaluations where evaluations.application_id = applications.id
         order by evaluations.created_at desc limit 1
       ) evaluation on true
       where applications.organization_id = $1 and applications.candidate_id = $2
       order by applications.updated_at desc`,
      [organizationId, candidateId, includeCompensation]
    ),
    query<{
      id: string; application_id: string; channel: string; direction: string; subject: string | null; body: string;
      occurred_at: string; author_name: string | null;
    }>(
      `select communications.id, communications.application_id, communications.channel, communications.direction,
        communications.subject, communications.body, communications.occurred_at::text, users.name as author_name
       from communications left join app_users users on users.id = communications.created_by
       join applications on applications.id = communications.application_id
       where communications.organization_id = $1 and applications.candidate_id = $2
       order by communications.occurred_at desc`,
      [organizationId, candidateId]
    ),
    query<{
      id: string; application_id: string; title: string; kind: string; status: string; starts_at: string | null;
      meeting_url: string | null; stage_name: string | null; submitted_scorecards: number; participant_count: number;
    }>(
      `select interviews.id, interviews.application_id, interviews.title, interviews.kind, interviews.status,
        interviews.starts_at::text, interviews.meeting_url, stages.name as stage_name,
        count(scorecards.id) filter (where scorecards.state = 'submitted')::int as submitted_scorecards,
        count(distinct participants.user_id)::int as participant_count
       from interviews join applications on applications.id = interviews.application_id
       left join job_stages stages on stages.id = interviews.stage_id
       left join scorecards on scorecards.interview_id = interviews.id
       left join interview_participants participants on participants.interview_id = interviews.id
       where interviews.organization_id = $1 and applications.candidate_id = $2
       group by interviews.id, stages.name order by interviews.starts_at desc nulls last`,
      [organizationId, candidateId]
    ),
    query<{
      id: string; application_id: string | null; title: string; status: string; priority: string; due_at: string | null;
      assigned_name: string | null;
    }>(
      `select tasks.id, tasks.application_id, tasks.title, tasks.status, tasks.priority, tasks.due_at::text,
        users.name as assigned_name
       from hiring_tasks tasks left join app_users users on users.id = tasks.assigned_user_id
       left join applications on applications.id = tasks.application_id
       where tasks.organization_id = $1 and applications.candidate_id = $2
       order by tasks.status, tasks.due_at nulls last`,
      [organizationId, candidateId]
    ),
    query<{
      id: string; application_id: string; status: string; compensation: string | null; currency: string;
      proposed_start_date: string | null; conditions: string; version: number; approved_by_name: string | null;
    }>(
      `select offers.id, offers.application_id, offers.status,
        case when $3 then offers.compensation::text else null end as compensation,
        offers.currency, offers.proposed_start_date::text, offers.conditions, offers.version,
        users.name as approved_by_name
       from offers join applications on applications.id = offers.application_id
       left join app_users users on users.id = offers.approved_by
       where offers.organization_id = $1 and applications.candidate_id = $2
       order by offers.created_at desc`,
      [organizationId, candidateId, includeCompensation]
    ),
    query<{ id: string; body: string; author_name: string | null; created_at: string }>(
      `select notes.id::text, notes.body, users.name as author_name, notes.created_at::text
       from candidate_notes notes left join app_users users on users.id = notes.author_user_id
       where notes.candidate_id = $1 order by notes.created_at desc`,
      [candidateId]
    ),
    query<{
      id: string; event_type: string; data: Record<string, unknown>; actor_name: string | null; created_at: string;
    }>(
      `select events.id::text, events.event_type, events.data, users.name as actor_name, events.created_at::text
       from domain_events events left join app_users users on users.id = events.actor_user_id
       where events.organization_id = $1 and (
         (events.aggregate_type = 'candidate' and events.aggregate_id = $2) or
         events.aggregate_id in (select id::text from applications where candidate_id = $2 and organization_id = $1)
       ) order by events.id desc limit 80`,
      [organizationId, candidateId]
    ),
    query<{
      id: string; application_id: string | null; kind: string; title: string; payload: Record<string, unknown>;
      evidence: unknown[]; status: string; created_at: string;
    }>(
      `select proposals.id, proposals.application_id, proposals.kind, proposals.title, proposals.payload,
        proposals.evidence, proposals.status, proposals.created_at::text
       from agent_proposals proposals
       join agent_runs runs on runs.id = proposals.run_id
       where proposals.organization_id = $1 and proposals.application_id in (
         select id from applications where candidate_id = $2 and organization_id = $1
       ) and (proposals.status='approved' or (proposals.status='pending' and runs.created_by=$3))
       order by proposals.created_at desc`,
      [organizationId, candidateId, currentUserId]
    ),
    query<{ id: string; job_id: string; stage_key: string; name: string; position: number; kind: string; competency_template: string[] }>(
      `select stages.id, stages.job_id, stages.stage_key, stages.name, stages.position, stages.kind, stages.competency_template
       from job_stages stages where stages.job_id in (
         select job_id from applications where organization_id=$1 and candidate_id=$2
       ) and stages.archived_at is null order by stages.job_id, stages.position`,
      [organizationId, candidateId]
    ),
    query<{ id: string; name: string; email: string; role: string }>(
      `select users.id, users.name, users.email, memberships.role
       from organization_memberships memberships join app_users users on users.id=memberships.user_id
       where memberships.organization_id=$1 and memberships.active=true and users.active=true order by users.name`,
      [organizationId]
    )
  ]);
  return {
    candidate: candidate.rows[0] ?? null,
    documents: documents.rows,
    applications: applications.rows,
    communications: communications.rows,
    interviews: interviews.rows,
    tasks: tasks.rows,
    offers: offers.rows,
    notes: notes.rows,
    activity: activity.rows,
    proposals: proposals.rows,
    stages: stages.rows,
    members: members.rows
  };
}

export async function getInterviews(organizationId: string, userId: string) {
  const result = await query<{
    id: string; title: string; kind: string; status: string; starts_at: string | null; ends_at: string | null;
    meeting_url: string | null; candidate_id: string; candidate_name: string; job_title: string; stage_name: string | null;
    my_scorecard_state: string | null; my_scorecard_version: number | null; participants: string[];
    competency_assignments: Array<{ competency: string; userId: string }>; version: number; is_participant: boolean;
  }>(
    `select interviews.id, interviews.title, interviews.kind, interviews.status, interviews.starts_at::text,
      interviews.ends_at::text, interviews.meeting_url, candidates.id as candidate_id, candidates.name as candidate_name,
      jobs.title as job_title, stages.name as stage_name, mine.state as my_scorecard_state,
      mine.version as my_scorecard_version, interviews.competency_assignments, interviews.version,
      coalesce(bool_or(participants.user_id=$2), false) as is_participant,
      coalesce(array_agg(distinct users.name) filter (where users.name is not null), '{}') as participants
     from interviews
     join applications on applications.id = interviews.application_id
     join candidates on candidates.id = applications.candidate_id
     join jobs on jobs.id = applications.job_id
     left join job_stages stages on stages.id = interviews.stage_id
     left join interview_participants participants on participants.interview_id = interviews.id
     left join app_users users on users.id = participants.user_id
     left join scorecards mine on mine.interview_id = interviews.id and mine.interviewer_user_id = $2
     where interviews.organization_id = $1
     group by interviews.id, candidates.id, jobs.title, stages.name, mine.state, mine.version
     order by interviews.starts_at asc nulls last, interviews.created_at desc`,
    [organizationId, userId]
  );
  return result.rows;
}

export async function getTasks(organizationId: string) {
  const result = await query<{
    id: string; title: string; description: string; status: string; priority: string; due_at: string | null; reminder_at: string | null;
    assigned_user_id: string | null; assigned_name: string | null; candidate_id: string | null; candidate_name: string | null;
    job_id: string | null; job_title: string | null; version: number;
  }>(
    `select tasks.id, tasks.title, tasks.description, tasks.status, tasks.priority, tasks.due_at::text, tasks.reminder_at::text,
      tasks.assigned_user_id, users.name as assigned_name, candidates.id as candidate_id, candidates.name as candidate_name,
      jobs.id as job_id, jobs.title as job_title, tasks.version
     from hiring_tasks tasks
     left join app_users users on users.id = tasks.assigned_user_id
     left join applications on applications.id = tasks.application_id
     left join candidates on candidates.id = applications.candidate_id
     left join jobs on jobs.id = coalesce(tasks.job_id, applications.job_id)
     where tasks.organization_id = $1
     order by case tasks.status when 'open' then 0 else 1 end, tasks.due_at asc nulls last, tasks.created_at desc`,
    [organizationId]
  );
  return result.rows;
}

export async function getReports(organizationId: string) {
  const [funnel, stages, sources, reasons, workload, velocity, plans] = await Promise.all([
    query<{ state: string; count: number }>(
      `select state, count(*)::int as count from applications where organization_id = $1 group by state order by count desc`,
      [organizationId]
    ),
    query<{ stage: string; count: number; overdue: number; avg_days: string }>(
      `select coalesce(stages.name, 'Decision complete') as stage, count(*)::int as count,
        count(*) filter (where applications.state = 'active' and stages.sla_hours is not null and
          applications.stage_entered_at + make_interval(hours => stages.sla_hours) < now())::int as overdue,
        round(avg(extract(epoch from (now() - applications.stage_entered_at)) / 86400)::numeric, 1)::text as avg_days
       from applications left join job_stages stages on stages.id = applications.current_stage_id
       where applications.organization_id = $1 group by stages.name, stages.position order by stages.position nulls last`,
      [organizationId]
    ),
    query<{ source: string; applications: number; active: number; hired: number }>(
      `select source, count(*)::int as applications,
        count(*) filter (where state in ('active','on_hold'))::int as active,
        count(*) filter (where state = 'hired')::int as hired
       from applications where organization_id = $1 group by source order by applications desc`,
      [organizationId]
    ),
    query<{ reason: string; count: number }>(
      `select coalesce(nullif(rejection_reason, ''), 'Reason not recorded') as reason, count(*)::int as count
       from applications where organization_id = $1 and state = 'rejected'
       group by coalesce(nullif(rejection_reason, ''), 'Reason not recorded') order by count desc limit 8`,
      [organizationId]
    ),
    query<{ name: string; open_tasks: number; applications: number }>(
      `select users.name,
        count(distinct tasks.id) filter (where tasks.status = 'open')::int as open_tasks,
        count(distinct applications.id) filter (where applications.state in ('active','on_hold'))::int as applications
       from organization_memberships memberships join app_users users on users.id = memberships.user_id
       left join hiring_tasks tasks on tasks.assigned_user_id = users.id and tasks.organization_id = memberships.organization_id
       left join applications on applications.owner_user_id = users.id and applications.organization_id = memberships.organization_id
       where memberships.organization_id = $1 and memberships.active = true group by users.id order by open_tasks desc`,
      [organizationId]
    ),
    query<{
      avg_hours_to_review: string | null; avg_days_to_decision: string | null; avg_days_to_hire: string | null;
      offer_acceptance: string | null; completed_decisions: number;
    }>(
      `select
        round((select avg(extract(epoch from (first_evaluation.created_at - applications.applied_at)) / 3600)
          from applications join lateral (
            select evaluations.created_at from evaluations where evaluations.application_id=applications.id
            order by evaluations.created_at limit 1
          ) first_evaluation on true where applications.organization_id=$1)::numeric, 1)::text as avg_hours_to_review,
        round((select avg(extract(epoch from (decided_at - applied_at)) / 86400)
          from applications where organization_id=$1 and decided_at is not null)::numeric, 1)::text as avg_days_to_decision,
        round((select avg(extract(epoch from (decided_at - applied_at)) / 86400)
          from applications where organization_id=$1 and state='hired' and decided_at is not null)::numeric, 1)::text as avg_days_to_hire,
        (select round(100.0 * count(*) filter (where status='accepted') /
          nullif(count(*) filter (where status in ('accepted','declined')), 0), 1)::text
          from offers where organization_id=$1) as offer_acceptance,
        (select count(*)::int from applications where organization_id=$1 and decided_at is not null) as completed_decisions`,
      [organizationId]
    ),
    query<{ id: string; title: string; state: string; openings: number; hired: number; active: number; target_date: string | null }>(
      `select jobs.id, jobs.title, jobs.state, jobs.openings, jobs.target_date::text,
        count(applications.id) filter (where applications.state='hired')::int as hired,
        count(applications.id) filter (where applications.state in ('active','on_hold'))::int as active
       from jobs left join applications on applications.job_id=jobs.id
       where jobs.organization_id=$1 group by jobs.id order by jobs.state, jobs.target_date nulls last`,
      [organizationId]
    )
  ]);
  return {
    funnel: funnel.rows, stages: stages.rows, sources: sources.rows, reasons: reasons.rows,
    workload: workload.rows, velocity: velocity.rows[0], plans: plans.rows
  };
}

export async function getSettingsData(organizationId: string) {
  const [members, templates, providers, usage, communicationTemplates] = await Promise.all([
    query<{ id: string; name: string; email: string; role: string; active: boolean }>(
      `select users.id, users.name, users.email, memberships.role, memberships.active
       from organization_memberships memberships join app_users users on users.id = memberships.user_id
       where memberships.organization_id = $1 order by memberships.created_at`,
      [organizationId]
    ),
    query<{ id: string; name: string; description: string; is_default: boolean; stages: number }>(
      `select templates.id, templates.name, templates.description, templates.is_default, count(stages.id)::int as stages
       from pipeline_templates templates left join pipeline_template_stages stages on stages.template_id = templates.id
       where templates.organization_id = $1 group by templates.id order by templates.is_default desc, templates.name`,
      [organizationId]
    ),
    query<{ id: string; provider: string; key_last_four: string; model: string; status: string; last_tested_at: string | null }>(
      `select id, provider, key_last_four, model, status, last_tested_at::text
       from ai_connections where organization_id = $1 order by provider`,
      [organizationId]
    ),
    query<{ tokens: string; runs: number }>(
      `select coalesce(sum(input_tokens + output_tokens), 0)::text as tokens, count(*)::int as runs
       from agent_runs where organization_id = $1 and created_at >= date_trunc('month', now())`,
      [organizationId]
    ),
    query<{ id: string; name: string; channel: string; subject: string | null; body: string }>(
      `select id, name, channel, subject, body from communication_templates
       where organization_id=$1 and active=true order by channel, name`,
      [organizationId]
    )
  ]);
  return { members: members.rows, templates: templates.rows, providers: providers.rows, usage: usage.rows[0], communicationTemplates: communicationTemplates.rows };
}
