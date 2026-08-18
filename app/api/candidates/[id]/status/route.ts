import { NextResponse } from "next/server";
import { auditEvent, getCandidateId, jsonError, requireActor, statuses } from "@/lib/api-utils";
import { query } from "@/lib/db";
import type { CandidateWorkflow } from "@/lib/types";

export const runtime = "nodejs";

type StatusPayload = {
  actorUserId?: string;
  status?: CandidateWorkflow["status"];
  fromStatus?: CandidateWorkflow["status"];
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = await getCandidateId(context);
    const body = (await request.json()) as StatusPayload;
    const actorUserId = await requireActor(body.actorUserId);
    const status = body.status;

    if (!status || !statuses.has(status)) {
      return jsonError("Valid candidate status is required");
    }

    const current = await query<{ status: CandidateWorkflow["status"] }>("select status from candidates where id = $1", [id]);
    if (current.rowCount !== 1) return jsonError("Candidate not found", 404);

    await query("update candidates set status = $1, updated_at = now() where id = $2", [status, id]);
    await auditEvent({
      candidateId: id,
      actorUserId,
      action: "change_status",
      fromStatus: current.rows[0].status,
      toStatus: status,
      payload: { clientFromStatus: body.fromStatus ?? null }
    });

    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to update candidate status", 500);
  }
}
