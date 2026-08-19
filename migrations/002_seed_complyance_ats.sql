insert into organizations (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Complyance', 'complyance')
on conflict (id) do update set name = excluded.name, updated_at = now();

insert into organization_memberships (organization_id, user_id, role)
select
  '00000000-0000-0000-0000-000000000001',
  id,
  case lower(email)
    when 'sanjay@complyance.io' then 'owner'
    when 'meiyappanmm@complyance.io' then 'founder'
    when 'hari@complyance.io' then 'founder'
    when 'arul@complyance.io' then 'recruiter'
    else 'viewer'
  end
from app_users
on conflict (organization_id, user_id)
do update set role = excluded.role, active = true, updated_at = now();

update candidates
set
  organization_id = '00000000-0000-0000-0000-000000000001',
  normalized_name = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '', 'g')),
  normalized_email = nullif(lower(profile #>> '{contacts,emails,0}'), ''),
  normalized_phone = nullif(regexp_replace(profile #>> '{contacts,phones,0}', '[^0-9]+', '', 'g'), '')
where organization_id is null;

update resume_files files
set
  organization_id = '00000000-0000-0000-0000-000000000001',
  original_file_name = coalesce(files.original_file_name, files.file_name),
  sha256 = coalesce(files.sha256, encode(digest(files.bytes, 'sha256'), 'hex')),
  uploaded_by = coalesce(files.uploaded_by, candidates.created_by)
from candidates
where candidates.id = files.candidate_id
  and files.organization_id is null;

insert into pipeline_templates (id, organization_id, name, description, is_default, created_by)
select
  '10000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Three-round hiring',
  'Resume review, HR phone screen, technical decision call, and founder final panel.',
  true,
  (select id from app_users where lower(email) = 'sanjay@complyance.io' limit 1)
on conflict (id) do nothing;

insert into pipeline_template_stages
  (id, template_id, stage_key, name, kind, position, sla_hours, required_scorecards, competency_template)
values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'resume_review', 'Resume review', 'review', 1, 48, 0, '["Eligibility","Resume evidence"]'),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'hr_screen', 'HR phone screen', 'phone_screen', 2, 72, 1, '["Role motivation","Company fit","Availability","Compensation alignment"]'),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'technical_decision', 'Technical + decision call', 'interview', 3, 120, 1, '["Technical depth","System design","Execution","Judgment"]'),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'final_panel', 'Final panel', 'interview', 4, 120, 1, '["Ownership","Operating fit","Risk","Final recommendation"]')
on conflict (id) do nothing;

insert into jobs (
  id, organization_id, title, code, department, business_reason, openings, priority,
  hiring_manager_id, recruiter_id, employment_type, location, work_mode, state,
  approved_by, approved_at, created_by
)
select
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Senior Software Developer',
  'ENG-SSE-001',
  'Engineering',
  'Hire a production-minded full-stack engineer who can own delivery and work effectively with an AI-assisted team.',
  1,
  'high',
  (select id from app_users where lower(email) = 'sanjay@complyance.io' limit 1),
  (select id from app_users where lower(email) = 'arul@complyance.io' limit 1),
  'full_time',
  'Chennai',
  'hybrid',
  'open',
  (select id from app_users where lower(email) = 'sanjay@complyance.io' limit 1),
  now(),
  (select id from app_users where lower(email) = 'sanjay@complyance.io' limit 1)
on conflict (id) do nothing;

insert into job_stages
  (id, job_id, stage_key, name, kind, position, sla_hours, required_scorecards, competency_template)
select
  case stage_key
    when 'resume_review' then '21000000-0000-0000-0000-000000000001'::uuid
    when 'hr_screen' then '21000000-0000-0000-0000-000000000002'::uuid
    when 'technical_decision' then '21000000-0000-0000-0000-000000000003'::uuid
    else '21000000-0000-0000-0000-000000000004'::uuid
  end,
  '20000000-0000-0000-0000-000000000001',
  stage_key, name, kind, position, sla_hours, required_scorecards, competency_template
from pipeline_template_stages
where template_id = '10000000-0000-0000-0000-000000000001'
on conflict (id) do nothing;

insert into rubric_versions (id, job_id, version_number, name, criteria, created_by)
select
  '22000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  1,
  'Strict senior engineering resume rubric',
  '[
    {"id":"experience_fit","label":"Less than 7 years experience","max":0,"hard":true},
    {"id":"full_stack_production","label":"Full-stack production delivery","max":4},
    {"id":"backend_api_database_depth","label":"Backend, API and database depth","max":4},
    {"id":"testing_debugging_production_support","label":"Testing and production support","max":3},
    {"id":"security_reliability_awareness","label":"Security and reliability","max":3},
    {"id":"ownership_mentoring_communication","label":"Ownership and communication","max":4},
    {"id":"agentic_tool_usage_or_interest","label":"Agentic tooling","max":2}
  ]'::jsonb,
  (select id from app_users where lower(email) = 'sanjay@complyance.io' limit 1)
on conflict (id) do nothing;

insert into applications (
  organization_id, candidate_id, job_id, current_stage_id, state, source, consent_status,
  owner_user_id, applied_at, stage_entered_at, decided_at, created_by
)
select
  '00000000-0000-0000-0000-000000000001',
  candidates.id,
  '20000000-0000-0000-0000-000000000001',
  case candidates.status
    when 'round1' then '21000000-0000-0000-0000-000000000002'::uuid
    when 'round2' then '21000000-0000-0000-0000-000000000003'::uuid
    when 'round3' then '21000000-0000-0000-0000-000000000004'::uuid
    else '21000000-0000-0000-0000-000000000001'::uuid
  end,
  case candidates.status
    when 'hold' then 'on_hold'
    when 'no_hire' then 'rejected'
    when 'hire' then 'hired'
    else 'active'
  end,
  'LinkedIn Top Fit',
  'unknown',
  candidates.owner_user_id,
  candidates.created_at,
  candidates.updated_at,
  case when candidates.status in ('no_hire','hire') then candidates.updated_at else null end,
  candidates.created_by
from candidates
where candidates.organization_id = '00000000-0000-0000-0000-000000000001'
on conflict (candidate_id, job_id) do nothing;

insert into evaluations (
  application_id, rubric_version_id, source, prompt_version, score, max_score,
  eligibility, evidence, gaps, created_by, created_at
)
select
  applications.id,
  '22000000-0000-0000-0000-000000000001',
  'deterministic',
  'legacy-strict-v1',
  candidates.stage0_score,
  coalesce((candidates.stage0 ->> 'max')::numeric, 20),
  jsonb_build_object(
    'experience_under_7',
    case
      when (candidates.profile ->> 'years') is null then null
      else (candidates.profile ->> 'years')::numeric < 7
    end,
    'requires_human_confirmation', true
  ),
  coalesce(candidates.stage0 -> 'metrics', '{}'::jsonb),
  coalesce(candidates.stage0 -> 'gaps_or_review_notes', '[]'::jsonb),
  candidates.created_by,
  candidates.created_at
from applications
join candidates on candidates.id = applications.candidate_id
where applications.job_id = '20000000-0000-0000-0000-000000000001'
  and not exists (
    select 1 from evaluations
    where evaluations.application_id = applications.id
      and evaluations.prompt_version = 'legacy-strict-v1'
  );

insert into domain_events (
  organization_id, aggregate_type, aggregate_id, event_type, actor_user_id, data,
  legacy_audit_event_id, created_at
)
select
  '00000000-0000-0000-0000-000000000001',
  'candidate',
  audit_events.candidate_id,
  audit_events.action,
  audit_events.actor_user_id,
  jsonb_build_object(
    'from_status', audit_events.from_status,
    'to_status', audit_events.to_status,
    'legacy', audit_events.payload
  ),
  audit_events.id,
  audit_events.created_at
from audit_events
where audit_events.candidate_id is not null
on conflict (legacy_audit_event_id) do nothing;

insert into communication_templates (organization_id, name, channel, subject, body, created_by)
select
  '00000000-0000-0000-0000-000000000001',
  template.name,
  template.channel,
  template.subject,
  template.body,
  (select id from app_users where lower(email) = 'arul@complyance.io' limit 1)
from (values
  ('HR screen invitation', 'call', null, 'Confirm role interest, location, availability, notice period, compensation expectations, and company fit.'),
  ('Interview invitation', 'email', 'Interview details', 'Hi {{candidate_name}}, your interview for {{job_title}} is scheduled for {{date}}. Meeting link: {{meeting_url}}'),
  ('Decision follow-up', 'email', 'Update on your application', 'Hi {{candidate_name}}, thank you for your time. We will share the next update by {{follow_up_date}}.')
) as template(name, channel, subject, body)
on conflict (organization_id, name) do nothing;
