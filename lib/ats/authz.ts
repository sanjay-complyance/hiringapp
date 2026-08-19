import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUserFromCookieHeader, requireSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import type { MembershipContext, MembershipRole, Permission } from "@/lib/ats/types";
import { hasPermission } from "@/lib/ats/permissions";

export { hasPermission } from "@/lib/ats/permissions";

export class AtsError extends Error {
  constructor(message: string, public status = 400, public code = "BAD_REQUEST") {
    super(message);
  }
}

async function contextForUser(user: MembershipContext["user"]): Promise<MembershipContext | null> {
  const result = await query<{
    role: MembershipRole;
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    retention_days: number | null;
    ai_monthly_token_limit: string;
  }>(
    `
      select memberships.role, organizations.id as organization_id, organizations.name as organization_name,
        organizations.slug as organization_slug, organizations.retention_days,
        organizations.ai_monthly_token_limit::text
      from organization_memberships memberships
      join organizations on organizations.id = memberships.organization_id
      where memberships.user_id = $1 and memberships.active = true
      order by memberships.created_at asc
      limit 1
    `,
    [user.id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    user,
    role: row.role,
    organization: {
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
      retention_days: row.retention_days,
      ai_monthly_token_limit: Number(row.ai_monthly_token_limit)
    }
  };
}

export async function requirePageContext(permission?: Permission) {
  const requestHeaders = await headers();
  const user = await getSessionUserFromCookieHeader(requestHeaders.get("cookie"));
  if (!user) redirect("/");
  const context = await contextForUser(user);
  if (!context) redirect("/");
  if (permission && !hasPermission(context.role, permission)) redirect("/dashboard");
  return context;
}

export async function requireApiContext(request: Request, permission?: Permission) {
  const user = await requireSessionUser(request);
  const context = await contextForUser(user);
  if (!context) throw new AtsError("No active organization membership", 403, "NO_MEMBERSHIP");
  if (permission && !hasPermission(context.role, permission)) {
    throw new AtsError("You do not have permission for this action", 403, "FORBIDDEN");
  }
  return context;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (new URL(origin).origin !== new URL(request.url).origin) {
    throw new AtsError("Cross-origin mutation rejected", 403, "BAD_ORIGIN");
  }
}
