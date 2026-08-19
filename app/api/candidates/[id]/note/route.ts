import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  expectedCandidateVersion: z.number().int().positive(),
  body: z.string().trim().min(1).max(5000)
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "applications:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const candidate = await client.query<{ version: number }>(
        "select version from candidates where id=$1 and organization_id=$2 for update",
        [id, context.organization.id]
      );
      if (!candidate.rows[0]) throw new AtsError("Candidate not found", 404, "NOT_FOUND");
      if (candidate.rows[0].version !== payload.expectedCandidateVersion) {
        throw new AtsError("Candidate changed since you opened it", 409, "STALE_VERSION");
      }
      const note = await client.query<{ id: string }>(
        "insert into candidate_notes (candidate_id, author_user_id, body) values ($1,$2,$3) returning id::text",
        [id, context.user.id, payload.body]
      );
      const updated = await client.query<{ version: number }>(
        "update candidates set version=version+1, updated_at=now() where id=$1 returning version", [id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id,
        aggregateType: "candidate",
        aggregateId: id,
        eventType: "candidate.note_added",
        actorUserId: context.user.id,
        data: { note_id: note.rows[0].id }
      });
      return { id: note.rows[0].id, candidateVersion: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to add note");
  }
}
