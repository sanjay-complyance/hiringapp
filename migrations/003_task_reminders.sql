alter table hiring_tasks add column if not exists reminder_at timestamptz;

create index if not exists hiring_tasks_reminder_idx
  on hiring_tasks(organization_id, status, reminder_at)
  where reminder_at is not null;

alter table applications add column if not exists screening_suitability text
  check (screening_suitability in ('strong', 'mixed', 'not_suitable'));
alter table applications add column if not exists role_interest text
  check (role_interest in ('high', 'medium', 'low', 'declined'));
alter table applications add column if not exists location_confirmed boolean;
