import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  channel: z.enum(["call", "email", "message", "meeting"]),
  direction: z.enum(["inbound", "outbound", "internal"]).default("outbound"),
  subject: z.string().trim().max(240).optional().nullable(),
  body: z.string().trim().min(2).max(10000),
  occurredAt: z.string().datetime().optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "applications:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const application = await client.query<{ id: string }>(
        "select id from applications where id=$1 and organization_id=$2",
        [id, context.organization.id]
      );
      if (!application.rows[0]) throw new AtsError("Application not found", 404, "NOT_FOUND");
      const inserted = await client.query<{ id: string }>(
        `insert into communications (organization_id, application_id, channel, direction, subject, body, occurred_at, created_by)
         values ($1,$2,$3,$4,$5,$6,coalesce($7::timestamptz, now()),$8) returning id`,
        [context.organization.id, id, payload.channel, payload.direction, payload.subject || null, payload.body,
          payload.occurredAt || null, context.user.id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "application", aggregateId: id,
        eventType: "communication.logged", actorUserId: context.user.id,
        data: { channel: payload.channel, direction: payload.direction }
      });
      return { id: inserted.rows[0].id, eventId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to log communication");
  }
}
