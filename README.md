# Hiring Management App

An organization-scoped hiring operations system built with Next.js and PostgreSQL. It manages requisition approval, job-specific pipelines and rubrics, candidate applications, structured interviews, scorecards, tasks, communication history, offers, reporting, and human-approved recruiting copilot proposals.

## Product scope

- Dashboard, Jobs, Candidates, Interviews, Tasks, Reports, and Settings workspaces
- Owner, admin, founder, recruiter, hiring manager, interviewer, and viewer permissions
- Draft, approval, open, paused, and closed requisition states
- Job-editable stages and versioned rubrics
- Application-specific evidence, screening details, stage gates, debriefs, and audited overrides
- Locked independent scorecards and authorized reopening
- PDF and DOCX resume upload with signature checks, extraction state, SHA-256 duplicate detection, and original-file retention
- Tasks, reminders, stage SLA warnings, communication templates, and event-driven cross-user refresh
- Offers with founder or owner approval and explicit acceptance outcome
- OpenAI and Claude integrations with encrypted organization credentials and human-approved proposals

The migrated Senior Software Developer job retains its under-seven-years criterion. Experience is not a global candidate rule and no criterion rejects a candidate automatically.

## Local setup

Prerequisites: Node.js 22 or newer and a PostgreSQL database.

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

`npm run db:init` creates the legacy demo dataset before applying all additive migrations. Use it only for a new, empty development database. Use `npm run db:migrate` for an existing database.

The local app is available at [http://localhost:3000](http://localhost:3000).

## Environment

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=verify-full&channel_binding=require
AUTH_SECRET=long-random-secret
CREDENTIAL_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

Generate independent secrets for each environment. `CREDENTIAL_ENCRYPTION_KEY` encrypts AI provider keys with AES-256-GCM and must remain separate from `AUTH_SECRET`. Losing it makes stored provider credentials unreadable.

## Deployment

1. Rotate any database credential that has appeared in chat, source control, logs, or shared screenshots.
2. Create a Neon preview branch from production and point a Vercel preview deployment at it.
3. Set all three environment variables in Vercel. Do not expose them with the `NEXT_PUBLIC_` prefix.
4. Run `npm run db:migrate` against the preview branch.
5. Run the verification commands below and confirm the migration retains exactly 79 migrated candidates, applications, and resume documents.
6. Back up production, run the same additive migrations against production, and deploy the tested commit.

Migrations are checksum-tracked in the `schema_migrations` table. Do not edit an applied migration; add another numbered migration. The release only adds schema, so application code can be rolled back without deleting migrated records.

## Security status

This release intentionally retains allowlisted-email login. Anyone who knows an active member's email can impersonate that member. Keep the deployment classified as an internal beta and restrict its network exposure until verified authentication is implemented.

Sessions use a signed secure HttpOnly cookie, login is rate limited, mutations enforce same-origin checks, and each API mutation checks organization membership and role permissions. Compensation, offers, exports, deletion, user administration, and AI provider configuration have narrower permissions. Resume contents, provider keys, compensation, and chat text must not be written to logs.

Seeded memberships:

- `sanjay@complyance.io`: owner
- `meiyappanmm@complyance.io`: founder/approver
- `hari@complyance.io`: founder/approver
- `arul@complyance.io`: recruiter/HR

Additional users can be activated, deactivated, and assigned roles from Settings by an owner or admin.

## Recruiting copilot

Only the organization owner can connect, test, rotate, or remove a shared OpenAI or Claude API key. Chat threads remain private to their creator. Agent tools are read-only; proposed evaluations, summaries, guides, tasks, rubric changes, or stage changes require explicit approval and are revalidated against permissions and current record versions before being applied.

Contact details and likely protected attributes are redacted before resume text is sent by default. Configure a monthly token threshold in Settings; new runs stop when the threshold is reached. Provider contract tests are mocked and do not spend API credits.

## Verification

```bash
npm run lint
npx next typegen
npx tsc --noEmit
npm test
npm run test:e2e
npm run build
npm audit
```

The E2E suite covers route protection, the 79-record migration, duplicate uploads, role boundaries, requisition approval, stage and rubric versioning, all three rounds, required HR fields, scorecard locking, offers and hiring, rejection evidence, stale writes, cross-user updates, and mobile full-page scrolling.

Email and calendar delivery, Teams or Meet integration, offer-document generation, onboarding, payroll, and automatic retention deletion remain outside this release.
