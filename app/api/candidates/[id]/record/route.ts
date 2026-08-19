import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({ action: z.enum(["archive", "restore", "delete"]), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(5).max(1000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const permission = payload.action === "delete" ? "data:delete" as const : "candidates:manage" as const;
    const context = await requireApiContext(request, permission);
    const result = await withTransaction(async (client) => {
      const current = await client.query<{ name: string; version: number; archived_at: string | null }>(
        "select name, version, archived_at::text from candidates where id=$1 and organization_id=$2 for update",
        [id, context.organization.id]
      );
      const row = current.rows[0];
      if (!row) throw new AtsError("Candidate not found", 404, "NOT_FOUND");
      if (row.version !== payload.expectedVersion) throw new AtsError("Candidate changed since you opened it", 409, "STALE_VERSION");
      if (payload.action === "delete") {
        if (!row.archived_at) throw new AtsError("Archive the candidate before permanent deletion", 409, "ARCHIVE_REQUIRED");
        await recordEvent(client, {
          organizationId: context.organization.id, aggregateType: "candidate", aggregateId: id,
          eventType: "candidate.deleted", actorUserId: context.user.id, data: { reason: payload.reason }
        });
        await client.query("delete from applications where candidate_id=$1 and organization_id=$2", [id, context.organization.id]);
        await client.query("delete from candidates where id=$1", [id]);
        return { deleted: true };
      }
      const archived = payload.action === "archive";
      const updated = await client.query<{ version: number }>(
        "update candidates set archived_at=case when $1 then now() else null end, version=version+1, updated_at=now() where id=$2 returning version",
        [archived, id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "candidate", aggregateId: id,
        eventType: archived ? "candidate.archived" : "candidate.restored", actorUserId: context.user.id,
        data: { reason: payload.reason }
      });
      return { archived, version: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to update candidate record");
  }
}
