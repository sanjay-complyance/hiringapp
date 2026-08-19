import type { PoolClient } from "pg";
import { pool } from "@/lib/db";

export async function withTransaction<T>(operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordEvent(
  client: PoolClient,
  event: {
    organizationId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    actorUserId: string;
    data?: Record<string, unknown>;
  }
) {
  const result = await client.query<{ id: string }>(
    `
      insert into domain_events (
        organization_id, aggregate_type, aggregate_id, event_type, actor_user_id, data
      ) values ($1, $2, $3, $4, $5, $6::jsonb)
      returning id::text
    `,
    [
      event.organizationId,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      event.actorUserId,
      JSON.stringify(event.data ?? {})
    ]
  );
  return Number(result.rows[0].id);
}
