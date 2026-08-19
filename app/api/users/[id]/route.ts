import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { membershipRoles } from "@/lib/ats/types";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({ role: z.enum(membershipRoles).optional(), active: z.boolean().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "users:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    if (id === context.user.id && payload.active === false) throw new AtsError("You cannot deactivate your own account", 409, "SELF_DEACTIVATION");
    if (context.role !== "owner" && payload.role && ["owner", "admin", "founder"].includes(payload.role)) {
      throw new AtsError("Only the owner can assign privileged roles", 403, "FORBIDDEN");
    }
    const result = await withTransaction(async (client) => {
      const current = await client.query<{ role: string; active: boolean }>(
        "select role, active from organization_memberships where organization_id=$1 and user_id=$2 for update",
        [context.organization.id, id]
      );
      if (!current.rows[0]) throw new AtsError("Membership not found", 404, "NOT_FOUND");
      if (current.rows[0].role === "owner" && (payload.active === false || (payload.role && payload.role !== "owner"))) {
        const owners = await client.query<{ count: number }>(
          "select count(*)::int as count from organization_memberships where organization_id=$1 and role='owner' and active=true",
          [context.organization.id]
        );
        if ((owners.rows[0]?.count ?? 0) <= 1) throw new AtsError("The organization must keep one active owner", 409, "LAST_OWNER");
      }
      const role = payload.role ?? current.rows[0].role;
      const active = payload.active ?? current.rows[0].active;
      await client.query(
        "update organization_memberships set role=$1, active=$2, updated_at=now() where organization_id=$3 and user_id=$4",
        [role, active, context.organization.id, id]
      );
      if (!active) await client.query("update app_users set active=false, updated_at=now() where id=$1", [id]);
      if (active) await client.query("update app_users set active=true, updated_at=now() where id=$1", [id]);
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "membership", aggregateId: id,
        eventType: active ? "membership.updated" : "membership.deactivated", actorUserId: context.user.id,
        data: { role, active }
      });
      return { role, active, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to update member");
  }
}
