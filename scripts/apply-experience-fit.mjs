import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const targetMaxYears = 7;
const reviewerEmail = "sanjay@complyance.io";
const activeStatuses = new Set(["new", "round1", "round2", "round3", "round4", "references", "hire"]);

async function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const content = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  const line = content.split(/\r?\n/).find((item) => item.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in .env.local");
  return line.slice("DATABASE_URL=".length);
}

function parseYears(value) {
  if (value === null || value === undefined || value === "") return null;
  const years = Number(value);
  return Number.isFinite(years) ? years : null;
}

function desiredStatus(years, currentStatus) {
  if (typeof years === "number" && years > targetMaxYears) return "no_hire";
  if ((years === null || years === targetMaxYears) && activeStatuses.has(currentStatus)) return "hold";
  return currentStatus;
}

const pool = new Pool({
  connectionString: await loadDatabaseUrl(),
  ssl: { rejectUnauthorized: true }
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const actorResult = await client.query("select id from app_users where lower(email) = lower($1) and active = true", [reviewerEmail]);
    const actorId = actorResult.rows[0]?.id;
    if (!actorId) throw new Error(`Active reviewer not found: ${reviewerEmail}`);

    const result = await client.query(`
      select id, name, status, profile ->> 'years' as years
      from candidates
      order by lower(name)
    `);

    const summary = { under7: 0, boundary7: 0, over7: 0, unknown: 0, changed: 0 };
    const changed = [];

    for (const row of result.rows) {
      const years = parseYears(row.years);
      if (years === null) summary.unknown += 1;
      else if (years < targetMaxYears) summary.under7 += 1;
      else if (years === targetMaxYears) summary.boundary7 += 1;
      else summary.over7 += 1;

      const nextStatus = desiredStatus(years, row.status);
      if (nextStatus === row.status) continue;

      await client.query("update candidates set status = $1, updated_at = now() where id = $2", [nextStatus, row.id]);
      await client.query(
        `
        insert into audit_events (candidate_id, actor_user_id, action, from_status, to_status, payload)
        values ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [
          row.id,
          actorId,
          nextStatus === "no_hire" ? "experience_rule_no_hire" : "experience_rule_hold",
          row.status,
          nextStatus,
          JSON.stringify({
            years,
            target: "under 7 years",
            reason:
              nextStatus === "no_hire"
                ? "Candidate is above the requested experience range"
                : "Experience is exactly 7 years or unclear; manual verification required"
          })
        ]
      );
      summary.changed += 1;
      changed.push({ id: row.id, name: row.name, years, from: row.status, to: nextStatus });
    }

    await client.query("commit");
    console.log(JSON.stringify({ summary, changed }, null, 2));
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
