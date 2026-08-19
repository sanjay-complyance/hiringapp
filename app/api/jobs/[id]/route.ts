import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const updateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(2).max(160).optional(),
  code: z.string().trim().max(40).nullable().optional(),
  department: z.string().trim().min(2).max(120).optional(),
  businessReason: z.string().trim().min(10).max(2000).optional(),
  openings: z.number().int().min(1).max(100).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  targetDate: z.string().date().nullable().optional(),
  employmentType: z.string().trim().min(2).max(60).optional(),
  location: z.string().trim().max(160).optional(),
  workMode: z.enum(["onsite", "hybrid", "remote"]).optional(),
  compensationMin: z.number().nonnegative().nullable().optional(),
  compensationMax: z.number().nonnegative().nullable().optional(),
  compensationCurrency: z.string().trim().length(3).optional(),
  hiringManagerId: databaseId.nullable().optional(),
  recruiterId: databaseId.nullable().optional()
}).refine((value) => value.compensationMin == null || value.compensationMax == null || value.compensationMin <= value.compensationMax, {
  message: "Minimum compensation must not exceed maximum compensation",
  path: ["compensationMin"]
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "jobs:manage");
    const { id } = await params;
    const payload = updateSchema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const current = await client.query<Record<string, unknown> & { version: number; state: string }>(
        "select * from jobs where id = $1 and organization_id = $2 for update",
        [id, context.organization.id]
      );
      if (!current.rows[0]) throw new AtsError("Job not found", 404, "NOT_FOUND");
      if (current.rows[0].version !== payload.expectedVersion) throw new AtsError("Job changed since you opened it", 409, "STALE_VERSION");
      if (!["draft", "paused", "open"].includes(current.rows[0].state)) {
        throw new AtsError("This job cannot be edited in its current state", 409, "INVALID_STATE");
      }
      const assignedUserIds = [...new Set([payload.hiringManagerId, payload.recruiterId].filter(Boolean))] as string[];
      if (assignedUserIds.length) {
        const assignedMembers = await client.query<{ count: number }>(
          `select count(*)::int as count from organization_memberships memberships
           join app_users users on users.id=memberships.user_id
           where memberships.organization_id=$1 and memberships.active=true and users.active=true
             and memberships.user_id=any($2::uuid[])`,
          [context.organization.id, assignedUserIds]
        );
        if ((assignedMembers.rows[0]?.count ?? 0) !== assignedUserIds.length) {
          throw new AtsError("Hiring manager and recruiter must be active organization members", 400, "INVALID_ASSIGNEE");
        }
      }
      const next = {
        title: payload.title ?? current.rows[0].title,
        code: payload.code === undefined ? current.rows[0].code : payload.code,
        department: payload.department ?? current.rows[0].department,
        businessReason: payload.businessReason ?? current.rows[0].business_reason,
        openings: payload.openings ?? current.rows[0].openings,
        priority: payload.priority ?? current.rows[0].priority,
        targetDate: payload.targetDate === undefined ? current.rows[0].target_date : payload.targetDate,
        employmentType: payload.employmentType ?? current.rows[0].employment_type,
        location: payload.location ?? current.rows[0].location,
        workMode: payload.workMode ?? current.rows[0].work_mode,
        compensationMin: payload.compensationMin === undefined ? current.rows[0].compensation_min : payload.compensationMin,
        compensationMax: payload.compensationMax === undefined ? current.rows[0].compensation_max : payload.compensationMax,
        compensationCurrency: payload.compensationCurrency?.toUpperCase() ?? current.rows[0].compensation_currency,
        hiringManagerId: payload.hiringManagerId === undefined ? current.rows[0].hiring_manager_id : payload.hiringManagerId,
        recruiterId: payload.recruiterId === undefined ? current.rows[0].recruiter_id : payload.recruiterId
      };
      if (next.compensationMin != null && next.compensationMax != null && Number(next.compensationMin) > Number(next.compensationMax)) {
        throw new AtsError("Minimum compensation must not exceed maximum compensation", 400, "INVALID_COMPENSATION");
      }
      const updated = await client.query<{ version: number }>(
        `update jobs set title=$1, code=$2, department=$3, business_reason=$4, openings=$5, priority=$6, target_date=$7,
          employment_type=$8, location=$9, work_mode=$10, compensation_min=$11, compensation_max=$12,
          compensation_currency=$13, hiring_manager_id=$14, recruiter_id=$15, version=version+1, updated_at=now()
         where id=$16 returning version`,
        [next.title, next.code || null, next.department, next.businessReason, next.openings, next.priority, next.targetDate,
          next.employmentType, next.location, next.workMode, next.compensationMin, next.compensationMax,
          next.compensationCurrency, next.hiringManagerId, next.recruiterId, id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "job", aggregateId: id,
        eventType: "job.updated", actorUserId: context.user.id,
        data: { fields: Object.keys(payload).filter((key) => key !== "expectedVersion") }
      });
      return { version: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to update job");
  }
}
