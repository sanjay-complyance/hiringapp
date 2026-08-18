import { NextResponse } from "next/server";
import { auditEvent, getCandidateId, jsonError, requireActor } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type RoundNotePayload = {
  actorUserId?: string;
  roundId?: string;
  note?: string;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = await getCandidateId(context);
    const body = (await request.json()) as RoundNotePayload;
    const actorUserId = await requireActor(body.actorUserId);
    const roundId = body.roundId?.trim();
    const note = body.note ?? "";

    if (!roundId) return jsonError("roundId is required");

    await query(
      `
      insert into round_notes (candidate_id, round_id, note, updated_by)
      values ($1, $2, $3, $4)
      on conflict (candidate_id, round_id)
      do update set note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
      `,
      [id, roundId, note, actorUserId]
    );
    await auditEvent({
      candidateId: id,
      actorUserId,
      action: "update_round_note",
      payload: { roundId, preview: note.slice(0, 140) }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to save round note", 500);
  }
}
