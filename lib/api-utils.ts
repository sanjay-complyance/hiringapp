import { NextResponse } from "next/server";
import { AuthError, requireSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import type { CandidateWorkflow, User } from "@/lib/types";

export const statuses = new Set<CandidateWorkflow["status"]>([
  "new",
  "round1",
  "round2",
  "round3",
  "round4",
  "references",
  "hire",
  "no_hire",
  "hold"
]);

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function jsonFromError(error: unknown, fallback: string) {
  if (error instanceof AuthError) return jsonError(error.message, error.status);
  return jsonError(error instanceof Error ? error.message : fallback, 500);
}

export async function getCandidateId(context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  return decodeURIComponent(params.id);
}

export async function requireActor(request: Request) {
  const user = await requireSessionUser(request);
  return user.id;
}

export function canManageUsers(user: Pick<User, "role">) {
  const role = user.role.toLowerCase();
  return role.includes("founder") || role.includes("hr") || role.includes("owner");
}

export async function auditEvent({
  candidateId,
  actorUserId,
  action,
  fromStatus,
  toStatus,
  payload = {}
}: {
  candidateId?: string | null;
  actorUserId: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  payload?: Record<string, unknown>;
}) {
  await query(
    `
    insert into audit_events (candidate_id, actor_user_id, action, from_status, to_status, payload)
    values ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [candidateId ?? null, actorUserId, action, fromStatus ?? null, toStatus ?? null, JSON.stringify(payload)]
  );
}
