import { NextResponse } from "next/server";
import { auditEvent, getCandidateId, jsonError, jsonFromError, requireActor } from "@/lib/api-utils";
import { query, requireUser } from "@/lib/db";

export const runtime = "nodejs";

type OwnerPayload = {
  ownerUserId?: string;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = await getCandidateId(context);
    const body = (await request.json()) as OwnerPayload;
    const actorUserId = await requireActor(request);
    const ownerUserId = body.ownerUserId?.trim() || null;
    if (ownerUserId && ownerUserId.length > 80) return jsonError("Invalid owner");

    if (ownerUserId) await requireUser(ownerUserId);

    const result = await query("update candidates set owner_user_id = $1, updated_at = now() where id = $2", [ownerUserId, id]);
    if (result.rowCount !== 1) return jsonError("Candidate not found", 404);

    await auditEvent({
      candidateId: id,
      actorUserId,
      action: "assign_owner",
      payload: { ownerUserId }
    });

    return NextResponse.json({ ok: true, ownerUserId });
  } catch (error) {
    return jsonFromError(error, "Unable to update candidate owner");
  }
}
