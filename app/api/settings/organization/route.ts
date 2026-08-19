import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  retentionDays: z.number().int().min(30).max(3650).nullable().optional(),
  aiMonthlyTokenLimit: z.number().int().min(0).max(1_000_000_000).optional()
});

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "org:manage");
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const updated = await client.query<{ retention_days: number | null; ai_monthly_token_limit: string }>(
        `update organizations set retention_days=case when $1 then $2 else retention_days end,
          ai_monthly_token_limit=case when $3 then $4 else ai_monthly_token_limit end, updated_at=now()
         where id=$5 returning retention_days, ai_monthly_token_limit::text`,
        [payload.retentionDays !== undefined, payload.retentionDays ?? null,
          payload.aiMonthlyTokenLimit !== undefined, payload.aiMonthlyTokenLimit ?? null, context.organization.id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "organization", aggregateId: context.organization.id,
        eventType: "organization.settings_updated", actorUserId: context.user.id,
        data: { fields: Object.keys(payload) }
      });
      return { ...updated.rows[0], eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to update organization settings");
  }
}
