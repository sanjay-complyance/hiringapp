import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { membershipRoles } from "@/lib/ats/types";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(120),
  role: z.enum(membershipRoles)
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "users:manage");
    const payload = schema.parse(await request.json());
    if (context.role !== "owner" && ["owner", "admin", "founder"].includes(payload.role)) {
      throw new AtsError("Only the owner can assign privileged roles", 403, "FORBIDDEN");
    }
    const result = await withTransaction(async (client) => {
      const user = await client.query<{ id: string; email: string; name: string; active: boolean }>(
        `insert into app_users (email, name, role) values ($1,$2,$3)
         on conflict (lower(email)) do update set name=excluded.name, active=true, updated_at=now()
         returning id, email, name, active`,
        [payload.email.toLowerCase(), payload.name, payload.role.replaceAll("_", " ")]
      );
      await client.query(
        `insert into organization_memberships (organization_id, user_id, role) values ($1,$2,$3)
         on conflict (organization_id, user_id) do update set role=excluded.role, active=true, updated_at=now()`,
        [context.organization.id, user.rows[0].id, payload.role]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "membership", aggregateId: user.rows[0].id,
        eventType: "membership.saved", actorUserId: context.user.id, data: { role: payload.role }
      });
      return { user: { ...user.rows[0], role: payload.role }, eventId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to save user");
  }
}
