import { Pool } from "pg";
import type { QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const globalForPg = globalThis as unknown as { hiringPool?: Pool };

export const pool =
  globalForPg.hiringPool ??
  new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 5
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.hiringPool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

export async function requireUser(userId: string) {
  const result = await query<{ id: string }>("select id from app_users where id = $1 and active = true", [userId]);
  if (result.rowCount !== 1) {
    throw new Error("Active user not found");
  }
}
