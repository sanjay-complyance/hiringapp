import type { MembershipRole, Permission } from "@/lib/ats/types";

const permissions: Record<MembershipRole, ReadonlySet<Permission>> = {
  owner: new Set([
    "org:manage", "users:manage", "providers:manage", "jobs:create", "jobs:approve", "jobs:manage",
    "candidates:read", "candidates:pii", "candidates:manage", "applications:manage", "interviews:manage", "scorecards:submit",
    "scorecards:reopen", "tasks:manage", "offers:read", "offers:manage", "offers:approve", "reports:read",
    "ai:use", "data:export", "data:delete"
  ]),
  admin: new Set([
    "org:manage", "users:manage", "jobs:create", "jobs:manage", "candidates:read", "candidates:pii", "candidates:manage",
    "applications:manage", "interviews:manage", "scorecards:submit", "scorecards:reopen", "tasks:manage",
    "offers:read", "offers:manage", "reports:read", "ai:use", "data:export"
  ]),
  founder: new Set([
    "jobs:create", "jobs:approve", "jobs:manage", "candidates:read", "candidates:pii", "applications:manage", "interviews:manage",
    "scorecards:submit", "scorecards:reopen", "tasks:manage", "offers:read", "offers:manage", "offers:approve",
    "reports:read", "ai:use", "data:export"
  ]),
  recruiter: new Set([
    "jobs:create", "jobs:manage", "candidates:read", "candidates:pii", "candidates:manage", "applications:manage",
    "interviews:manage", "scorecards:submit", "tasks:manage", "offers:read", "offers:manage", "reports:read",
    "ai:use", "data:export"
  ]),
  hiring_manager: new Set([
    "jobs:create", "jobs:manage", "candidates:read", "candidates:pii", "applications:manage", "interviews:manage",
    "scorecards:submit", "tasks:manage", "offers:read", "reports:read", "ai:use"
  ]),
  interviewer: new Set(["candidates:read", "candidates:pii", "scorecards:submit", "tasks:manage"]),
  viewer: new Set(["candidates:read", "reports:read"])
};

export function hasPermission(role: MembershipRole, permission: Permission) {
  return permissions[role].has(permission);
}
