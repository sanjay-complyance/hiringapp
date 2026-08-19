import { NextResponse } from "next/server";
import { AtsError, requireApiContext } from "@/lib/ats/authz";
import { jsonFromError } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await requireApiContext(request, "data:export");
    const { id } = await params;
    const candidate = await query<{ id: string; name: string; profile: Record<string, unknown>; created_at: string }>(
      "select id, name, profile, created_at::text from candidates where id=$1 and organization_id=$2",
      [id, context.organization.id]
    );
    if (!candidate.rows[0]) throw new AtsError("Candidate not found", 404, "NOT_FOUND");
    const [applications, communications, interviews, tasks, documents] = await Promise.all([
      query("select id, job_id, state, source, consent_status, applied_at, decided_at from applications where candidate_id=$1 and organization_id=$2", [id, context.organization.id]),
      query("select channel, direction, subject, body, occurred_at from communications where application_id in (select id from applications where candidate_id=$1 and organization_id=$2)", [id, context.organization.id]),
      query("select title, kind, status, starts_at, ends_at from interviews where application_id in (select id from applications where candidate_id=$1 and organization_id=$2)", [id, context.organization.id]),
      query("select title, description, status, due_at from hiring_tasks where application_id in (select id from applications where candidate_id=$1 and organization_id=$2)", [id, context.organization.id]),
      query("select coalesce(original_file_name,file_name) as file_name, content_type, size_bytes, sha256, created_at from resume_files where candidate_id=$1 and organization_id=$2", [id, context.organization.id])
    ]);
    const payload = { exportedAt: new Date().toISOString(), candidate: candidate.rows[0], applications: applications.rows, communications: communications.rows, interviews: interviews.rows, tasks: tasks.rows, documents: documents.rows };
    const safeName = candidate.rows[0].name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    return NextResponse.json(payload, { headers: { "Content-Disposition": `attachment; filename="${safeName || "candidate"}-export.json"`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonFromError(error, "Unable to export candidate");
  }
}
