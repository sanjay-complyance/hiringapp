# Hiring App

Next.js app for senior software developer resume screening and interview workflow.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run db:init
npm run dev
```

## Vercel setup

Set this environment variable in Vercel:

```bash
DATABASE_URL=...
AUTH_SECRET=...
```

Use the Neon Postgres connection string with `sslmode=verify-full`.
Use a long random `AUTH_SECRET` so login sessions stay signed across deployments.

The app stores users, candidates, audit events, interview notes, round scores, and uploaded resume PDFs in Postgres. If you point Vercel at a fresh database, run `npm run db:init` once from a local machine with `DATABASE_URL` set before deploying.

The current shortlist rule targets candidates under 7 years of experience. Run `npm run db:experience-fit` after reseeding or importing candidates to move over-7 candidates to no-hire and hold exactly-7/unclear profiles for manual verification.

## Default users

- `sanjay@complyance.io`
- `meiyappanmm@complyance.io`
- `arul@complyance.io`
- `hari@complyance.io`
