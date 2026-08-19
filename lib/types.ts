export type MetricId =
  | "full_stack_production"
  | "backend_api_database_depth"
  | "testing_debugging_production_support"
  | "security_reliability_awareness"
  | "ownership_mentoring_communication"
  | "agentic_tool_usage_or_interest";

export type MetricEvaluation = {
  score: number;
  evidence: string[];
};

export type Candidate = {
  id: string;
  rank: number;
  name: string;
  file: string;
  source_path: string;
  text_path: string;
  pages: number | null;
  years: number | null;
  contacts: {
    emails: string[];
    phones: string[];
    links: string[];
  };
  skills: Record<string, string[]>;
  recent_titles: string[];
  summary_excerpt: string;
  experience_excerpt: string;
  project_excerpt: string;
  first_lines: string[];
  stage0: {
    score: number;
    max: number;
    pass_bar: number;
    hiring_plan_pass_bar?: number;
    band: string;
    metrics: Record<MetricId, MetricEvaluation>;
    gaps_or_review_notes: string[];
  };
  keyword_counts: Record<string, number>;
  workflow?: CandidateWorkflow;
};

export type RubricArea = {
  id: MetricId;
  label: string;
  max: number;
  strong_evidence: string;
};

export type RoundArea = [string, string, number];

export type RoundScorecard = {
  name: string;
  points: number;
  pass_bar: number;
  hiring_plan_pass_bar?: number;
  hard_rule?: string;
  areas?: RoundArea[];
  questions?: string[];
};

export type EvaluationData = {
  source: {
    hiring_plan_pdf: string;
    resume_folder: string;
    method: string;
  };
  resume_screen_rubric: RubricArea[];
  round_scorecards: Record<string, RoundScorecard>;
  candidates: Candidate[];
  users?: User[];
  syncVersion?: number;
  publicStats?: {
    candidates: number;
    users: number;
  };
};

export type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
};

export type CandidateWorkflow = {
  status: "new" | "round1" | "round2" | "round3" | "hire" | "no_hire" | "hold";
  ownerUserId: string;
  notes: string;
  roundScores: Record<string, Record<string, number>>;
  roundNotes: Record<string, string>;
  activity: CandidateActivity[];
};

export type CandidateActivity = {
  id: string;
  type: "note" | "audit";
  action: string | null;
  body: string | null;
  actorName: string | null;
  actorEmail: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
};
