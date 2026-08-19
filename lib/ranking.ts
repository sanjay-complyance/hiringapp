import type { Candidate } from "@/lib/types";

type RankableCandidate = Pick<Candidate, "name" | "years" | "stage0" | "keyword_counts"> & {
  profile?: Record<string, unknown>;
};

const metricWeights = {
  full_stack_production: 1,
  backend_api_database_depth: 1.25,
  testing_debugging_production_support: 1.2,
  security_reliability_awareness: 1.15,
  ownership_mentoring_communication: 1,
  agentic_tool_usage_or_interest: 0.6
} as const;

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function candidateYears(candidate: RankableCandidate) {
  return numberValue(candidate.years) ?? numberValue(candidate.profile?.years);
}

export function rankingGroup(candidate: RankableCandidate) {
  const years = candidateYears(candidate);
  const score = candidate.stage0.score;
  if (typeof years === "number" && years >= 7) return 5;
  if (years === null) return 3;
  if (score >= candidate.stage0.pass_bar) return 0;
  if (score >= (candidate.stage0.hiring_plan_pass_bar ?? 14)) return 1;
  return 2;
}

function experienceFit(candidate: RankableCandidate) {
  const years = candidateYears(candidate);
  if (years === null || years >= 7) return 0;
  if (years >= 5) return 5;
  if (years >= 4) return 4;
  if (years >= 3) return 3;
  if (years >= 2) return 2;
  return 1;
}

function metricStrength(candidate: RankableCandidate) {
  return Object.entries(metricWeights).reduce((sum, [metricId, weight]) => {
    return sum + (candidate.stage0.metrics[metricId as keyof typeof metricWeights]?.score ?? 0) * weight;
  }, 0);
}

function maxedCriteria(candidate: RankableCandidate) {
  return Object.entries(metricWeights).filter(([metricId]) => {
    const metric = candidate.stage0.metrics[metricId as keyof typeof metricWeights];
    const max = metricId === "agentic_tool_usage_or_interest" ? 2 : metricId === "security_reliability_awareness" || metricId === "ownership_mentoring_communication" ? 3 : 4;
    return (metric?.score ?? 0) >= max;
  }).length;
}

function keywordDepth(candidate: RankableCandidate) {
  return Object.values(candidate.keyword_counts ?? {}).reduce((sum, value) => sum + Math.min(Number(value) || 0, 6), 0);
}

export function compareCandidatesForRanking(a: RankableCandidate, b: RankableCandidate) {
  return (
    rankingGroup(a) - rankingGroup(b) ||
    b.stage0.score - a.stage0.score ||
    metricStrength(b) - metricStrength(a) ||
    maxedCriteria(b) - maxedCriteria(a) ||
    experienceFit(b) - experienceFit(a) ||
    keywordDepth(b) - keywordDepth(a) ||
    a.name.localeCompare(b.name)
  );
}

