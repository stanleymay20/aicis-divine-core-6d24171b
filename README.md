# AICIS — AI Civilization Intelligence System

AICIS is a global-to-local intelligence platform for collecting, enriching, scoring, and routing planetary signals into decision-ready intelligence. The current implementation is a Vite + React frontend backed by Supabase Auth, Postgres, and Edge Functions.

## Architecture

```text
Open data / APIs / feeds
        ↓
Supabase Edge Functions
        ↓
Postgres canonical tables
        ↓
Enrichment, relevance scoring, prediction, and governance functions
        ↓
React command surfaces
        ↓
Human review, decision operations, alerts, and exports
```

### Frontend

- Vite
- React 18
- TypeScript
- React Router
- TanStack Query
- Tailwind CSS
- shadcn-ui components
- Supabase browser client

Core surfaces include live signals, morning brief, decision operations, governance, watchlist, risk atlas, relevance preferences, training dataset, data pipeline, predictions, local events, and outcome cockpit.

### Backend

- Supabase Auth
- Supabase Postgres
- Supabase Edge Functions
- Row Level Security should be enabled for all user-facing tables
- Service role access must remain server-side only

## Local setup

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure environment

Copy the example file:

```bash
cp .env.example .env.local
```

Set the required frontend variables:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_or_publishable_key
```

### 3. Run the app

```bash
npm run dev
```

### 4. Build

```bash
npm run build
```

### 5. Typecheck and lint

```bash
npm run typecheck
npm run lint
```

## Deployment

The app can be deployed through Lovable, Vercel, Netlify, or any static host that supports Vite builds.

Recommended production build command:

```bash
npm ci && npm run lint && npm run typecheck && npm run build
```

Recommended output directory:

```text
dist
```

## Required environment variables

### Frontend

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

### Supabase Edge Functions

Set these as Supabase function secrets, not frontend variables:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
AICIS_MODEL_ENDPOINT=
AICIS_MODEL_API_KEY=
AICIS_MODEL_NAME=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ALPHA_VANTAGE_API_KEY=
EIA_API_KEY=
```

Only expose `VITE_*` values to the browser. Never expose `SUPABASE_SERVICE_ROLE_KEY`, model provider keys, Stripe secrets, or cron secrets in frontend code.

## Supabase function security model

Functions must be classified before production deployment.

### Public functions

Public functions can be called without a user JWT only when the returned data is intentionally public, rate-limited, and does not mutate privileged tables. Examples may include public read-only intelligence endpoints.

### Cron-only functions

Cron-only functions may keep `verify_jwt = false` only if the function validates `CRON_SECRET` using an `x-cron-secret` or `authorization: Bearer <secret>` header before doing work.

### Admin-only functions

Admin-only functions must require a verified user JWT and must check the user's role before mutating ingestion, enrichment, billing, governance, or operational tables.

Acceptable admin role sources:

- `app_metadata.role = "admin"`
- `app_metadata.roles` includes `"admin"`
- `user_metadata.role = "admin"`

For stricter production use, move role checks into a database-backed organization membership table and enforce them through RLS and RPCs.

## Data pipeline

The intended AICIS data flow is:

```text
intake → canonicalization → deduplication → enrichment → relevance scoring → routing → review feedback → learning loop
```

Pipeline responsibilities:

1. Intake functions collect raw events from approved sources.
2. Canonicalization normalizes country, sector, source, event type, confidence, and evidence fields.
3. Deduplication prevents repeated alerts from the same underlying event.
4. Enrichment adds strategic implications, likely consequences, audience framing, and recommended actions.
5. Relevance scoring maps global signals to organization-specific risk context.
6. Routing pushes only relevant items into user-facing command surfaces.
7. Feedback records false positives, missed signals, and human review outcomes.

## Cron jobs

Recommended production policy:

- Run cron jobs from Supabase Scheduled Functions, GitHub Actions, or an external scheduler.
- Every cron request must include `CRON_SECRET`.
- Cron functions should log start time, end time, inserted count, skipped count, error count, and duration.
- Cron jobs should be idempotent.
- Mutating jobs should write to `automation_logs` or a dedicated pipeline health table.

Example header:

```bash
x-cron-secret: $CRON_SECRET
```

## Enterprise hardening checklist

- [x] Replace generic scaffold README
- [x] Add `.env.example`
- [x] Add CI for lint, typecheck, and build
- [x] Add `score-relevance` config entry
- [x] Add shared Supabase function auth guard
- [ ] Apply shared auth guard to every cron/admin function
- [ ] Add database-backed organization roles
- [ ] Add RLS verification tests
- [ ] Add rate limits for public functions
- [ ] Add observability dashboard for pipeline health
- [ ] Add incident/error budget policy
- [ ] Add data retention and privacy policy enforcement

## Troubleshooting

### App loads but data is empty

Check:

1. `VITE_SUPABASE_URL`
2. `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Supabase table RLS policies
4. Whether ingestion/enrichment cron jobs are running
5. Browser console and Supabase function logs

### Function returns 401

Check:

1. Is the function public, cron-only, or admin-only?
2. If cron-only, did you send `x-cron-secret`?
3. If admin-only, is the user authenticated?
4. Does the user's metadata include an admin role?

### Function returns 500

Check:

1. Required Supabase secrets
2. Source API keys
3. Database table existence
4. RLS/service-role usage
5. Function logs

## Development principles

- No mock data in production paths
- No service role key in frontend code
- No privileged mutation without auth or cron secret
- No unclassified public edge functions
- No global alert firehose without user-specific relevance scoring
- Prefer real source provenance over synthetic summaries
