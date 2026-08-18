import { NextResponse } from "next/server";
import { auditEvent, getCandidateId, jsonError, requireActor } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type ScorePayload = {
  actorUserId?: string;
  roundId?: string;
  areaId?: string;
  score?: number;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = await getCandidateId(context);
    const body = (await request.json()) as ScorePayload;
    const actorUserId = await requireActor(body.actorUserId);
    const roundId = body.roundId?.trim();
    const areaId = body.areaId?.trim();
    const score = Number(body.score);

    if (!roundId || !areaId || !Number.isFinite(score) || score < 0) {
      return jsonError("Valid roundId, areaId, and score are required");
    }

    await query(
      `
      insert into round_scores (candidate_id, round_id, area_id, score, updated_by)
      values ($1, $2, $3, $4, $5)
      on conflict (candidate_id, round_id, area_id)
      do update set score = excluded.score, updated_by = excluded.updated_by, updated_at = now()
      `,
      [id, roundId, areaId, Math.round(score), actorUserId]
    );
    await auditEvent({
      candidateId: id,
      actorUserId,
      action: "update_round_score",
      payload: { roundId, areaId, score: Math.round(score) }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to save round score", 500);
  }
}
