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
