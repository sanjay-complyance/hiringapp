import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  title: z.string().trim().min(2).max(240),
  description: z.string().trim().max(3000).default(""),
  applicationId: databaseId.optional().nullable(),
  jobId: databaseId.optional().nullable(),
  assignedUserId: databaseId.optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  reminderAt: z.string().datetime().optional().nullable(),
  priority: z.enum(["low", "medium", "high"]).default("medium")
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "tasks:manage");
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      let applicationJobId: string | null = null;
      if (payload.applicationId) {
        const app = await client.query<{ job_id: string }>(
          "select job_id from applications where id=$1 and organization_id=$2", [payload.applicationId, context.organization.id]
        );
        if (!app.rows[0]) throw new AtsError("Application not found", 404, "NOT_FOUND");
        applicationJobId = app.rows[0].job_id;
      }
      if (payload.jobId) {
        const job = await client.query("select id from jobs where id=$1 and organization_id=$2", [payload.jobId, context.organization.id]);
        if (!job.rowCount) throw new AtsError("Job not found", 404, "NOT_FOUND");
        if (applicationJobId && applicationJobId !== payload.jobId) {
          throw new AtsError("Task job must match the selected application", 400, "JOB_MISMATCH");
        }
      }
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
      const inserted = await client.query<{ id: string }>(
        `insert into hiring_tasks (organization_id, application_id, job_id, assigned_user_id, title, description, due_at, reminder_at, priority, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [context.organization.id, payload.applicationId || null, payload.jobId || applicationJobId, payload.assignedUserId || null,
          payload.title, payload.description, payload.dueAt || null, payload.reminderAt || null, payload.priority, context.user.id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "task", aggregateId: inserted.rows[0].id,
        eventType: "task.created", actorUserId: context.user.id,
        data: { application_id: payload.applicationId ?? null, job_id: payload.jobId ?? applicationJobId, reminder_at: payload.reminderAt ?? null }
      });
      return { id: inserted.rows[0].id, eventId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to create task");
  }
}
