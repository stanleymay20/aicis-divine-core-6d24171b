# AICIS Scientific Forecast Registry and Ledger Schema v1

Status: **controlled schema candidate — not applied and not a migration**

Protocol binding: `aicis-scientific-forecasting-protocol-v1`

Ordered schema bundle:

1. `scripts/sql/forecast-task-registry-ledgers-v1.candidate.sql`
2. `scripts/sql/forecast-task-registry-ledgers-v1.hardening.sql`

The hardening fragment is mandatory and must be applied after the base candidate. The CI truth floor audits the ordered bundle, not the base file in isolation.

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

The mandatory hardening override also preserves **JSON scalar type fidelity**. Protocol integers must be JSON numbers, protocol booleans must be JSON booleans, and string fields must be genuine JSON strings. Textual lookalikes such as `"30"` for a horizon or `"true"` for a boolean do not satisfy the database protocol contract.

A draft can be edited. Once approved, its scientific definition and approval evidence become immutable. Changes require a new semantic task version. An approved task can only be retired; it cannot be silently reverted or reactivated.

Approval does **not** activate an operational model.

### Validator execution boundary

The registry CHECK constraint invokes `validate_scientific_forecast_task_spec_v1(jsonb)` as the inserting role. The ordered hardening bundle therefore revokes function execution from `PUBLIC`, `anon`, and `authenticated`, then grants only the minimum required `EXECUTE` privilege to `service_role`. Removing that service-role EXECUTE grant makes legitimate registry inserts fail and is rejected by CI; exposing the validator to public/API roles is not required.

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

### Scientific issuance-time semantics

For **prospective** evidence, `sealed_at` is the authoritative scientific issuance timestamp. A caller-supplied `forecast_origin` may represent a logical model/evidence anchor, but it must never be used to claim that a prospective prediction was issued earlier than the database can prove. Prospective lead-time, prospective evaluation and promotion evidence must therefore use the database seal timestamp.

For **retrospective_backtest** evidence, the historical `forecast_origin` remains the evaluation origin, because the row is explicitly labelled as a reconstruction and cannot be counted as prospective evidence.

The executable helper `scripts/scientific-forecast-evidence-semantics-v1.mjs` fail-closes these semantics: prospective issuance resolves to `sealed_at`, retrospective issuance resolves to `forecast_origin`, and prospective evidence without a valid database seal cannot be treated as scientific prospective evidence.

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
- serializes resolution inserts per forecast using a transaction-scoped advisory lock;
- requires resolution versions to advance consecutively;
- prevents a first resolution from being labelled `revised`;
- requires later changes after a final/revised outcome to be recorded as another revision.

The advisory-lock hardening is deliberate. The immutable forecast ledger gives `service_role` no UPDATE privilege, so resolution serialization must not rely on `SELECT ... FOR UPDATE`. The mandatory hardening fragment replaces that initial implementation with `pg_advisory_xact_lock(...)`, preserving concurrency safety without weakening least privilege.

A new source revision creates a new resolution row. Existing evidence is never rewritten.

## Data API boundary

All three tables enable RLS, but v1 creates no `anon` or `authenticated` policy and grants them no table privileges. Table privileges are explicitly revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`, then only the minimum service-role table privileges are granted back:

- task registry — SELECT / INSERT / UPDATE;
- forecast ledger — SELECT / INSERT;
- resolution ledger — SELECT / INSERT.

The trigger and validation functions are not `SECURITY DEFINER`. Trigger-function direct EXECUTE remains revoked from API roles. The task-spec validator is the one deliberate exception to a blanket service-role function revoke because its CHECK constraint must execute as the service-side inserting role; only `service_role` receives EXECUTE on that validator.

## CI truth floor

`tests/scientific-forecast-ledger-schema-v1.test.mjs`, `scripts/audit-scientific-forecast-ledger-schema-v1.mjs`, and `scripts/scientific-forecast-evidence-semantics-v1.mjs` reject or expose changes that weaken critical constraints, including:

- `SECURITY DEFINER`;
- `GRANT ALL`;
- Data API grants to anon/authenticated;
- UPDATE/DELETE grants on sealed ledgers;
- missing RLS/revokes;
- missing protocol validator;
- missing or ineffective service-role EXECUTE on the CHECK-constraint validator;
- JSON strings masquerading as protocol numbers or booleans;
- missing prospective seal/horizon guards;
- treating caller historical `forecast_origin` as prospective issuance proof;
- prospective evidence without a valid database seal timestamp;
- caller-controlled resolution time;
- missing advisory serialization hardening;
- a later reintroduction of row-update locking after the advisory hardening;
- missing resolution ordering/authority controls;
- missing task immutability.

## Migration gate

This ordered SQL bundle is deliberately **not** placed under `supabase/migrations` because the required Supabase CLI migration-generation path is not available in the current runtime. A timestamp will not be invented merely to make the repository look complete.

Before this candidate can become deployable schema, the next database execution stage must:

1. generate a migration using the sanctioned Supabase migration workflow from the ordered schema bundle;
2. execute the migration in an isolated local/development database, not production;
3. run behavioral database tests for all lifecycle, validator-permission, JSON-type, least-privilege, concurrency and append-only constraints;
4. run Supabase security/performance advisors and resolve material findings;
5. commit the generated migration and exact behavioral evidence in a separate controlled PR;
6. keep all production forecast writers disabled until later prospective-forecast gates explicitly authorize them.
