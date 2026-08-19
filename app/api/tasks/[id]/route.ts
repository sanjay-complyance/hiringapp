import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  expectedVersion: z.number().int().positive(),
  status: z.enum(["open", "completed", "cancelled"]).optional(),
  title: z.string().trim().min(2).max(240).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  reminderAt: z.string().datetime().nullable().optional(),
  assignedUserId: databaseId.nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "tasks:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const current = await client.query<Record<string, unknown> & { version: number }>(
        "select * from hiring_tasks where id=$1 and organization_id=$2 for update", [id, context.organization.id]
      );
      const row = current.rows[0];
      if (!row) throw new AtsError("Task not found", 404, "NOT_FOUND");
      if (row.version !== payload.expectedVersion) throw new AtsError("Task changed since you opened it", 409, "STALE_VERSION");
      if (payload.assignedUserId) {
        const assignee = await client.query(
          `select memberships.user_id from organization_memberships memberships
           join app_users users on users.id=memberships.user_id
           where memberships.organization_id=$1 and memberships.user_id=$2
             and memberships.active=true and users.active=true`,
          [context.organization.id, payload.assignedUserId]
        );
        if (!assignee.rowCount) throw new AtsError("Task assignee must be an active organization member", 400, "INVALID_ASSIGNEE");
      }
      const value = <T,>(next: T | undefined, key: string) => next === undefined ? row[key] : next;
      const updated = await client.query<{ version: number }>(
        `update hiring_tasks set status=$1, title=$2, due_at=$3, reminder_at=$4, assigned_user_id=$5, priority=$6,
          completed_at=case when $1='completed' then now() else null end, version=version+1, updated_at=now()
         where id=$7 returning version`,
        [value(payload.status, "status"), value(payload.title, "title"), value(payload.dueAt, "due_at"),
          value(payload.reminderAt, "reminder_at"), value(payload.assignedUserId, "assigned_user_id"),
          value(payload.priority, "priority"), id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "task", aggregateId: id,
        eventType: payload.status === "completed" ? "task.completed" : "task.updated", actorUserId: context.user.id
      });
      return { version: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to update task");
  }
}
