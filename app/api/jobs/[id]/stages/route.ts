import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const schema = z.object({
  expectedJobVersion: z.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  stageKey: z.string().trim().regex(/^[a-z0-9_]+$/).max(80),
  kind: z.enum(["review", "phone_screen", "interview", "assessment", "offer"]),
  position: z.number().int().min(1).max(30),
  slaHours: z.number().int().min(1).max(8760).nullable().optional(),
  requiredScorecards: z.number().int().min(0).max(20).default(0),
  competencies: z.array(z.string().trim().min(1).max(160)).max(30).default([])
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "jobs:manage");
    const { id } = await params;
    const payload = schema.parse(await request.json());
    const result = await withTransaction(async (client) => {
      const job = await client.query<{ version: number }>(
        "select version from jobs where id=$1 and organization_id=$2 for update", [id, context.organization.id]
      );
      if (!job.rows[0]) throw new AtsError("Job not found", 404, "NOT_FOUND");
      if (job.rows[0].version !== payload.expectedJobVersion) throw new AtsError("Job changed since you opened it", 409, "STALE_VERSION");
      await client.query("update job_stages set position=position+1000 where job_id=$1 and position >= $2", [id, payload.position]);
      await client.query("update job_stages set position=position-999 where job_id=$1 and position >= $2", [id, payload.position + 1000]);
      const stage = await client.query<{ id: string }>(
        `insert into job_stages (job_id, stage_key, name, kind, position, sla_hours, required_scorecards, competency_template)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) returning id`,
        [id, payload.stageKey, payload.name, payload.kind, payload.position, payload.slaHours ?? null,
          payload.requiredScorecards, JSON.stringify(payload.competencies)]
      );
      const updated = await client.query<{ version: number }>(
        "update jobs set version=version+1, updated_at=now() where id=$1 returning version", [id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "job", aggregateId: id,
        eventType: "job.stage_added", actorUserId: context.user.id, data: { stage_id: stage.rows[0].id, name: payload.name }
      });
      return { id: stage.rows[0].id, jobVersion: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to add stage");
  }
}
