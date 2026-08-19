import mammoth from "mammoth";

export const maxResumeBytes = 8 * 1024 * 1024;

const metricRules = [
  { id: "full_stack_production", max: 4, groups: [["react", "next.js", "vue", "angular", "typescript"], ["node", "java", "python", "go", ".net", "spring", "django"], ["production", "deployment", "ci/cd", "aws", "azure", "gcp"], ["frontend", "backend", "full stack", "full-stack"]] },
  { id: "backend_api_database_depth", max: 4, groups: [["api", "rest", "graphql", "microservice"], ["postgres", "mysql", "mongodb", "redis", "database"], ["queue", "kafka", "event", "distributed"], ["performance", "architecture", "system design"]] },
  { id: "testing_debugging_production_support", max: 3, groups: [["test", "unit", "integration", "e2e", "jest", "cypress"], ["debug", "incident", "production support"], ["monitoring", "observability", "logging"]] },
  { id: "security_reliability_awareness", max: 3, groups: [["security", "privacy", "compliance"], ["authentication", "authorization", "oauth", "jwt", "sso"], ["reliability", "resilience", "availability"]] },
  { id: "ownership_mentoring_communication", max: 4, groups: [["owned", "ownership", "led", "architected"], ["mentor", "code review"], ["stakeholder", "cross-functional", "client"], ["release", "roadmap", "delivery"]] },
  { id: "agentic_tool_usage_or_interest", max: 2, groups: [["ai", "llm", "openai", "genai"], ["copilot", "cursor", "agent", "automation"]] }
] as const;

export type ResumeRubricCriterion = {
  id: string;
  label: string;
  max: number;
  hard?: boolean;
};

const metricMaximums = Object.fromEntries(metricRules.map((rule) => [rule.id, rule.max])) as Record<string, number>;
const criterionKeywords: Record<string, string[]> = {
  role_fit: ["engineer", "developer", "production", "platform", "application", "service"],
  delivery: ["delivered", "launched", "deployed", "release", "implemented", "built", "roadmap"],
  technical_depth: ["architecture", "system design", "api", "database", "distributed", "performance", "microservice"],
  ownership: ["owned", "ownership", "led", "architected", "stakeholder", "mentor", "code review"]
};

export function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

function uniqueLines(text: string, keywords: readonly string[]) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 20 && line.length < 260);
  return [...new Set(lines.filter((line) => keywords.some((keyword) => line.toLowerCase().includes(keyword))))].slice(0, 5);
}

export function extractContacts(text: string) {
  return {
    emails: [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])].slice(0, 4),
    phones: [...new Set(text.match(/(?:\+?\d[\d ().-]{7,}\d)/g) ?? [])].slice(0, 4),
    links: [...new Set(text.match(/https?:\/\/[^\s)]+|(?:linkedin\.com|github\.com)\/[^\s)]+/gi) ?? [])].slice(0, 8)
  };
}

export function inferYears(text: string) {
  const explicit = [
    ...text.matchAll(/(\d{1,2})(?:\.\d+)?\s*\+?\s*(?:years|yrs)\s+(?:of\s+)?experience\b/gi),
    ...text.matchAll(/(?:experience\s*(?:of|:)?)\s*(\d{1,2})(?:\.\d+)?\s*\+?\s*(?:years|yrs)\b/gi),
    ...text.matchAll(/(\d{1,2})(?:\.\d+)?\s*\+?\s*yoe\b/gi)
  ].map((match) => Number(match[1])).filter((value) => value > 0 && value < 40);
  return explicit.length ? Math.max(...explicit) : null;
}

function inferSkills(text: string) {
  const groups: Record<string, string[]> = {
    languages: ["TypeScript", "JavaScript", "Python", "Java", "Go", "C#", "PHP", "Ruby", "Kotlin", "Swift"],
    frontend: ["React", "Next.js", "Vue", "Angular", "Redux", "Tailwind", "HTML", "CSS"],
    backend: ["Node.js", "Express", "Spring", "Django", "FastAPI", "GraphQL", "REST", "Microservices"],
    data: ["PostgreSQL", "MySQL", "MongoDB", "Redis", "Kafka", "RabbitMQ", "Elasticsearch"],
    infrastructure: ["AWS", "Azure", "GCP", "Docker", "Kubernetes", "CI/CD", "Terraform"],
    quality: ["Jest", "Cypress", "Selenium", "Playwright", "Testing", "Observability", "Sentry"]
  };
  const lower = text.toLowerCase();
  return Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, values.filter((value) => lower.includes(value.toLowerCase()))]));
}

export function inferName(text: string, fileName: string, submittedName?: string | null) {
  if (submittedName?.trim()) return submittedName.trim();
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => /^[A-Za-z][A-Za-z .'-]{2,60}$/.test(line));
  return firstLine || fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Uploaded candidate";
}

export async function extractResumeText(bytes: Buffer, extension: "pdf" | "docx") {
  try {
    if (extension === "docx") {
      const result = await mammoth.extractRawText({ buffer: bytes });
      return result.value.trim();
    }
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(bytes);
    return (parsed.text ?? "").trim();
  } catch {
    return "";
  }
}

export function deterministicResumeAnalysis(text: string) {
  const lower = text.toLowerCase();
  const metrics = Object.fromEntries(metricRules.map((rule) => {
    const hits = rule.groups.filter((group) => group.some((keyword) => lower.includes(keyword)));
    return [rule.id, { score: Math.min(rule.max, hits.length), evidence: uniqueLines(text, rule.groups.flat()) }];
  }));
  const score = Object.values(metrics).reduce((sum, value) => sum + value.score, 0);
  const years = inferYears(text);
  const firstLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 14);
  const gaps = metricRules.filter((rule) => metrics[rule.id].score < Math.ceil(rule.max / 2))
    .map((rule) => `Limited resume evidence for ${rule.id.replaceAll("_", " ")}`);
  if (years === null) gaps.unshift("Years of experience require human confirmation");
  const contacts = extractContacts(text);
  return {
    years,
    contacts,
    profile: {
      years,
      contacts,
      skills: inferSkills(text),
      recent_titles: uniqueLines(text, ["engineer", "developer", "lead", "architect", "manager"]),
      summary_excerpt: firstLines.join("\n"),
      experience_excerpt: uniqueLines(text, ["experience", "developed", "built", "implemented"]).join("\n"),
      project_excerpt: uniqueLines(text, ["project", "platform", "system", "application", "service"]).join("\n"),
      first_lines: firstLines,
      pages: null,
      keyword_counts: {}
    },
    stage0: {
      score, max: 20, pass_bar: 17, hiring_plan_pass_bar: 14,
      band: score >= 17 ? "Strict advance" : score >= 14 ? "Strict manual hold" : score >= 11 ? "Strict near miss" : "Strict reject",
      metrics,
      gaps_or_review_notes: gaps
    }
  };
}

function criterionTerms(criterion: ResumeRubricCriterion) {
  if (criterionKeywords[criterion.id]) return criterionKeywords[criterion.id];
  const ignored = new Set(["and", "the", "with", "for", "from", "role", "evidence", "experience"]);
  return [...new Set(`${criterion.id.replaceAll("_", " ")} ${criterion.label}`
    .toLowerCase()
    .match(/[a-z][a-z0-9+#.-]{2,}/g)
    ?.filter((term) => !ignored.has(term)) ?? [])];
}

function isUnderSevenCriterion(criterion: ResumeRubricCriterion) {
  return criterion.id === "experience_fit" || /(?:under|less than)\s+7\s+years?/i.test(criterion.label);
}

export function scoreResumeForRubric(
  text: string,
  analysis: ReturnType<typeof deterministicResumeAnalysis>,
  criteria: ResumeRubricCriterion[]
) {
  const eligibility: Record<string, boolean | null> = { requires_human_confirmation: true };
  const evidence: Record<string, { score: number; max: number; evidence: string[] }> = {};
  const gaps: string[] = [];
  let score = 0;
  let maxScore = 0;

  for (const criterion of criteria) {
    if (criterion.hard) {
      if (isUnderSevenCriterion(criterion)) {
        const eligible = analysis.years === null ? null : analysis.years < 7;
        eligibility.experience_under_7 = eligible;
        if (eligible === null) gaps.push("Years of experience require human confirmation for this job");
        if (eligible === false) gaps.push("Reported experience does not meet this job's under-seven criterion; confirm before deciding");
      } else {
        eligibility[criterion.id] = null;
        gaps.push(`${criterion.label} requires human confirmation`);
      }
      continue;
    }

    maxScore += criterion.max;
    const knownMetric = analysis.stage0.metrics[criterion.id as keyof typeof analysis.stage0.metrics];
    let lines: string[];
    let criterionScore: number;
    if (knownMetric) {
      lines = knownMetric.evidence;
      const sourceMax = metricMaximums[criterion.id] || criterion.max;
      criterionScore = Math.round((knownMetric.score / sourceMax) * criterion.max);
    } else {
      const terms = criterionTerms(criterion);
      lines = terms.length ? uniqueLines(text, terms) : [];
      criterionScore = Math.min(criterion.max, Math.ceil(lines.length / 2));
    }
    criterionScore = Math.max(0, Math.min(criterion.max, criterionScore));
    score += criterionScore;
    evidence[criterion.id] = { score: criterionScore, max: criterion.max, evidence: lines };
    if (criterionScore < Math.ceil(criterion.max / 2)) gaps.push(`Limited resume evidence for ${criterion.label.toLowerCase()}`);
  }

  return { score, maxScore, eligibility, evidence, gaps };
}

export function normalizedIdentity(name: string, contacts: ReturnType<typeof extractContacts>) {
  return {
    name: name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    email: contacts.emails[0]?.toLowerCase() || null,
    phone: contacts.phones[0]?.replace(/\D+/g, "") || null
  };
}
