import { NextResponse } from "next/server";
import { auditEvent, jsonError, requireActor } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type UserPayload = {
  actorUserId?: string;
  email?: string;
  name?: string;
  role?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UserPayload;
    const actorUserId = await requireActor(body.actorUserId);
    const email = body.email?.trim().toLowerCase();
    const name = body.name?.trim();
    const role = body.role?.trim() || "Reviewer";

    if (!email || !name || !email.includes("@")) {
      return jsonError("Valid name and email are required");
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
    return jsonError(error instanceof Error ? error.message : "Unable to save user", 500);
  }
}
