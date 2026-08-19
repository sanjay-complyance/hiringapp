import type { User } from "@/lib/types";

export const membershipRoles = [
  "owner",
  "admin",
  "founder",
  "recruiter",
  "hiring_manager",
  "interviewer",
  "viewer"
] as const;

export type MembershipRole = (typeof membershipRoles)[number];

export type Permission =
  | "org:manage"
  | "users:manage"
  | "providers:manage"
  | "jobs:create"
  | "jobs:approve"
  | "jobs:manage"
  | "candidates:read"
  | "candidates:pii"
  | "candidates:manage"
  | "applications:manage"
  | "interviews:manage"
  | "scorecards:submit"
  | "scorecards:reopen"
  | "tasks:manage"
  | "offers:read"
  | "offers:manage"
  | "offers:approve"
  | "reports:read"
  | "ai:use"
  | "data:export"
  | "data:delete";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  retention_days: number | null;
  ai_monthly_token_limit: number;
};

export type MembershipContext = {
  user: User;
  organization: Organization;
  role: MembershipRole;
};

export type JobState = "draft" | "pending_approval" | "open" | "paused" | "closed";
export type ApplicationState = "active" | "on_hold" | "rejected" | "withdrawn" | "hired";

export type DomainEvent = {
  id: number;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  created_at: string;
};
