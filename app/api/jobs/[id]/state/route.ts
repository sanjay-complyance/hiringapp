import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, hasPermission, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["submit", "approve", "pause", "reopen", "close"]),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(1000).optional()
});

const transitions: Record<string, { from: string[]; to: string }> = {
  submit: { from: ["draft"], to: "pending_approval" },
  approve: { from: ["pending_approval"], to: "open" },
  pause: { from: ["open"], to: "paused" },
  reopen: { from: ["paused", "closed"], to: "open" },
  close: { from: ["open", "paused"], to: "closed" }
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "jobs:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    if (payload.action === "approve" && !hasPermission(context.role, "jobs:approve")) {
      throw new AtsError("Only an owner or founder can approve a requisition", 403, "FORBIDDEN");
    }
    const result = await withTransaction(async (client) => {
      const current = await client.query<{ state: string; version: number }>(
        "select state, version from jobs where id=$1 and organization_id=$2 for update",
        [id, context.organization.id]
      );
      if (!current.rows[0]) throw new AtsError("Job not found", 404, "NOT_FOUND");
      if (current.rows[0].version !== payload.expectedVersion) throw new AtsError("Job changed since you opened it", 409, "STALE_VERSION");
      const transition = transitions[payload.action];
      if (!transition.from.includes(current.rows[0].state)) throw new AtsError("Invalid job state transition", 409, "INVALID_STATE");
      if (["pause", "reopen", "close"].includes(payload.action) && !payload.reason) {
        throw new AtsError("A reason is required", 400, "REASON_REQUIRED");
      }
      const updated = await client.query<{ version: number }>(
        `update jobs set state=$1, version=version+1, updated_at=now(),
          submitted_at=case when $1='pending_approval' then now() else submitted_at end,
          approved_by=case when $1='open' and state='pending_approval' then $2 else approved_by end,
          approved_at=case when $1='open' and state='pending_approval' then now() else approved_at end,
          closed_at=case when $1='closed' then now() else null end
         where id=$3 returning version`,
        [transition.to, context.user.id, id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "job", aggregateId: id,
        eventType: `job.${payload.action}`, actorUserId: context.user.id,
        data: { from: current.rows[0].state, to: transition.to, reason: payload.reason ?? null }
      });
      return { state: transition.to, version: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to change job state");
  }
}
