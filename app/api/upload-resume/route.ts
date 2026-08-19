import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { auditEvent, jsonError, jsonFromError, requireActor } from "@/lib/api-utils";
import { query } from "@/lib/db";
import type { Candidate, CandidateWorkflow, MetricId } from "@/lib/types";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const maxResumeSizeBytes = 8 * 1024 * 1024;

type MetricRule = {
  id: MetricId;
  max: number;
  groups: string[][];
};

const metricRules: MetricRule[] = [
  {
    id: "full_stack_production",
    max: 4,
    groups: [
      ["react", "next.js", "nextjs", "vue", "angular", "typescript"],
      ["node", "java", "python", "go", "golang", ".net", "spring", "django"],
      ["production", "scalable", "deployment", "ci/cd", "aws", "azure", "gcp"],
      ["frontend", "backend", "full stack", "full-stack"]
    ]
  },
  {
    id: "backend_api_database_depth",
    max: 4,
    groups: [
      ["api", "rest", "graphql", "microservice", "service"],
      ["postgres", "postgresql", "mysql", "mongodb", "redis", "database"],
      ["queue", "kafka", "rabbitmq", "event", "distributed"],
      ["performance", "optimization", "architecture", "system design"]
    ]
  },
  {
    id: "testing_debugging_production_support",
    max: 3,
    groups: [
      ["test", "testing", "unit", "integration", "e2e", "jest", "cypress", "selenium"],
      ["debug", "troubleshoot", "incident", "production support"],
      ["monitoring", "observability", "logging", "sentry", "datadog"]
    ]
  },
  {
    id: "security_reliability_awareness",
    max: 3,
    groups: [
      ["security", "secure", "privacy", "compliance"],
      ["auth", "authentication", "authorization", "oauth", "jwt", "sso"],
      ["reliability", "resilience", "availability", "fault tolerant"]
    ]
  },
  {
    id: "ownership_mentoring_communication",
    max: 4,
    groups: [
      ["owned", "ownership", "led", "lead", "architected"],
      ["mentor", "mentored", "reviewed", "code review"],
      ["stakeholder", "cross-functional", "requirements", "client"],
      ["release", "roadmap", "planning", "delivery"]
    ]
  },
  {
    id: "agentic_tool_usage_or_interest",
    max: 2,
    groups: [
      ["ai", "llm", "openai", "genai", "machine learning"],
      ["copilot", "cursor", "agent", "automation"]
    ]
  }
];

function safeFileName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function slug(value: string) {
  return safeFileName(value.toLowerCase()).replace(/\.[^.]+$/, "") || "candidate";
}

function uniqueLines(text: string, keywords: string[]) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20 && line.length < 220);
  const matches = lines.filter((line) => keywords.some((keyword) => line.toLowerCase().includes(keyword)));
  return [...new Set(matches)].slice(0, 4);
}

function scoreMetric(text: string, rule: MetricRule) {
  const lower = text.toLowerCase();
  const hitGroups = rule.groups.filter((group) => group.some((keyword) => lower.includes(keyword)));
  const keywords = rule.groups.flat();
  return {
    score: Math.min(rule.max, hitGroups.length),
    evidence: uniqueLines(text, keywords)
  };
}

function extractContacts(text: string) {
  return {
    emails: [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])],
    phones: [...new Set(text.match(/(?:\+?\d[\d ().-]{7,}\d)/g) ?? [])].slice(0, 4),
    links: [...new Set(text.match(/https?:\/\/[^\s)]+|(?:linkedin\.com|github\.com)\/[^\s)]+/gi) ?? [])].slice(0, 8)
  };
}

function inferYears(text: string) {
  const matches = [...text.matchAll(/(\d{1,2})(?:\.\d+)?\s*\+?\s*(?:years|yrs)\b/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 40);
  return matches.length > 0 ? Math.max(...matches) : null;
}

function inferSkills(text: string) {
  const groups: Record<string, string[]> = {
    languages: ["TypeScript", "JavaScript", "Python", "Java", "Go", "C#", "PHP", "Ruby", "Kotlin", "Swift"],
    frontend: ["React", "Next.js", "Vue", "Angular", "Redux", "Tailwind", "HTML", "CSS"],
    backend: ["Node.js", "Express", "Spring", "Django", "FastAPI", "GraphQL", "REST", "Microservices"],
    data: ["PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "RabbitMQ", "Elasticsearch"],
    infra: ["AWS", "Azure", "GCP", "Docker", "Kubernetes", "CI/CD", "Terraform"],
    quality: ["Jest", "Cypress", "Selenium", "Playwright", "Testing", "Observability", "Sentry"]
  };
  const lower = text.toLowerCase();
  return Object.fromEntries(
    Object.entries(groups).map(([key, values]) => [key, values.filter((value) => lower.includes(value.toLowerCase()))])
  );
}

function inferName(text: string, fileName: string, submittedName: FormDataEntryValue | null) {
  if (typeof submittedName === "string" && submittedName.trim()) return submittedName.trim();
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^[A-Za-z][A-Za-z .'-]{2,60}$/.test(line));
  if (firstLine) return firstLine;
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Uploaded Candidate";
}

function strictStage0(text: string): Candidate["stage0"] {
  const metrics = Object.fromEntries(metricRules.map((rule) => [rule.id, scoreMetric(text, rule)])) as Candidate["stage0"]["metrics"];
  const score = Object.values(metrics).reduce((sum, metric) => sum + metric.score, 0);
  const band =
    score >= 17 ? "Strict advance" : score >= 14 ? "Strict manual hold" : score >= 11 ? "Strict near miss" : "Strict reject";
  const gaps = metricRules
    .filter((rule) => metrics[rule.id].score < Math.ceil(rule.max / 2))
    .map((rule) => `Weak resume evidence for ${rule.id.replaceAll("_", " ")}`);

  return {
    score,
    max: 20,
    pass_bar: 17,
    hiring_plan_pass_bar: 14,
    band,
    metrics,
    gaps_or_review_notes: gaps
  };
}

function uploadedStatus(stage0: Candidate["stage0"], years: number | null): CandidateWorkflow["status"] {
  if (typeof years === "number" && years > 7) return "no_hire";
  if (years === null || years === 7) return "hold";
  if (stage0.score >= stage0.pass_bar) return "round1";
  if (stage0.score >= (stage0.hiring_plan_pass_bar ?? 14)) return "hold";
  return "no_hire";
}

async function extractPdfText(filePath: string) {
  try {
    const { stdout } = await execFileAsync("/opt/homebrew/bin/pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"], {
      maxBuffer: 16 * 1024 * 1024
    });
    return stdout;
  } catch {
    return "";
  }
}

async function extractPortablePdfText(pdfBytes: Buffer) {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(pdfBytes);
    return parsed.text ?? "";
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const actorUserId = await requireActor(request);
    const resume = form.get("resume");

    if (!(resume instanceof File) || resume.size === 0) {
      return jsonError("A PDF resume is required");
    }
    if (resume.size > maxResumeSizeBytes) {
      return jsonError("Resume must be 8MB or smaller");
    }

    const originalName = safeFileName(resume.name || "resume.pdf");
    if (!originalName.toLowerCase().endsWith(".pdf") || !["", "application/pdf"].includes(resume.type)) {
      return jsonError("Only PDF resumes are supported");
    }

    await mkdir(os.tmpdir(), { recursive: true });
    const fileName = `uploaded-${Date.now()}-${originalName}`;
    const filePath = path.join(os.tmpdir(), fileName);
    const pdfBytes = Buffer.from(await resume.arrayBuffer());
    await writeFile(filePath, pdfBytes);

    const text = (await extractPdfText(filePath)) || (await extractPortablePdfText(pdfBytes));
    const name = inferName(text, originalName, form.get("name"));
    if (name.length > 160) return jsonError("Candidate name is too long");
    const stage0 = strictStage0(text);
    const years = inferYears(text);
    const status = uploadedStatus(stage0, years);
    const candidateId = `uploaded-${slug(name)}-${randomUUID().slice(0, 8)}`;
    const firstLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12);
    const profile = {
      rank: null,
      years,
      contacts: extractContacts(text),
      skills: inferSkills(text),
      recent_titles: uniqueLines(text, ["engineer", "developer", "lead", "architect", "manager"]),
      summary_excerpt: firstLines.join("\n"),
      experience_excerpt: uniqueLines(text, ["experience", "project", "developed", "built", "implemented"]).join("\n"),
      project_excerpt: uniqueLines(text, ["project", "platform", "system", "application", "service"]).join("\n"),
      first_lines: firstLines,
      pages: null,
      keyword_counts: {}
    };

    await query(
      `
      insert into candidates (
        id, name, file_name, source_path, stage0_score, stage0_band, stage0, profile, status, owner_user_id, created_by
      )
      values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$10)
      `,
      [candidateId, name, fileName, `db:${fileName}`, stage0.score, stage0.band, JSON.stringify(stage0), JSON.stringify(profile), status, actorUserId]
    );
    await query(
      `
      insert into resume_files (file_name, candidate_id, content_type, bytes, size_bytes)
      values ($1, $2, 'application/pdf', $3, $4)
      on conflict (file_name)
      do update set
        candidate_id = excluded.candidate_id,
        content_type = excluded.content_type,
        bytes = excluded.bytes,
        size_bytes = excluded.size_bytes,
        updated_at = now()
      `,
      [fileName, candidateId, pdfBytes, pdfBytes.length]
    );
    await auditEvent({
      candidateId,
      actorUserId,
      action: "upload_resume",
      toStatus: status,
      payload: { fileName, years, stage0Score: stage0.score, stage0Band: stage0.band }
    });

    return NextResponse.json({ candidateId, name, stage0 });
  } catch (error) {
    return jsonFromError(error, "Unable to upload resume");
  }
}
