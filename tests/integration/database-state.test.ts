import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";

test("legacy migration preserves every candidate, resume, and evaluation", async () => {
  const env = await readFile(".env.local", "utf8");
  const connectionString = env.split(/\r?\n/).find((line) => line.startsWith("DATABASE_URL="))?.slice("DATABASE_URL=".length);
  assert.ok(connectionString);
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 1 });
  try {
    const result = await pool.query<{
      candidates: number; applications: number; documents: number; evaluations: number;
      active: number; on_hold: number; rejected: number;
    }>(`select
      (select count(*)::int from candidates where organization_id is not null) candidates,
      (select count(*)::int from applications) applications,
      (select count(*)::int from resume_files where organization_id is not null) documents,
      (select count(*)::int from evaluations) evaluations,
      (select count(*)::int from applications where state='active') active,
      (select count(*)::int from applications where state='on_hold') on_hold,
      (select count(*)::int from applications where state='rejected') rejected`);
    assert.deepEqual(result.rows[0], { candidates: 79, applications: 79, documents: 79, evaluations: 79, active: 12, on_hold: 21, rejected: 46 });
  } finally {
    await pool.end();
  }
});
