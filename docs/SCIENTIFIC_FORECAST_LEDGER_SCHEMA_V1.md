# AICIS Scientific Forecast Registry and Ledger Schema v1

Status: **controlled schema candidate — not applied and not a migration**

Protocol binding: `aicis-scientific-forecasting-protocol-v1`

Candidate SQL: `scripts/sql/forecast-task-registry-ledgers-v1.candidate.sql`

## Purpose

This phase creates the database contract needed to preserve the scientific distinction between a model experiment and a prediction that was genuinely made before the future occurred.

It defines three service-side governance records:

1. `scientific_forecast_tasks_v1` — versioned forecast-task definitions;
2. `scientific_forecast_ledger_v1` — append-only sealed predictions;
3. `scientific_forecast_resolution_ledger_v1` — append-only versioned ground-truth resolutions.

No production forecast writer, cron, operational task, model promotion or Supabase migration is introduced by this candidate.

## Forecast task registry

A task is inserted only as a draft. The database independently reproduces the non-negotiable Scientific Forecasting Protocol v1 invariants before allowing the row to satisfy its registry constraints, including:

- exact protocol and knowledge-time policy;
- explicit target and horizon;
- approved resolution authority class/revision policy;
- mandatory target-specific simple baselines;
- target-appropriate proper primary score;
- knowledge-time-bounded rolling-origin evaluation;
- sealed prospective evaluation;
- minimum calibration/promotion sample floors;
- mandatory abstention triggers;
- immutable ledger hash requirements;
- predictive-not-causal claim semantics.

A draft can be edited. Once approved, its scientific definition and approval evidence become immutable. Changes require a new semantic task version. An approved task can only be retired; it cannot be silently reverted or reactivated.

Approval does **not** activate an operational model.

## Forecast evidence classes

The forecast ledger keeps evidence classes explicit:

- `retrospective_backtest` — historical reconstruction after the target period is already known to have ended;
- `prospective_shadow` — a real-future forecast sealed before its target period begins, with no operational authority;
- `prospective_operational` — reserved for a later phase and explicitly rejected by the v1 insert guard until a separate operational-promotion control exists.

This prevents retrospective experiments from being represented as prospective evidence.

## Database-authoritative sealing

The database overwrites `sealed_at` with `clock_timestamp()` during insert. A caller cannot backdate seal time.

For `prospective_shadow`, the insert is rejected if database seal time is later than the target-window start.

For `retrospective_backtest`, the insert is rejected unless the target window has already ended.

The target-window end must exactly equal the registered task horizon calculated from the target-window start.

## Immutable reproducibility evidence

Every forecast binds:

- data manifest SHA-256;
- feature manifest SHA-256;
- model artifact SHA-256;
- Git commit SHA;
- a versioned seal-proof SHA-256;
- forecast origin and knowledge cutoff;
- target window;
- model/ensemble/calibration versions;
- forecast payload.

The forecast ledger has no UPDATE or DELETE grant and has a database trigger that rejects both operations.

## Ground-truth resolution

Resolution rows are append-only and versioned. The database:

- owns `resolved_at` using `clock_timestamp()`;
- rejects resolution before the target window closes;
- requires the registered task's ground-truth authority/class/revision policy;
- serializes resolution inserts per forecast;
- requires resolution versions to advance consecutively;
- prevents a first resolution from being labelled `revised`;
- requires later changes after a final/revised outcome to be recorded as another revision.

A new source revision creates a new resolution row. Existing evidence is never rewritten.

## Data API boundary

All three tables enable RLS, but v1 creates no `anon` or `authenticated` policy and grants them no privileges. Table privileges are explicitly revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`, then only the minimum service-role privileges are granted back:

- task registry — SELECT / INSERT / UPDATE;
- forecast ledger — SELECT / INSERT;
- resolution ledger — SELECT / INSERT.

The trigger and validation functions are not `SECURITY DEFINER`, and direct EXECUTE is revoked from public/API roles.

## CI truth floor

`tests/scientific-forecast-ledger-schema-v1.test.mjs` and `scripts/audit-scientific-forecast-ledger-schema-v1.mjs` reject candidate changes that weaken critical constraints, including:

- `SECURITY DEFINER`;
- `GRANT ALL`;
- Data API grants to anon/authenticated;
- UPDATE/DELETE grants on sealed ledgers;
- missing RLS/revokes;
- missing protocol validator;
- missing prospective seal/horizon guards;
- caller-controlled resolution time;
- missing resolution ordering/authority controls;
- missing task immutability.

## Migration gate

This SQL is deliberately **not** placed under `supabase/migrations` because the required Supabase CLI migration-generation path is not available in the current runtime. A timestamp will not be invented merely to make the repository look complete.

Before this candidate can become deployable schema, the next database execution stage must:

1. generate a migration using the sanctioned Supabase migration workflow;
2. execute the migration in an isolated local/development database, not production;
3. run behavioral database tests for all lifecycle and append-only constraints;
4. run Supabase security/performance advisors and resolve material findings;
5. commit the generated migration and exact behavioral evidence in a separate controlled PR;
6. keep all production forecast writers disabled until later prospective-forecast gates explicitly authorize them.
