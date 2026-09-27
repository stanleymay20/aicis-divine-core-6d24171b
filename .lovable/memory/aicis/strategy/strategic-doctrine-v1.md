---
name: AICIS Strategic Doctrine Engine v1
description: Canonical architecture for strategy generation, strategic state, Pareto selection, value of information, contingent policy and doctrine learning
type: feature
---

# Purpose

The Strategic Doctrine Engine sits above transaction ranking and below human approval.

It exists to answer:

> Given the verified situation, the actor's real capabilities, the terrain, timing, alternatives, uncertainty and objective, what is the strongest feasible strategy among the options AICIS actually evaluated?

The engine must not reduce strategy to a decorative score or treat Sunzi as unquestionable authority.

Sunzi-derived principles are recorded as intellectual provenance for falsifiable strategic heuristics.

# Core pipeline

```text
Evidence Fabric
→ World / Opportunity State
→ Strategic State
  → Actor / Know Self
  → Terrain
  → Timing
→ Option Generation
  → Direct
  → Indirect
  → Position-building
  → Information-gathering
  → No action
→ Feasibility
→ Scenario Robustness
→ Comparative Regret
→ Pareto Frontier
→ Personalized Strategic Fit
→ Primary Strategy
→ Contingent Policy
→ Human Approval
→ Outcome
→ Doctrine Learning
```

# Strategic state

The state keeps these dimensions separate:

## Actor / Know Self
- capabilities;
- licences / permissions;
- relationships;
- infrastructure;
- capital;
- declared constraints.

User-declared strategic facts are stored under:

```
aicis_relevance_preferences.alert_preferences.opportunity_profile
```

Current fields include:
- strategic_capabilities;
- strategic_licenses;
- strategic_relationships;
- strategic_infrastructure;
- strategic_constraints.

Unknown capability must remain unknown. Do not infer execution capability merely because an opportunity is attractive.

## Terrain
- geography;
- regulation;
- infrastructure constraints;
- market structure;
- supply-chain topology;
- attributable evidence.

## Timing
- opportunity window;
- preferred action deadline;
- invalidation deadline;
- quote / evidence freshness.

# Strategy types

The engine may compare:

- direct_transaction;
- indirect / brokerage / agency / partnership / financing;
- position_building;
- information_gathering;
- no_action.

A strategy is not execution.

A research-only strategy cannot become the primary economic recommendation unless its material economics become attributable.

# Truth boundaries

## Currency
- Economic options need an explicit currency.
- Mixed-currency strategic options fail closed until verified FX normalization makes them comparable.
- Never compare nominal values across currencies.

## Capital
- Per-request actor capital can override saved capital.
- Configured reserve capital is protected before feasibility is evaluated.
- A strategy exceeding deployable capital is infeasible.

## Capabilities
- Required capabilities must be present in the actor state.
- Missing capability hard-stops feasibility.
- Future capability verification may distinguish declared vs independently verified capabilities.

## Value of Information
Information-gathering may become a strategy only when supplied evidence supports:
- information acquisition cost;
- expected decision-loss reduction;
- currency;
- evidence score;
- provenance.

```text
Expected Information Value
= expected decision-loss reduction
- information acquisition cost
```

Without attributable inputs, the information action remains research-only.

# Pareto frontier

Do not collapse all strategy into one arbitrary score first.

The engine eliminates dominated alternatives across dimensions such as:
- expected value;
- capital required;
- downside;
- reversibility;
- execution friction;
- evidence strength.

Personalized strategic fit is applied only after feasibility and Pareto comparison.

# Contingent policy

A strategy should carry:
- invalidation rules;
- switching rules.

This implements adaptive / formless strategy as policy rather than a static recommendation.

Example:

```text
Current strategy: brokerage

Invalidate if:
- buyer indication withdrawn;
- verified supplier capacity fails;
- compliance changes;
- quote expires.

Switch if:
- financing becomes available and principal trade becomes superior;
- margin falls below threshold;
- alternate buyer materially improves risk-adjusted economics.
```

# Doctrine registry

Implemented doctrines:
- know_self;
- know_terrain;
- timing;
- economy_of_force;
- indirect_approach;
- formlessness;
- foreknowledge.

Each doctrine carries:
- source = sunzi_derived;
- status = experimental;
- falsifiable_claim;
- measurement_hint.

No doctrine is automatically validated because it comes from Sunzi, a book, management literature or model preference.

# Learning packet

Before outcome observation, the primary strategy emits a pre-registered learning packet containing:
- strategy id;
- source candidate id;
- strategy type;
- doctrine ids;
- comparator strategy id;
- evaluated option ids;
- Pareto-frontier ids;
- pre-registered outcome metrics;
- invalidation rules;
- switching rules;
- epistemic boundary.

This is intended to reduce hindsight bias.

# Doctrine learning

`supabase/functions/_shared/strategic-doctrine-learning-v1.mjs`

The evaluator aggregates high-quality realized outcomes by doctrine and can compute:
- verified observation count;
- success rate;
- 95% Wilson interval;
- average realized net value;
- average incremental value vs supplied baseline;
- domain distribution.

It may label:
- insufficient_observations;
- positive_observed_association;
- negative_observed_association;
- mixed_or_neutral_observed_association.

It must always retain:

```text
causal_attribution_allowed = false
automatic_doctrine_promotion_allowed = false
```

Observed association is not proof that the doctrine caused the result.

# Current implementation

Core:
- `supabase/functions/_shared/strategic-doctrine-engine-v1.mjs`
- `supabase/functions/_shared/strategic-doctrine-learning-v1.mjs`

Integration:
- `supabase/functions/_shared/transaction-path-builder-v1.mjs`
- `supabase/functions/_shared/opportunity-engine-v1.mjs`
- `supabase/functions/build-transaction-paths/index.ts`
- `src/pages/OpportunityRadar.tsx`
- `src/components/opportunities/TransactionPathLab.tsx`

Tests:
- `tests/strategic-doctrine-engine-v1.test.mjs`
- `tests/strategic-doctrine-learning-v1.test.mjs`

# Strategic analysis extensions

## Sensitivity
Strategic options may carry explicit assumptions and supplied sensitivity cases.

A sensitivity case can contain:
- assumption;
- baseline value;
- shocked value;
- shocked expected value;
- evidence refs.

The engine reports:
- most-sensitive supplied assumption;
- expected-value delta;
- largest absolute delta;
- worst delta.

Sensitivity cases are labelled:
- `attributable` when evidence refs are supplied;
- `user_defined_scenario` when they are deliberate what-if inputs.

User-defined stress cases are useful decision tools but are not forecasts.

## Robustness and regret
For supplied scenario outcomes the engine can calculate:
- worst case;
- average case;
- best case;
- a downside-based robustness indicator.

When at least two strategies share the same scenario ids, AICIS can also calculate:
- maximum regret;
- average regret.

These calculations are scoped only to supplied scenarios. They do not imply scenario completeness or probability.

## Position value
A position-building option may become economically comparable only when attributable evidence supports:
- commitment cost;
- option-value estimate;
- currency;
- evidence score;
- provenance.

```text
Net position value
= option-value estimate
- commitment cost
```

Without provenance the position remains research-only.

## Strategic fingerprint
- `supabase/functions/_shared/strategic-audit-v1.mjs`
- `tests/strategic-audit-v1.test.mjs`

Every strategic response is fingerprinted before outcome observation using canonical JSON and SHA-256.

The fingerprint covers the complete strategic result before the audit object is attached, including:
- strategic state;
- evaluated options;
- primary strategy;
- Pareto frontier;
- doctrine trace;
- assumptions;
- sensitivity;
- robustness/regret;
- learning packet.

The fingerprint is not a blockchain and is not an external trusted timestamp. It is an integrity fingerprint that can detect substantive post-hoc mutation when compared with the retained pre-outcome hash.

## Doctrine-learning data integrity
Doctrine outcome evaluation:
- excludes duplicate decision ids entirely rather than double-counting them;
- separately reports outcomes linked to a valid 64-character strategic audit hash;
- permits high-quality but unlinked evidence to contribute to non-causal association analysis;
- never upgrades association to causal attribution automatically.

# Blocker-driven evidence acquisition

`supabase/functions/_shared/strategic-research-planner-v1.mjs`

When execution or strategic comparison is blocked, AICIS should not merely return an error and should not invent missing economics.

It generates research-only evidence tasks from observed blockers, including:
- refresh expired/unverified supplier quote;
- refresh expired/unverified buyer quote;
- refresh logistics quote/capacity;
- validate scenario inputs;
- obtain verified FX normalization for mixed-currency strategy comparison;
- obtain executable FX when reference FX is insufficient for execution;
- resolve a declared capability gap;
- investigate lower-capital structures when direct execution exceeds deployable capital and no evidenced indirect option exists;
- evidence information value;
- evidence position value;
- complete compliance review;
- verify public/licensed business contact channels;
- validate the most decision-sensitive assumption.

Every generated task must retain:
```text
research_only = true
transaction_eligible = false
expected_value = null
profit_claim = null
```

Tasks carry:
- explicit trigger;
- required evidence;
- completion criteria;
- suggested next safe step;
- priority: blocking | high | normal.

The planner is deterministic and de-duplicates shared blockers.

Its scope rule is:

> A research task says what evidence is missing. It does not assert that the missing alternative exists, that research will succeed, or that resolving the blocker will make the opportunity profitable.

# Research workflow orchestration

## Workflow router
`supabase/functions/_shared/strategic-research-workflow-v1.mjs`

The blocker-driven planner is not enough by itself. Every research action is additionally classified by whether AICIS has a safe existing workflow for it.

Workflow statuses:
- `ready`;
- `requires_context`;
- `provider_required`;
- `manual_research`;
- `unsupported`.

Ready workflows currently route to existing AICIS surfaces:
- supplier discovery;
- buyer discovery;
- logistics discovery;
- official reference FX;
- Know Yourself / actor profile;
- Transaction Lab evidence editor.

Important boundaries:
- counterparty discovery returns discovery candidates only;
- ECB/reference FX remains non-executable;
- executable FX remains provider-required until an attributable executable-quote adapter exists;
- compliance review requires a selected legal entity and human compliance decision;
- sensitive-assumption research remains manual unless a domain/source adapter is configured;
- a ready workflow never sends contracts, places orders, or moves money.

## Persistent research ledger

Migration:
`supabase/migrations/20260927150000_strategic_research_runs_v1.sql`

User-scoped table:
`public.strategic_research_runs_v1`

Each record is linked to:
- authenticated user;
- strategic pre-outcome audit hash;
- planner version;
- workflow version;
- action id/kind;
- immutable action snapshot;
- immutable action-snapshot SHA-256;
- priority;
- lifecycle state;
- source candidate id when applicable;
- attributable evidence refs;
- resolution metadata.

Lifecycle:
```text
pending
  → in_progress
  → blocked
  → resolved
  → stale
  → cancelled
```

Allowed transitions are governed by:
`supabase/functions/_shared/strategic-research-lifecycle-v1.mjs`

Terminal states:
- resolved;
- stale;
- cancelled.

Terminal records are not reopened. A new strategic audit should create a new task instead.

The database trigger blocks mutation of the original action identity/snapshot. Only lifecycle/evidence/resolution fields may evolve.

RLS:
- authenticated user may only select/insert/update their own research runs;
- anon/public receive no table privileges;
- service role retains administrative access.

## Research-run endpoints

- `sync-strategic-research-runs`
  - synchronizes an audited research plan;
  - inserts missing tasks;
  - preserves existing lifecycle state;
  - rejects immutable snapshot conflicts.

- `update-strategic-research-run`
  - applies governed lifecycle transitions;
  - merges valid evidence refs;
  - resolved tasks require attributable evidence or explicit resolution disposition.

- `list-strategic-research-runs`
  - returns only the authenticated user’s tasks under RLS;
  - supports status and audit-hash filtering.

- `complete-strategic-research-actions`
  - resolves open tasks only when a supported verified evidence event satisfies the corresponding blocker;
  - requires attributable evidence refs;
  - does not claim transaction profitability or approval.

## Evidence-backed completion mapping

`supabase/functions/_shared/strategic-research-completion-v1.mjs`

Current mappings:
```text
supplier_quote_verified  → refresh_supplier_quote
buyer_quote_verified     → refresh_buyer_quote
logistics_route_verified → refresh_route_quote
reference_fx_attached    → verified_fx_normalization
executable_fx_verified   → obtain_executable_fx_quote
business_contact_verified → verify_business_contact
```

Reference FX must never resolve the executable-FX blocker.

Completion disposition:
```text
evidence_satisfied_blocker
```

This means the missing evidence requirement was satisfied. It does not mean the strategy succeeded, is profitable, or is approved for execution.

## Opportunity Radar research UX

- `src/components/opportunities/StrategicResearchTracker.tsx`
- `src/components/opportunities/TransactionPathLab.tsx`

Behavior:
1. Transaction Lab produces blocker-driven research actions.
2. Safe actions expose one-click handoffs only when workflow status is `ready`.
3. Starting a ready workflow synchronizes the audited plan and marks the task `in_progress`.
4. Open tasks persist across sessions in Strategic Research Tracker.
5. Verified supplier/buyer/route/reference-FX evidence can automatically resolve only the matching open blocker.
6. The open tracker refreshes immediately when a blocker is resolved.
7. Provider-required/context-required/manual tasks remain visibly blocked rather than appearing runnable.

# Research persistence truth rules

- Do not reuse internal service-role agent coordination tables for user opportunity research.
- Research task persistence is user-scoped and separate from multi-agent governance queues.
- Original blocker/action snapshots are immutable.
- Tracking failure must not be represented as successful persistence.
- A research handoff may remain usable even if persistence is temporarily unavailable, but the UI must say it is untracked.
- Resolving a research task means evidence satisfied that blocker only.
- A resolved blocker does not automatically make the parent transaction execution-ready.
- Rebuild and re-evaluate after material evidence changes.

# Candidate-scoping rule

Strategic alternatives, scenarios and sensitivity cases may optionally declare:
- source_id;
- buyer_id;
- route_id;
- transaction_type.

When a scope is declared, the path builder must attach the item only to matching transaction candidates.

Unscoped items intentionally apply across the supplied candidate set.

This prevents evidence or strategy assumptions for Supplier A / Route A from leaking into unrelated Supplier B / Route B candidates.

# Governing principles

- Evidence precedes strategy.
- Unknown stays unknown.
- Strategy is not execution.
- Recommendation is scoped to evaluated options.
- No action is a valid strategy.
- Lower capital is not automatically better.
- Higher expected value is not automatically better.
- Information can be the first strategic action.
- Timing can invalidate an otherwise sound strategy.
- Strategy should adapt when pre-registered conditions change.
- Doctrine is a hypothesis to test against realized outcomes.
- Association is not causation.
- Human approval remains mandatory before external execution.
