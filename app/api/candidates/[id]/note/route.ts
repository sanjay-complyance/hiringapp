import { NextResponse } from "next/server";
import { auditEvent, getCandidateId, jsonError, requireActor } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type NotePayload = {
  actorUserId?: string;
  body?: string;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = await getCandidateId(context);
    const body = (await request.json()) as NotePayload;
    const actorUserId = await requireActor(body.actorUserId);
    const note = body.body?.trim();

    if (!note) return jsonError("Note cannot be empty");

    const candidate = await query("select id from candidates where id = $1", [id]);
    if (candidate.rowCount !== 1) return jsonError("Candidate not found", 404);

    await query("insert into candidate_notes (candidate_id, author_user_id, body) values ($1, $2, $3)", [id, actorUserId, note]);
    await auditEvent({
      candidateId: id,
      actorUserId,
      action: "add_candidate_note",
      payload: { preview: note.slice(0, 140) }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to save candidate note", 500);
  }
}
