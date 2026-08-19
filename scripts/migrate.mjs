import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

async function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  const line = env.split(/\r?\n/).find((value) => value.startsWith("DATABASE_URL="));
  return line?.slice("DATABASE_URL=".length);
}

const connectionString = await databaseUrl();
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: true }, max: 1 });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const directory = path.join(process.cwd(), "migrations");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = await readFile(path.join(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query("select checksum from schema_migrations where name = $1", [file]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
        console.log(`already applied ${file}`);
        continue;
      }

      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [file, checksum]);
        await client.query("commit");
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
