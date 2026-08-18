import { NextResponse } from "next/server";
import { jsonFromError } from "@/lib/api-utils";
import { requireSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getAppData } from "@/lib/app-data";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireSessionUser(request);
    const url = new URL(request.url);
    const since = Number(url.searchParams.get("since") ?? 0);
    const includeData = url.searchParams.get("includeData") === "1";
    const result = await query<{ version: number }>(
      "select coalesce(max(id), 0)::int as version from audit_events where action <> 'login'"
    );
    const version = result.rows[0]?.version ?? 0;
    const changed = Number.isFinite(since) ? version > since : true;

    if (changed && includeData) {
      const data = await getAppData();
      return NextResponse.json(
        { version, changed, data },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json({
      version,
      changed
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return jsonFromError(error, "Unable to check sync state");
  }
}
