import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { User } from "@/lib/types";

export const sessionCookieName = "hiring_session";

const sessionMaxAgeSeconds = 60 * 60 * 24 * 14;

type SessionPayload = {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  nonce: string;
};

export class AuthError extends Error {
  status = 401;

  constructor(message = "Login is required") {
    super(message);
  }
}

function authSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.DATABASE_URL;
  if (!secret) {
    throw new Error("AUTH_SECRET or DATABASE_URL is required for session signing");
  }
  return secret;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function cookieValue(header: string | null, name: string) {
  if (!header) return null;
  const prefix = `${name}=`;
  return (
    header
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) ?? null
  );
}

function verifyToken(token: string): SessionPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = sign(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.sub || !payload.email || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSessionToken(user: Pick<User, "id" | "email">) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    iat: now,
    exp: now + sessionMaxAgeSeconds,
    nonce: randomBytes(16).toString("base64url")
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function getSessionUserFromCookieHeader(cookieHeader: string | null): Promise<User | null> {
  const token = cookieValue(cookieHeader, sessionCookieName);
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  const result = await query<User>(
    `
    select id, email, name, role, active
    from app_users
    where id = $1 and active = true
    limit 1
    `,
    [payload.sub]
  );

  return result.rows[0] ?? null;
}

export async function getSessionUser(request: Request): Promise<User | null> {
  return getSessionUserFromCookieHeader(request.headers.get("cookie"));
}

export async function requireSessionUser(request: Request) {
  const user = await getSessionUser(request);
  if (!user) throw new AuthError();
  return user;
}
