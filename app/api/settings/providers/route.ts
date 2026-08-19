import { NextResponse } from "next/server";
import { z } from "zod";
import { recruitingAgent } from "@/lib/ats/agent";
import { assertSameOrigin, requireApiContext } from "@/lib/ats/authz";
import { encryptCredential } from "@/lib/ats/crypto";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  apiKey: z.string().trim().min(20).max(500),
  model: z.string().trim().min(3).max(120)
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "providers:manage");
    const payload = schema.parse(await request.json());
    try {
      await recruitingAgent(payload.provider).testConnection({ apiKey: payload.apiKey, model: payload.model });
    } catch {
      return NextResponse.json({ error: "The provider rejected this key or model", code: "PROVIDER_TEST_FAILED" }, { status: 400 });
    }
    const result = await withTransaction(async (client) => {
      const connection = await client.query<{ id: string }>(
        `insert into ai_connections (organization_id, provider, encrypted_key, key_last_four, model, status, last_tested_at, created_by)
         values ($1,$2,$3,$4,$5,'active',now(),$6)
         on conflict (organization_id, provider) do update set encrypted_key=excluded.encrypted_key,
           key_last_four=excluded.key_last_four, model=excluded.model, status='active', last_tested_at=now(), updated_at=now()
         returning id`,
        [context.organization.id, payload.provider, encryptCredential(payload.apiKey), payload.apiKey.slice(-4), payload.model, context.user.id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "ai_connection", aggregateId: connection.rows[0].id,
        eventType: "ai_connection.saved", actorUserId: context.user.id,
        data: { provider: payload.provider, model: payload.model }
      });
      return { id: connection.rows[0].id, provider: payload.provider, model: payload.model, keyLastFour: payload.apiKey.slice(-4), eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to connect provider");
  }
}
