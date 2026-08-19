import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  expectedVersion: z.number().int().positive(),
  source: z.string().trim().min(1).max(120).optional(),
  referral: z.string().trim().max(160).nullable().optional(),
  consentStatus: z.enum(["unknown", "recorded", "declined"]).optional(),
  availabilityDate: z.string().date().nullable().optional(),
  noticePeriodDays: z.number().int().min(0).max(730).nullable().optional(),
  workModePreference: z.string().trim().max(80).nullable().optional(),
  currentCompensation: z.number().nonnegative().nullable().optional(),
  expectedCompensation: z.number().nonnegative().nullable().optional(),
  compensationCurrency: z.string().trim().length(3).optional(),
  screeningSuitability: z.enum(["strong", "mixed", "not_suitable"]).nullable().optional(),
  roleInterest: z.enum(["high", "medium", "low", "declined"]).nullable().optional(),
  locationConfirmed: z.boolean().nullable().optional(),
  followUpAt: z.string().datetime().nullable().optional(),
  ownerUserId: databaseId.nullable().optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "applications:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const current = await client.query<Record<string, unknown> & { version: number }>(
        "select * from applications where id=$1 and organization_id=$2 for update",
        [id, context.organization.id]
      );
      const row = current.rows[0];
      if (!row) throw new AtsError("Application not found", 404, "NOT_FOUND");
      if (row.version !== payload.expectedVersion) throw new AtsError("Application changed since you opened it", 409, "STALE_VERSION");
      if (payload.ownerUserId) {
        const owner = await client.query(
          `select memberships.user_id from organization_memberships memberships
           join app_users users on users.id=memberships.user_id
           where memberships.organization_id=$1 and memberships.user_id=$2
             and memberships.active=true and users.active=true`,
          [context.organization.id, payload.ownerUserId]
        );
        if (!owner.rowCount) throw new AtsError("Application owner must be an active organization member", 400, "INVALID_OWNER");
      }
      const value = <T,>(next: T | undefined, key: string) => next === undefined ? row[key] : next;
      const updated = await client.query<{ version: number }>(
        `update applications set source=$1, referral=$2, consent_status=$3, availability_date=$4,
          notice_period_days=$5, work_mode_preference=$6, current_compensation=$7, expected_compensation=$8,
          compensation_currency=$9, screening_suitability=$10, role_interest=$11, location_confirmed=$12,
          follow_up_at=$13, owner_user_id=$14, version=version+1, updated_at=now()
         where id=$15 returning version`,
        [
          value(payload.source, "source"), value(payload.referral, "referral"), value(payload.consentStatus, "consent_status"),
          value(payload.availabilityDate, "availability_date"), value(payload.noticePeriodDays, "notice_period_days"),
          value(payload.workModePreference, "work_mode_preference"), value(payload.currentCompensation, "current_compensation"),
          value(payload.expectedCompensation, "expected_compensation"),
          value(payload.compensationCurrency?.toUpperCase(), "compensation_currency"),
          value(payload.screeningSuitability, "screening_suitability"), value(payload.roleInterest, "role_interest"),
          value(payload.locationConfirmed, "location_confirmed"), value(payload.followUpAt, "follow_up_at"),
          value(payload.ownerUserId, "owner_user_id"), id
        ]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "application", aggregateId: id,
        eventType: "application.updated", actorUserId: context.user.id,
        data: { fields: Object.keys(payload).filter((key) => key !== "expectedVersion") }
      });
      return { version: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to update application");
  }
}
