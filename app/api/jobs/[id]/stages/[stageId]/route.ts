import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  expectedJobVersion: z.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["review", "phone_screen", "interview", "assessment", "offer"]),
  slaHours: z.number().int().min(1).max(8760).nullable(),
  requiredScorecards: z.number().int().min(0).max(20),
  competencies: z.array(z.string().trim().min(1).max(160)).max(30)
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; stageId: string }> }
) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "jobs:manage");
    const { id, stageId } = await params;
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const job = await client.query<{ version: number }>(
        "select version from jobs where id=$1 and organization_id=$2 for update",
        [id, context.organization.id]
      );
      if (!job.rows[0]) throw new AtsError("Job not found", 404, "NOT_FOUND");
      if (job.rows[0].version !== payload.expectedJobVersion) {
        throw new AtsError("Job changed since you opened it", 409, "STALE_VERSION");
      }
      const updatedStage = await client.query<{ id: string }>(
        `update job_stages set name=$1, kind=$2, sla_hours=$3, required_scorecards=$4,
          competency_template=$5::jsonb
         where id=$6 and job_id=$7 and archived_at is null returning id`,
        [payload.name, payload.kind, payload.slaHours, payload.requiredScorecards,
          JSON.stringify(payload.competencies), stageId, id]
      );
      if (!updatedStage.rows[0]) throw new AtsError("Pipeline stage not found", 404, "NOT_FOUND");
      const updatedJob = await client.query<{ version: number }>(
        "update jobs set version=version+1, updated_at=now() where id=$1 returning version", [id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id,
        aggregateType: "job",
        aggregateId: id,
        eventType: "job.stage_updated",
        actorUserId: context.user.id,
        data: { stage_id: stageId, fields: ["name", "kind", "sla_hours", "required_scorecards", "competencies"] }
      });
      return { id: stageId, jobVersion: updatedJob.rows[0].version, eventId };
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonFromError(error, "Unable to update stage");
  }
}
