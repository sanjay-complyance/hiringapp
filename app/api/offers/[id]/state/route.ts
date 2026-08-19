import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, hasPermission, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["submit", "approve", "send", "accept", "decline", "withdraw"]),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(2000).optional()
});

const transitions: Record<string, { from: string[]; to: string }> = {
  submit: { from: ["draft"], to: "pending_approval" },
  approve: { from: ["pending_approval"], to: "approved" },
  send: { from: ["approved"], to: "sent" },
  accept: { from: ["sent"], to: "accepted" },
  decline: { from: ["sent"], to: "declined" },
  withdraw: { from: ["draft", "pending_approval", "approved", "sent"], to: "withdrawn" }
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "offers:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    if (payload.action === "approve" && !hasPermission(context.role, "offers:approve")) {
      throw new AtsError("Only an owner or founder can approve an offer", 403, "FORBIDDEN");
    }
    if (["decline", "withdraw"].includes(payload.action) && !payload.reason) throw new AtsError("A reason is required", 400, "REASON_REQUIRED");
    const result = await withTransaction(async (client) => {
      const current = await client.query<{ status: string; version: number; application_id: string; conditions: string }>(
        "select status, version, application_id, conditions from offers where id=$1 and organization_id=$2 for update",
        [id, context.organization.id]
      );
      const row = current.rows[0];
      if (!row) throw new AtsError("Offer not found", 404, "NOT_FOUND");
      if (row.version !== payload.expectedVersion) throw new AtsError("Offer changed since you opened it", 409, "STALE_VERSION");
      const transition = transitions[payload.action];
      if (!transition.from.includes(row.status)) throw new AtsError("Invalid offer state transition", 409, "INVALID_STATE");
      const updated = await client.query<{ version: number }>(
        `update offers set status=$1, version=version+1, updated_at=now(),
          submitted_by=case when $1='pending_approval' then $2 else submitted_by end,
          submitted_at=case when $1='pending_approval' then now() else submitted_at end,
          approved_by=case when $1='approved' then $2 else approved_by end,
          approved_at=case when $1='approved' then now() else approved_at end
         where id=$3 returning version`,
        [transition.to, context.user.id, id]
      );
      if (transition.to === "accepted") {
        const application = await client.query<{ state: string; candidate_id: string }>(
          "select state, candidate_id from applications where id=$1 and organization_id=$2 for update",
          [row.application_id, context.organization.id]
        );
        if (!application.rows[0] || !["active", "on_hold"].includes(application.rows[0].state)) {
          throw new AtsError("Application is no longer eligible to accept this offer", 409, "INVALID_APPLICATION_STATE");
        }
        await client.query("update applications set state='hired', decided_at=now(), version=version+1, updated_at=now() where id=$1", [row.application_id]);
        await client.query("update candidates set status='hire', version=version+1, updated_at=now() where id=$1", [application.rows[0].candidate_id]);
        await client.query(
          `insert into debriefs (application_id, outcome, evidence, decision_user_id)
           values ($1,'hire',$2,$3)`,
          [row.application_id, `Accepted approved offer ${id}. ${row.conditions || "No additional conditions recorded."}`, context.user.id]
        );
      }
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "offer", aggregateId: id,
        eventType: `offer.${payload.action}`, actorUserId: context.user.id,
        data: { from: row.status, to: transition.to, reason: payload.reason ?? null }
      });
      return { status: transition.to, version: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to change offer state");
  }
}
