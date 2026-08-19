create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  retention_days integer check (retention_days is null or retention_days > 0),
  ai_monthly_token_limit bigint not null default 1000000 check (ai_monthly_token_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null check (role in ('owner','admin','founder','recruiter','hiring_manager','interviewer','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table candidates add column if not exists organization_id uuid references organizations(id) on delete restrict;
alter table candidates add column if not exists normalized_name text;
alter table candidates add column if not exists normalized_email text;
alter table candidates add column if not exists normalized_phone text;
alter table candidates add column if not exists archived_at timestamptz;
alter table candidates add column if not exists version integer not null default 1;

alter table resume_files add column if not exists id uuid default gen_random_uuid();
alter table resume_files add column if not exists organization_id uuid references organizations(id) on delete restrict;
alter table resume_files add column if not exists original_file_name text;
alter table resume_files add column if not exists sha256 text;
alter table resume_files add column if not exists extracted_text text;
alter table resume_files add column if not exists extraction_status text not null default 'complete'
  check (extraction_status in ('pending','complete','failed'));
alter table resume_files add column if not exists uploaded_by uuid references app_users(id) on delete set null;
alter table resume_files add column if not exists archived_at timestamptz;
create unique index if not exists resume_files_id_unique on resume_files(id);
create index if not exists candidates_org_idx on candidates(organization_id, archived_at, name);
create index if not exists candidates_identity_idx on candidates(organization_id, normalized_email, normalized_phone, normalized_name);
create index if not exists resume_files_sha_idx on resume_files(organization_id, sha256);

create table if not exists pipeline_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  is_default boolean not null default false,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists pipeline_template_stages (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references pipeline_templates(id) on delete cascade,
  stage_key text not null,
  name text not null,
  kind text not null check (kind in ('review','phone_screen','interview','assessment','offer')),
  position integer not null,
  sla_hours integer check (sla_hours is null or sla_hours > 0),
  required_scorecards integer not null default 0 check (required_scorecards >= 0),
  competency_template jsonb not null default '[]'::jsonb,
  unique (template_id, stage_key),
  unique (template_id, position)
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  code text,
  department text not null,
  business_reason text not null,
  openings integer not null default 1 check (openings > 0),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  hiring_manager_id uuid references app_users(id) on delete set null,
  recruiter_id uuid references app_users(id) on delete set null,
  target_date date,
  employment_type text not null default 'full_time',
  location text not null default '',
  work_mode text not null default 'hybrid' check (work_mode in ('onsite','hybrid','remote')),
  compensation_min numeric(14,2),
  compensation_max numeric(14,2),
  compensation_currency text not null default 'INR',
  state text not null default 'draft' check (state in ('draft','pending_approval','open','paused','closed')),
  version integer not null default 1,
  submitted_at timestamptz,
  approved_by uuid references app_users(id) on delete set null,
  approved_at timestamptz,
  closed_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (compensation_min is null or compensation_max is null or compensation_min <= compensation_max)
);
create unique index if not exists jobs_org_code_unique on jobs(organization_id, lower(code)) where code is not null;
create index if not exists jobs_org_state_idx on jobs(organization_id, state, priority, created_at desc);

create table if not exists job_stages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  stage_key text not null,
  name text not null,
  kind text not null check (kind in ('review','phone_screen','interview','assessment','offer')),
  position integer not null,
  sla_hours integer check (sla_hours is null or sla_hours > 0),
  required_scorecards integer not null default 0 check (required_scorecards >= 0),
  competency_template jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  unique (job_id, stage_key),
  unique (job_id, position)
);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  candidate_id text not null references candidates(id) on delete restrict,
  job_id uuid not null references jobs(id) on delete cascade,
  current_stage_id uuid references job_stages(id) on delete set null,
  state text not null default 'active' check (state in ('active','on_hold','rejected','withdrawn','hired')),
  source text not null default 'direct',
  referral text,
  consent_status text not null default 'unknown' check (consent_status in ('unknown','recorded','declined')),
  availability_date date,
  notice_period_days integer check (notice_period_days is null or notice_period_days >= 0),
  work_mode_preference text,
  current_compensation numeric(14,2),
  expected_compensation numeric(14,2),
  compensation_currency text not null default 'INR',
  follow_up_at timestamptz,
  rejection_reason text,
  withdrawal_reason text,
  owner_user_id uuid references app_users(id) on delete set null,
  version integer not null default 1,
  applied_at timestamptz not null default now(),
  stage_entered_at timestamptz not null default now(),
  decided_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, job_id)
);
create index if not exists applications_job_stage_idx on applications(job_id, state, current_stage_id, stage_entered_at);
create index if not exists applications_org_candidate_idx on applications(organization_id, candidate_id);

create table if not exists rubric_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  version_number integer not null,
  name text not null,
  criteria jsonb not null,
  is_active boolean not null default true,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, version_number)
);

create table if not exists evaluations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  rubric_version_id uuid not null references rubric_versions(id) on delete restrict,
  source text not null check (source in ('deterministic','ai','human')),
  provider text,
  model text,
  prompt_version text,
  score numeric(8,2) not null default 0,
  max_score numeric(8,2) not null default 0,
  eligibility jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  supersedes_id uuid references evaluations(id) on delete set null,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists evaluations_application_idx on evaluations(application_id, created_at desc);

create table if not exists interviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  stage_id uuid references job_stages(id) on delete set null,
  title text not null,
  kind text not null check (kind in ('phone','video','onsite','assessment')),
  status text not null default 'draft' check (status in ('draft','scheduled','completed','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  meeting_url text,
  location text,
  organizer_user_id uuid references app_users(id) on delete set null,
  competency_assignments jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists interviews_org_schedule_idx on interviews(organization_id, status, starts_at);

create table if not exists interview_participants (
  interview_id uuid not null references interviews(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'interviewer',
  created_at timestamptz not null default now(),
  primary key (interview_id, user_id)
);

create table if not exists scorecards (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references interviews(id) on delete cascade,
  interviewer_user_id uuid not null references app_users(id) on delete restrict,
  state text not null default 'draft' check (state in ('draft','submitted')),
  scores jsonb not null default '{}'::jsonb,
  overall_score numeric(6,2),
  recommendation text,
  evidence text not null default '',
  risks text not null default '',
  dissent text not null default '',
  version integer not null default 1,
  submitted_at timestamptz,
  reopened_by uuid references app_users(id) on delete set null,
  reopened_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (interview_id, interviewer_user_id)
);

create table if not exists debriefs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  outcome text not null check (outcome in ('advance','hold','reject','hire')),
  evidence text not null,
  risks text not null default '',
  dissent text not null default '',
  decision_user_id uuid not null references app_users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists hiring_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid references applications(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  assigned_user_id uuid references app_users(id) on delete set null,
  title text not null,
  description text not null default '',
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  version integer not null default 1,
  completed_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hiring_tasks_inbox_idx on hiring_tasks(organization_id, status, assigned_user_id, due_at);

create table if not exists communication_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('call','email','message','meeting')),
  subject text,
  body text not null,
  active boolean not null default true,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  channel text not null check (channel in ('call','email','message','meeting')),
  direction text not null default 'outbound' check (direction in ('inbound','outbound','internal')),
  subject text,
  body text not null,
  occurred_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','sent','accepted','declined','withdrawn')),
  compensation numeric(14,2) not null,
  currency text not null default 'INR',
  proposed_start_date date,
  conditions text not null default '',
  version integer not null default 1,
  submitted_by uuid references app_users(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references app_users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offers_org_status_idx on offers(organization_id, status, created_at desc);

create table if not exists domain_events (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  actor_user_id uuid references app_users(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  legacy_audit_event_id bigint unique,
  created_at timestamptz not null default now()
);
create index if not exists domain_events_sync_idx on domain_events(organization_id, id);
create index if not exists domain_events_aggregate_idx on domain_events(organization_id, aggregate_type, aggregate_id, created_at desc);

create table if not exists login_attempts (
  id bigserial primary key,
  email_hash text not null,
  ip_hash text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_rate_idx on login_attempts(ip_hash, created_at desc);

create table if not exists ai_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('openai','anthropic')),
  encrypted_key text not null,
  key_last_four text not null,
  model text not null,
  status text not null default 'active' check (status in ('active','invalid','disabled')),
  last_tested_at timestamptz,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table if not exists agent_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  owner_user_id uuid not null references app_users(id) on delete cascade,
  application_id uuid references applications(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references agent_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  thread_id uuid references agent_threads(id) on delete set null,
  application_id uuid references applications(id) on delete cascade,
  provider text not null check (provider in ('openai','anthropic')),
  model text not null,
  prompt_version text not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  provider_request_id text,
  error_code text,
  created_by uuid not null references app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists agent_runs_usage_idx on agent_runs(organization_id, created_at, status);

create table if not exists agent_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  run_id uuid not null references agent_runs(id) on delete cascade,
  application_id uuid references applications(id) on delete cascade,
  kind text not null check (kind in ('evaluation','interview_guide','feedback_summary','task','stage_change','rubric_change')),
  title text not null,
  payload jsonb not null,
  evidence jsonb not null default '[]'::jsonb,
  base_version integer,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  reviewed_by uuid references app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists agent_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  provider text not null check (provider in ('openai','anthropic')),
  status text not null default 'queued' check (status in ('queued','running','completed','cancelled','failed')),
  created_by uuid not null references app_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_batch_items (
  batch_id uuid not null references agent_batches(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  attempts integer not null default 0,
  run_id uuid references agent_runs(id) on delete set null,
  error_code text,
  updated_at timestamptz not null default now(),
  primary key (batch_id, application_id)
);
