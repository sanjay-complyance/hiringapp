import { NextResponse } from "next/server";
import { clearSessionCookie, createSessionToken, getSessionUser, setSessionCookie } from "@/lib/auth";
import { auditEvent, jsonError, jsonFromError } from "@/lib/api-utils";
import { getAppData } from "@/lib/app-data";
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

    const data = await getAppData();
    const response = NextResponse.json({ user, data });
    setSessionCookie(response, createSessionToken(user));
    return response;
  } catch (error) {
    return jsonFromError(error, "Unable to log in");
  }
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return jsonError("Login is required", 401);
    const data = await getAppData();
    return NextResponse.json({ user, data }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return jsonFromError(error, "Unable to read session");
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
