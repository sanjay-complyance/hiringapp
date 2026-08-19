import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

async function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const content = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  const line = content.split(/\r?\n/).find((item) => item.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in .env.local");
  return line.slice("DATABASE_URL=".length);
}

const pool = new Pool({
  connectionString: await loadDatabaseUrl(),
  ssl: { rejectUnauthorized: true }
});

const initialUsers = [
  { email: "sanjay@complyance.io", name: "Sanjay Kumar V", role: "Hiring Owner" },
  { email: "meiyappanmm@complyance.io", name: "Meiyappan MM", role: "Co Founder" },
  { email: "arul@complyance.io", name: "Arul", role: "HR" },
  { email: "hari@complyance.io", name: "Hari", role: "Co Founder" }
];

function defaultStatus(candidate) {
  if (typeof candidate.years === "number" && candidate.years >= 7) return "no_hire";
  if (candidate.years === null) return "hold";
  if (candidate.stage0.band === "Strict advance") return "round1";
  if (candidate.stage0.band === "Strict manual hold") return "hold";
  return "no_hire";
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("create extension if not exists pgcrypto");
    await client.query(`
      create table if not exists app_users (
        id uuid primary key default gen_random_uuid(),
        email text not null,
        name text not null,
        role text not null default 'Reviewer',
        active boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query("create unique index if not exists app_users_email_unique on app_users (lower(email))");

    await client.query(`
      create table if not exists candidates (
        id text primary key,
        name text not null,
        file_name text not null,
        source_path text not null,
        stage0_score integer not null default 0,
        stage0_band text not null default 'Unscreened',
        stage0 jsonb not null default '{}'::jsonb,
        profile jsonb not null default '{}'::jsonb,
        status text not null default 'new' check (status in ('new','round1','round2','round3','hire','no_hire','hold')),
        owner_user_id uuid references app_users(id) on delete set null,
        created_by uuid references app_users(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query("create index if not exists candidates_status_idx on candidates (status, stage0_score desc)");
    await client.query("create index if not exists candidates_stage0_idx on candidates (stage0_score desc)");
    await client.query("create index if not exists candidates_profile_gin on candidates using gin (profile)");

    await client.query(`
      create table if not exists resume_files (
        file_name text primary key,
        candidate_id text references candidates(id) on delete cascade,
        content_type text not null default 'application/pdf',
        bytes bytea not null,
        size_bytes integer not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query("create index if not exists resume_files_candidate_idx on resume_files (candidate_id)");

    await client.query(`
      create table if not exists candidate_notes (
        id bigserial primary key,
        candidate_id text not null references candidates(id) on delete cascade,
        author_user_id uuid references app_users(id) on delete set null,
        body text not null,
        created_at timestamptz not null default now()
      )
    `);
    await client.query("create index if not exists candidate_notes_candidate_idx on candidate_notes (candidate_id, created_at desc)");

    await client.query(`
      create table if not exists round_scores (
        candidate_id text not null references candidates(id) on delete cascade,
        round_id text not null,
        area_id text not null,
        score integer not null default 0,
        updated_by uuid references app_users(id) on delete set null,
        updated_at timestamptz not null default now(),
        primary key (candidate_id, round_id, area_id)
      )
    `);

    await client.query(`
      create table if not exists round_notes (
        candidate_id text not null references candidates(id) on delete cascade,
        round_id text not null,
        note text not null default '',
        updated_by uuid references app_users(id) on delete set null,
        updated_at timestamptz not null default now(),
        primary key (candidate_id, round_id)
      )
    `);

    await client.query(`
      create table if not exists audit_events (
        id bigserial primary key,
        candidate_id text references candidates(id) on delete cascade,
        actor_user_id uuid references app_users(id) on delete set null,
        action text not null,
        from_status text,
        to_status text,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      )
    `);
    await client.query("create index if not exists audit_events_candidate_idx on audit_events (candidate_id, created_at desc)");
    await client.query("create index if not exists audit_events_actor_idx on audit_events (actor_user_id, created_at desc)");

    const userIds = new Map();
    for (const user of initialUsers) {
      const result = await client.query(
        `
        insert into app_users (email, name, role)
        values ($1, $2, $3)
        on conflict (lower(email))
        do update set name = excluded.name, role = excluded.role, active = true, updated_at = now()
        returning id, email
        `,
        [user.email, user.name, user.role]
      );
      userIds.set(result.rows[0].email, result.rows[0].id);
    }

    const actorId = userIds.get("sanjay@complyance.io");
    const data = JSON.parse(await readFile(path.join(process.cwd(), "data/resume-evaluations.json"), "utf8"));
    for (const candidate of data.candidates) {
      const profile = {
        rank: candidate.rank,
        years: candidate.years,
        contacts: candidate.contacts,
        skills: candidate.skills,
        recent_titles: candidate.recent_titles,
        summary_excerpt: candidate.summary_excerpt,
        experience_excerpt: candidate.experience_excerpt,
        project_excerpt: candidate.project_excerpt,
        first_lines: candidate.first_lines,
        pages: candidate.pages,
        keyword_counts: candidate.keyword_counts
      };
      const status = defaultStatus(candidate);
      await client.query(
        `
        insert into candidates (
          id, name, file_name, source_path, stage0_score, stage0_band, stage0, profile, status, created_by
        )
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
        on conflict (id)
        do update set
          name = excluded.name,
          file_name = excluded.file_name,
          source_path = excluded.source_path,
          stage0_score = excluded.stage0_score,
          stage0_band = excluded.stage0_band,
          stage0 = excluded.stage0,
          profile = excluded.profile,
          updated_at = now()
        `,
        [
          candidate.id,
          candidate.name,
          candidate.file,
          candidate.source_path,
          candidate.stage0.score,
          candidate.stage0.band,
          JSON.stringify(candidate.stage0),
          JSON.stringify(profile),
          status,
          actorId
        ]
      );
      const pdfBytes = await readFile(candidate.source_path).catch(() => null);
      if (pdfBytes) {
        await client.query(
          `
          insert into resume_files (file_name, candidate_id, content_type, bytes, size_bytes)
          values ($1, $2, 'application/pdf', $3, $4)
          on conflict (file_name)
          do update set
            candidate_id = excluded.candidate_id,
            content_type = excluded.content_type,
            bytes = excluded.bytes,
            size_bytes = excluded.size_bytes,
            updated_at = now()
          `,
          [candidate.file, candidate.id, pdfBytes, pdfBytes.length]
        );
      }
      await client.query(
        `
        insert into audit_events (candidate_id, actor_user_id, action, to_status, payload)
        select $1, $2, 'seed_candidate', $3, $4::jsonb
        where not exists (
          select 1 from audit_events where candidate_id = $1 and action = 'seed_candidate'
        )
        `,
        [candidate.id, actorId, status, JSON.stringify({ stage0_score: candidate.stage0.score, stage0_band: candidate.stage0.band })]
      );
    }

    await client.query("commit");
    const counts = await client.query(`
      select
        (select count(*)::int from app_users) as users,
        (select count(*)::int from candidates) as candidates,
        (select count(*)::int from audit_events) as audit_events
    `);
    console.log(JSON.stringify(counts.rows[0], null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
