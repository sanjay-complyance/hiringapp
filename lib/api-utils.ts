import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function jsonFromError(error: unknown, fallback: string) {
  if (error instanceof AuthError) return jsonError(error.message, error.status);
  if (error instanceof ZodError) {
    return NextResponse.json({
      error: "Invalid request data",
      code: "INVALID_PAYLOAD",
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    }, { status: 400 });
  }
  if (error instanceof Error && "status" in error && typeof error.status === "number") {
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return NextResponse.json({ error: error.message, ...(code ? { code } : {}) }, { status: error.status });
  }
  return jsonError(fallback, 500);
}
