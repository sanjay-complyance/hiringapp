import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { auditEvent, canManageUsers, jsonError, jsonFromError } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type UserPayload = {
  email?: string;
  name?: string;
  role?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UserPayload;
    const actor = await requireSessionUser(request);
    if (!canManageUsers(actor)) return jsonError("You do not have permission to manage users", 403);
    const actorUserId = actor.id;
    const email = body.email?.trim().toLowerCase();
    const name = body.name?.trim();
    const role = body.role?.trim() || "Reviewer";

    if (!email || !name || !email.includes("@")) {
      return jsonError("Valid name and email are required");
    }
    if (email.length > 254 || name.length > 120 || role.length > 80) {
      return jsonError("Name, email, or role is too long");
    }

    const result = await query<{ id: string; email: string; name: string; role: string; active: boolean }>(
      `
      insert into app_users (email, name, role)
      values ($1, $2, $3)
      on conflict (lower(email))
      do update set name = excluded.name, role = excluded.role, active = true, updated_at = now()
      returning id, email, name, role, active
      `,
      [email, name, role]
    );

    await auditEvent({
      actorUserId,
      action: "upsert_user",
      payload: { userId: result.rows[0].id, email, name, role }
    });

    return NextResponse.json({ user: result.rows[0] });
  } catch (error) {
    return jsonFromError(error, "Unable to save user");
  }
}
