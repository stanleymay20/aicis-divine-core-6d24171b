# AICIS agent continuation contract

Before making significant product, architecture, forecasting, commercial, security, migration or UI changes, read these files in order:

1. `docs/AICIS_NORTH_STAR_CONTINUATION_V1.md`
2. `README.md`
3. the controlled task-specific document relevant to the work (for example `docs/AICIS_SCIENTIFIC_FORECASTING_PROTOCOL_V1.md`, migration runbooks, or `docs/investor/*`).

Do not restart or scaffold a parallel AICIS implementation. Reverse-engineer the existing system first and preserve working contracts.

The product north star is:

`Observe → Verify → Understand → Forecast → Simulate → Decide → Act → Resolve → Learn`

AICIS is an evidence-governed decision-support system, not an autonomous authority and not a validated general “world predictor.” The first commercial wedge remains evidence-governed operational resilience / continuity intelligence for public institutions and critical-infrastructure operators.

Non-negotiable rules:

- unknown stays unknown;
- observed evidence, model inference and consequential action stay distinct;
- prediction is not causality;
- scientific forecasts obey governed knowledge-time, baseline, calibration, abstention and sealing rules;
- consequential actions retain explicit human accountability unless a separately governed low-risk automation contract exists;
- do not weaken RLS, auth, migrations, security, evidence, forecasting or CI gates;
- do not claim pilot, customer, traction, validated forecasting, compliance, certification or production readiness without the evidence gate required for that claim;
- do not merge code whose exact current head has not passed the required checks;
- PR #31 / `feat/forecast-ledger-migration-v1` remains quarantined until its stated database validation gates are satisfied.

Prefer verified vertical progress over feature count. The strongest target loop is:

`real source → traceable evidence → governed Situation → sealed forecast where appropriate → human decision → real outcome → measurable learning`

# Existing operational notes

- Scheduled jobs calling backend functions must send header x-cron-secret read from vault secret 'cron_secret' (matches CRON_SECRET env) — hardened function auth rejects anon-key calls.
- Export functions select only columns verified live (GLOBAL_SIGNALS_MISSING_LIVE_COLUMNS / runtime probe); ~165 descriptive-named repo migrations are NOT applied live and must not be replayed without per-file review — why: repo/live schema drift broke all exports.
- Recovery authorization binds the auth service's PASSWORD_RECOVERY event to its exact server-validated access token and keeps it out of normal route authorization — because legitimate OTP/recovery links may not carry a "recovery" AMR claim and the reset page loads lazily.
- Password-reset emails use a separate implicit-flow auth client initialized before the normal PKCE app client — because emailed PKCE codes fail across browsers without the originating browser's verifier; recovery sessions never unlock app routes.
- Shared edge auth rejections (401/403) always include CORS headers — why: otherwise browsers mask the real reason as a CORS failure.
- Ask AICIS geography/domain scope is resolved deterministically server-side by `_shared/ask-scope-v1.mjs` (country_profiles names first, uppercase-standalone ISO3 only, clarification instead of global fallback) — why: case-insensitive ISO3 matching produced AND/ARE/CAN false countries.
- Two-step sign-in (TOTP) uses Supabase Auth MFA only via /account/security; state logic lives in src/lib/mfa-state.mjs and TOTP secrets/codes are never persisted — why: satisfies admin AAL2 without weakening role checks, which stay separate.
- Ask evidence uses deterministic domain relevance, dedup and <=50% internal snapshots when external exists — why: miscategorized signals and repeated scores weakened answers.
- Opportunity scans probe for optional personal scores before batched lookups — why: empty score lookups stalled world scans; unknown stays unknown.
