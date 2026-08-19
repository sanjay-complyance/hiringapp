import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { databaseId } from "@/lib/ats/validation";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const createJobSchema = z.object({
  title: z.string().trim().min(2).max(160),
  code: z.string().trim().max(40).optional().nullable(),
  department: z.string().trim().min(2).max(120),
  businessReason: z.string().trim().min(10).max(2000),
  openings: z.coerce.number().int().min(1).max(100).default(1),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  hiringManagerId: databaseId.optional().nullable(),
  recruiterId: databaseId.optional().nullable(),
  targetDate: z.string().date().optional().nullable(),
  employmentType: z.string().trim().max(60).default("full_time"),
  location: z.string().trim().max(160).default(""),
  workMode: z.enum(["onsite", "hybrid", "remote"]).default("hybrid"),
  compensationMin: z.coerce.number().nonnegative().optional().nullable(),
  compensationMax: z.coerce.number().nonnegative().optional().nullable(),
  compensationCurrency: z.string().trim().length(3).default("INR"),
  templateId: databaseId.optional().nullable()
}).refine((value) => value.compensationMin == null || value.compensationMax == null || value.compensationMin <= value.compensationMax, {
  message: "Minimum compensation must not exceed maximum compensation",
  path: ["compensationMin"]
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "jobs:create");
    const payload = createJobSchema.parse(await request.json());
    const job = await withTransaction(async (client) => {
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
      const template = payload.templateId
        ? await client.query<{ id: string }>(
            "select id from pipeline_templates where id = $1 and organization_id = $2",
            [payload.templateId, context.organization.id]
          )
        : await client.query<{ id: string }>(
            "select id from pipeline_templates where organization_id = $1 and is_default = true order by created_at limit 1",
            [context.organization.id]
          );
      if (!template.rows[0]) throw new Error("A pipeline template is required");

      const inserted = await client.query<{ id: string; version: number }>(
        `insert into jobs (
          organization_id, title, code, department, business_reason, openings, priority, hiring_manager_id,
          recruiter_id, target_date, employment_type, location, work_mode, compensation_min,
          compensation_max, compensation_currency, created_by
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        returning id, version`,
        [
          context.organization.id, payload.title, payload.code || null, payload.department, payload.businessReason,
          payload.openings, payload.priority, payload.hiringManagerId || null, payload.recruiterId || null,
          payload.targetDate || null, payload.employmentType, payload.location, payload.workMode,
          payload.compensationMin ?? null, payload.compensationMax ?? null, payload.compensationCurrency.toUpperCase(),
          context.user.id
        ]
      );
      const row = inserted.rows[0];
      await client.query(
        `insert into job_stages (job_id, stage_key, name, kind, position, sla_hours, required_scorecards, competency_template)
         select $1, stage_key, name, kind, position, sla_hours, required_scorecards, competency_template
         from pipeline_template_stages where template_id = $2 order by position`,
        [row.id, template.rows[0].id]
      );
      await client.query(
        `insert into rubric_versions (job_id, version_number, name, criteria, created_by)
         values ($1, 1, 'Initial job rubric', $2::jsonb, $3)`,
        [
          row.id,
          JSON.stringify([
            { id: "role_fit", label: "Role-specific evidence", max: 5 },
            { id: "delivery", label: "Delivery and execution", max: 5 },
            { id: "technical_depth", label: "Technical or functional depth", max: 5 },
            { id: "ownership", label: "Ownership and communication", max: 5 }
          ]),
          context.user.id
        ]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id,
        aggregateType: "job",
        aggregateId: row.id,
        eventType: "job.created",
        actorUserId: context.user.id,
        data: { title: payload.title, state: "draft" }
      });
      return { ...row, eventId };
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to create job");
  }
}
