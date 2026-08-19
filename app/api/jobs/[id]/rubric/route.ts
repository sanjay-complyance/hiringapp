import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import { jsonFromError } from "@/lib/api-utils";

export const runtime = "nodejs";

const criterion = z.object({
  id: z.string().trim().regex(/^[a-z0-9_]+$/).max(80),
  label: z.string().trim().min(2).max(180),
  max: z.number().int().min(0).max(20),
  hard: z.boolean().default(false)
}).refine((value) => value.hard || value.max > 0, { message: "Scored criteria need at least one point", path: ["max"] });
const schema = z.object({
  expectedJobVersion: z.number().int().positive(),
  name: z.string().trim().min(2).max(180),
  criteria: z.array(criterion).min(1).max(20)
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
      await client.query("update rubric_versions set is_active=false where job_id=$1 and is_active=true", [id]);
      const rubric = await client.query<{ id: string; version_number: number }>(
        `insert into rubric_versions (job_id, version_number, name, criteria, created_by)
         select $1, coalesce(max(version_number),0)+1, $2, $3::jsonb, $4 from rubric_versions where job_id=$1
         returning id, version_number`,
        [id, payload.name, JSON.stringify(payload.criteria), context.user.id]
      );
      const updated = await client.query<{ version: number }>(
        "update jobs set version=version+1, updated_at=now() where id=$1 returning version", [id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "job", aggregateId: id,
        eventType: "job.rubric_version_created", actorUserId: context.user.id,
        data: { rubric_id: rubric.rows[0].id, version: rubric.rows[0].version_number }
      });
      return { ...rubric.rows[0], jobVersion: updated.rows[0].version, eventId };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to create rubric version");
  }
}
