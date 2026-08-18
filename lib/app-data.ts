import staticData from "@/data/resume-evaluations.json";
import { query } from "@/lib/db";
import type { Candidate, CandidateWorkflow, EvaluationData, User } from "@/lib/types";

type CandidateRow = {
  id: string;
  name: string;
  file_name: string;
  source_path: string;
  stage0_score: number;
  stage0_band: string;
  stage0: Candidate["stage0"];
  profile: Record<string, unknown>;
  status: CandidateWorkflow["status"];
  owner_user_id: string | null;
};

type RoundScoreRow = {
  candidate_id: string;
  round_id: string;
  area_id: string;
  score: number;
};

type RoundNoteRow = {
  candidate_id: string;
  round_id: string;
  note: string;
};

type CandidateNoteRow = {
  candidate_id: string;
  body: string;
};

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function asRecordArray(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, values]) => [key, asArray(values)])
  );
}

function mapCandidate(row: CandidateRow, rank: number, workflow: CandidateWorkflow): Candidate {
  const profile = row.profile ?? {};
  return {
    id: row.id,
    rank,
    name: row.name,
    file: row.file_name,
    source_path: row.source_path,
    text_path: "",
    pages: typeof profile.pages === "number" ? profile.pages : null,
    years: typeof profile.years === "number" ? profile.years : null,
    contacts: {
      emails: asArray((profile.contacts as Record<string, unknown> | undefined)?.emails),
      phones: asArray((profile.contacts as Record<string, unknown> | undefined)?.phones),
      links: asArray((profile.contacts as Record<string, unknown> | undefined)?.links)
    },
    skills: asRecordArray(profile.skills),
    recent_titles: asArray(profile.recent_titles),
    summary_excerpt: typeof profile.summary_excerpt === "string" ? profile.summary_excerpt : "",
    experience_excerpt: typeof profile.experience_excerpt === "string" ? profile.experience_excerpt : "",
    project_excerpt: typeof profile.project_excerpt === "string" ? profile.project_excerpt : "",
    first_lines: asArray(profile.first_lines),
    stage0: row.stage0,
    keyword_counts: typeof profile.keyword_counts === "object" && profile.keyword_counts ? (profile.keyword_counts as Record<string, number>) : {},
    workflow
  };
}

export async function getAppData(): Promise<EvaluationData> {
  const [userResult, candidateResult, scoreResult, roundNoteResult, noteResult] = await Promise.all([
    query<User>("select id, email, name, role, active from app_users where active = true order by created_at asc"),
    query<CandidateRow>(`
      select id, name, file_name, source_path, stage0_score, stage0_band, stage0, profile, status, owner_user_id
      from candidates
      order by stage0_score desc, lower(name) asc
    `),
    query<RoundScoreRow>("select candidate_id, round_id, area_id, score from round_scores"),
    query<RoundNoteRow>("select candidate_id, round_id, note from round_notes"),
    query<CandidateNoteRow>(`
      select distinct on (candidate_id) candidate_id, body
      from candidate_notes
      order by candidate_id, created_at desc
    `)
  ]);

  const workflows = new Map<string, CandidateWorkflow>();
  for (const row of candidateResult.rows) {
    workflows.set(row.id, {
      status: row.status,
      ownerUserId: row.owner_user_id ?? "",
      notes: "",
      roundScores: {},
      roundNotes: {}
    });
  }
  for (const row of scoreResult.rows) {
    const workflow = workflows.get(row.candidate_id);
    if (!workflow) continue;
    workflow.roundScores[row.round_id] = {
      ...(workflow.roundScores[row.round_id] ?? {}),
      [row.area_id]: row.score
    };
  }
  for (const row of roundNoteResult.rows) {
    const workflow = workflows.get(row.candidate_id);
    if (!workflow) continue;
    workflow.roundNotes[row.round_id] = row.note;
  }
  for (const row of noteResult.rows) {
    const workflow = workflows.get(row.candidate_id);
    if (!workflow) continue;
    workflow.notes = row.body;
  }

  return {
    ...(staticData as unknown as EvaluationData),
    users: userResult.rows,
    candidates: candidateResult.rows.map((row, index) => mapCandidate(row, index + 1, workflows.get(row.id) ?? {
      status: "new",
      ownerUserId: "",
      notes: "",
      roundScores: {},
      roundNotes: {}
    }))
  };
}
