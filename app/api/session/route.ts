import { NextResponse } from "next/server";
import { auditEvent, jsonError } from "@/lib/api-utils";
import { query } from "@/lib/db";
import type { User } from "@/lib/types";

export const runtime = "nodejs";

type LoginPayload = {
  email?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginPayload;
    const email = body.email?.trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return jsonError("Enter a valid email");
    }

    const result = await query<User>(
      `
      select id, email, name, role, active
      from app_users
      where lower(email) = lower($1) and active = true
      limit 1
      `,
      [email]
    );

    if (result.rowCount !== 1) {
      return jsonError("No active user exists for this email", 401);
    }

    const user = result.rows[0];
    await auditEvent({
      actorUserId: user.id,
      action: "login",
      payload: { email: user.email }
    });

    return NextResponse.json({ user });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to log in", 500);
  }
}
