import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  expectedVersion: z.number().int().positive(),
  status: z.enum(["draft", "scheduled", "completed", "cancelled"]),
  reason: z.string().trim().max(1000).optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "interviews:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    if (payload.status === "cancelled" && !payload.reason) throw new AtsError("Cancellation reason is required", 400, "REASON_REQUIRED");
    const result = await withTransaction(async (client) => {
      const current = await client.query<{ status: string; version: number }>(
        "select status, version from interviews where id=$1 and organization_id=$2 for update",
        [id, context.organization.id]
      );
      if (!current.rows[0]) throw new AtsError("Interview not found", 404, "NOT_FOUND");
      if (current.rows[0].version !== payload.expectedVersion) throw new AtsError("Interview changed since you opened it", 409, "STALE_VERSION");
      const updated = await client.query<{ version: number }>(
        "update interviews set status=$1, version=version+1, updated_at=now() where id=$2 returning version",
        [payload.status, id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "interview", aggregateId: id,
        eventType: `interview.${payload.status}`, actorUserId: context.user.id,
        data: { from: current.rows[0].status, reason: payload.reason ?? null }
      });
      return { status: payload.status, version: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to update interview");
  }
}
