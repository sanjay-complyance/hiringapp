import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const providerSchema = z.enum(["openai", "anthropic"]);

export async function DELETE(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "providers:manage");
    const provider = providerSchema.parse((await params).provider);
    const result = await withTransaction(async (client) => {
      const deleted = await client.query<{ id: string }>(
        "delete from ai_connections where organization_id=$1 and provider=$2 returning id",
        [context.organization.id, provider]
      );
      if (!deleted.rows[0]) throw new AtsError("Provider connection not found", 404, "NOT_FOUND");
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "ai_connection", aggregateId: deleted.rows[0].id,
        eventType: "ai_connection.removed", actorUserId: context.user.id, data: { provider }
      });
      return { ok: true, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to remove provider");
  }
}
