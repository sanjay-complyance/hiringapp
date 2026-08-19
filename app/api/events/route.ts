import { NextResponse } from "next/server";
import { requireApiContext } from "@/lib/ats/authz";
import { jsonFromError } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requireApiContext(request, "candidates:read");
    const url = new URL(request.url);
    if (url.searchParams.get("latest") === "1") {
      const current = await query<{ cursor: string }>(
        "select coalesce(max(id), 0)::text as cursor from domain_events where organization_id = $1",
        [context.organization.id]
      );
      return NextResponse.json({ cursor: Number(current.rows[0]?.cursor ?? 0), events: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const since = Math.max(0, Number(url.searchParams.get("since") || 0) || 0);
    const result = await query<{
      id: string;
      aggregate_type: string;
      aggregate_id: string;
      event_type: string;
      created_at: string;
    }>(
      `select id::text, aggregate_type, aggregate_id, event_type, created_at::text
       from domain_events
       where organization_id = $1 and id > $2
       order by id asc
       limit 100`,
      [context.organization.id, since]
    );
    const latest = result.rows.length ? Number(result.rows[result.rows.length - 1].id) : since;
    return NextResponse.json(
      { cursor: latest, events: result.rows },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    return jsonFromError(error, "Unable to sync changes");
  }
}
