import { NextResponse } from "next/server";
import { auditEvent, getCandidateId, jsonError, jsonFromError, requireActor } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

type ScorePayload = {
  roundId?: string;
  areaId?: string;
  score?: number;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = await getCandidateId(context);
    const body = (await request.json()) as ScorePayload;
    const actorUserId = await requireActor(request);
    const roundId = body.roundId?.trim();
    const areaId = body.areaId?.trim();
    const score = Number(body.score);

    if (!roundId || !areaId || !Number.isFinite(score) || score < 0) {
      return jsonError("Valid roundId, areaId, and score are required");
    }
    if (roundId.length > 80 || areaId.length > 120 || score > 100) {
      return jsonError("Round score input is out of range");
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
    return jsonFromError(error, "Unable to save round score");
  }
}
