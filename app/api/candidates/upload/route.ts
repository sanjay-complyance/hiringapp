import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertSameOrigin, AtsError, requireApiContext } from "@/lib/ats/authz";
import { recordEvent, withTransaction } from "@/lib/ats/events";
import {
  deterministicResumeAnalysis, extractResumeText, inferName, maxResumeBytes, normalizedIdentity, safeFileName,
  scoreResumeForRubric, type ResumeRubricCriterion
} from "@/lib/ats/resume";
import { jsonError, jsonFromError } from "@/lib/api-utils";
import { query } from "@/lib/db";

export const runtime = "nodejs";

function fileKind(fileName: string, bytes: Buffer) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") && bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { extension: "pdf" as const, contentType: "application/pdf" };
  }
  if (lower.endsWith(".docx") && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return { extension: "docx" as const, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }
  return null;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext(request, "candidates:manage");
    const form = await request.formData();
    const resume = form.get("resume");
    const jobId = String(form.get("jobId") || "");
    const submittedName = typeof form.get("name") === "string" ? String(form.get("name")) : null;
    const duplicateCandidateId = typeof form.get("duplicateCandidateId") === "string" ? String(form.get("duplicateCandidateId")) : null;
    const createSeparate = form.get("createSeparate") === "true";
    const source = String(form.get("source") || "direct").trim().slice(0, 120);
    if (!(resume instanceof File) || resume.size === 0) return jsonError("A resume is required");
    if (resume.size > maxResumeBytes) return jsonError("Resume must be 8 MB or smaller");
    if (!jobId) return jsonError("Select a job for this application");

    const bytes = Buffer.from(await resume.arrayBuffer());
    const kind = fileKind(resume.name, bytes);
    if (!kind) return jsonError("Upload a valid PDF or DOCX file");
    const text = await extractResumeText(bytes, kind.extension);
    const originalName = safeFileName(resume.name) || `resume.${kind.extension}`;
    const name = inferName(text, originalName, submittedName);
    if (name.length > 160) return jsonError("Candidate name is too long");
    const analysis = deterministicResumeAnalysis(text);
    const identity = normalizedIdentity(name, analysis.contacts);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const job = await query<{ id: string }>(
      "select id from jobs where id=$1 and organization_id=$2 and state in ('open','draft')",
      [jobId, context.organization.id]
    );
    if (!job.rows[0]) return jsonError("Job not found or not accepting candidates", 404);

    const duplicates = await query<{ id: string; name: string; reason: string }>(
      `select distinct candidates.id, candidates.name,
        concat_ws(', ',
          case when documents.sha256=$2 then 'same file' end,
          case when $3::text is not null and candidates.normalized_email=$3 then 'same email' end,
          case when $4::text is not null and candidates.normalized_phone=$4 then 'same phone' end,
          case when candidates.normalized_name=$5 then 'same name' end
        ) as reason
       from candidates left join resume_files documents on documents.candidate_id=candidates.id and documents.archived_at is null
       where candidates.organization_id=$1 and (
         documents.sha256=$2 or ($3::text is not null and candidates.normalized_email=$3) or
         ($4::text is not null and candidates.normalized_phone=$4) or candidates.normalized_name=$5
       ) order by candidates.name limit 8`,
      [context.organization.id, sha256, identity.email, identity.phone, identity.name]
    );
    if (duplicates.rows.length && !createSeparate && !duplicates.rows.some((item) => item.id === duplicateCandidateId)) {
      return NextResponse.json({ error: "Possible duplicate candidate", code: "DUPLICATE_CANDIDATE", matches: duplicates.rows }, { status: 409 });
    }

    const result = await withTransaction(async (client) => {
      let candidateId = duplicateCandidateId;
      const storageName = `uploaded-${Date.now()}-${randomUUID().slice(0, 8)}-${originalName}`;
      if (!candidateId || createSeparate) {
        candidateId = `candidate-${randomUUID()}`;
        await client.query(
          `insert into candidates (
            id, organization_id, name, normalized_name, normalized_email, normalized_phone, file_name, source_path,
            stage0_score, stage0_band, stage0, profile, status, owner_user_id, created_by
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,'new',$13,$13)`,
          [candidateId, context.organization.id, name, identity.name, identity.email, identity.phone, storageName,
            `db:${storageName}`, analysis.stage0.score, analysis.stage0.band, JSON.stringify(analysis.stage0),
            JSON.stringify(analysis.profile), context.user.id]
        );
      } else {
        const duplicate = await client.query("select id from candidates where id=$1 and organization_id=$2", [candidateId, context.organization.id]);
        if (!duplicate.rowCount) throw new AtsError("Duplicate candidate no longer exists", 409, "DUPLICATE_CHANGED");
      }

      const document = await client.query<{ id: string }>(
        `insert into resume_files (
          file_name, candidate_id, organization_id, original_file_name, content_type, bytes, size_bytes, sha256,
          extracted_text, extraction_status, uploaded_by
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id::text`,
        [storageName, candidateId, context.organization.id, originalName, kind.contentType, bytes, bytes.length, sha256,
          text || null, text ? "complete" : "failed", context.user.id]
      );
      const firstStage = await client.query<{ id: string }>("select id from job_stages where job_id=$1 and archived_at is null order by position limit 1", [jobId]);
      const application = await client.query<{ id: string; version: number }>(
        `insert into applications (organization_id, candidate_id, job_id, current_stage_id, source, owner_user_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$6)
         on conflict (candidate_id, job_id) do update set updated_at=now()
         returning id, version`,
        [context.organization.id, candidateId, jobId, firstStage.rows[0]?.id ?? null, source, context.user.id]
      );
      const rubric = await client.query<{ id: string; criteria: ResumeRubricCriterion[] }>(
        "select id, criteria from rubric_versions where job_id=$1 and is_active=true order by version_number desc limit 1",
        [jobId]
      );
      if (!rubric.rows[0]) throw new AtsError("Job rubric is missing", 409, "RUBRIC_MISSING");
      const rubricResult = scoreResumeForRubric(text, analysis, rubric.rows[0].criteria);
      await client.query(
        `insert into evaluations (application_id, rubric_version_id, source, prompt_version, score, max_score, eligibility, evidence, gaps, created_by)
         values ($1,$2,'deterministic','deterministic-v2',$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)`,
        [application.rows[0].id, rubric.rows[0].id, rubricResult.score, rubricResult.maxScore,
          JSON.stringify(rubricResult.eligibility), JSON.stringify(rubricResult.evidence),
          JSON.stringify(rubricResult.gaps), context.user.id]
      );
      const eventId = await recordEvent(client, {
        organizationId: context.organization.id, aggregateType: "candidate", aggregateId: candidateId,
        eventType: "candidate.resume_uploaded", actorUserId: context.user.id,
        data: { application_id: application.rows[0].id, document_id: document.rows[0].id, extraction_status: text ? "complete" : "failed" }
      });
      return {
        candidateId, applicationId: application.rows[0].id, documentId: document.rows[0].id, eventId,
        evaluation: { score: rubricResult.score, maxScore: rubricResult.maxScore }
      };
    });
    return NextResponse.json({
      ...result,
      analysis: { years: analysis.years, score: result.evaluation.score, maxScore: result.evaluation.maxScore, requiresHumanReview: true }
    }, { status: 201 });
  } catch (error) {
    return jsonFromError(error, "Unable to upload resume");
  }
}
