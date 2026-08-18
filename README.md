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
```

Use the Neon Postgres connection string with `sslmode=verify-full`.

The app stores users, candidates, audit events, interview notes, round scores, and uploaded resume PDFs in Postgres. If you point Vercel at a fresh database, run `npm run db:init` once from a local machine with `DATABASE_URL` set before deploying.

## Default users

- `sanjay@complyance.io`
- `meiyappanmm@complyance.io`
- `arul@complyance.io`
- `hari@complyance.io`
