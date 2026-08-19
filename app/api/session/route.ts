import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { clearSessionCookie, createSessionToken, getSessionUser, setSessionCookie } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/ats/authz";
import { jsonError, jsonFromError } from "@/lib/api-utils";
import { query } from "@/lib/db";
import type { User } from "@/lib/types";

export const runtime = "nodejs";

type LoginPayload = {
  email?: string;
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as LoginPayload;
    const email = body.email?.trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return jsonError("Enter a valid email");
    }

    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is required");
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const hash = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
    const ipHash = hash(ip);
    const emailHash = hash(email);
    const attempts = await query<{ count: number }>(
      `select count(*)::int as count from login_attempts
       where ip_hash = $1 and succeeded = false and created_at > now() - interval '15 minutes'`,
      [ipHash]
    );
    if ((attempts.rows[0]?.count ?? 0) >= 10) return jsonError("Too many login attempts. Try again later.", 429);

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
      await query("insert into login_attempts (email_hash, ip_hash, succeeded) values ($1, $2, false)", [emailHash, ipHash]);
      return jsonError("No active user exists for this email", 401);
    }

    const user = result.rows[0];
    await query("insert into login_attempts (email_hash, ip_hash, succeeded) values ($1, $2, true)", [emailHash, ipHash]);

    const response = NextResponse.json({ user });
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
    return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return jsonFromError(error, "Unable to read session");
  }
}

export async function DELETE(request: Request) {
  assertSameOrigin(request);
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
