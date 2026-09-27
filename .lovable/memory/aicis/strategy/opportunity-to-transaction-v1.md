---
name: AICIS Opportunity-to-Transaction Engine v1
description: Canonical doctrine for personalized opportunity discovery, transaction ranking, supply-chain economics and human-approved execution
type: feature
---

# Mission

AICIS should transform verified global intelligence into **personalized, auditable opportunity research and transaction decision support**.

The opportunity stack extends the core AICIS value chain:

```text
Data
→ Signals
→ Verified Events
→ Relevance
→ Opportunity Hypotheses
→ Counterparty / Asset Mapping
→ Full Transaction Economics
→ Feasibility & Compliance
→ Personalized Ranking
→ Human Approval
→ Execution Connector
→ Realized Outcome
→ Learning
```

The system must never imply that more data guarantees profit.

# User question

For every candidate opportunity AICIS should eventually answer:

1. What is the opportunity?
2. Why is it relevant to this user?
3. Where is the best feasible source among evaluated candidates?
4. Who are the verified counterparties?
5. What is the best feasible selling destination among evaluated candidates?
6. What transaction structure is most capital-efficient?
7. What is the full cost from source to settlement?
8. What are downside, base and upside economics?
9. What is the expected cash cycle and capital lock-up?
10. What evidence supports every material input?
11. What would invalidate the thesis?
12. What should the user do next?
13. Is no transaction currently preferable?

# Personal relevance

Do not build a second, disconnected personalization system.

Opportunity ranking must reuse:
- countries;
- operating regions;
- industries;
- domains;
- watched entities;
- keywords;
- risk priorities;
- business functions.

Transaction-specific preferences are stored under:

```json
aicis_relevance_preferences.alert_preferences.opportunity_profile
```

v1 fields:
- objective: balanced | net_profit | return_on_capital | profit_velocity | capital_preservation
- risk_tolerance: low | balanced | high
- capital_available
- max_cycle_days
- min_base_margin_pct
- min_evidence_score
- min_relevance_score
- minimum_rank_score
- max_single_opportunity_capital_pct
- allowed_transaction_types
- excluded_countries
- excluded_sectors
- manual_approval_required = true

# Ranking semantics

"Best" means **top-ranked among the candidate set that AICIS actually evaluated**.

Never say:
- globally best supplier;
- globally best buyer;
- guaranteed highest profit;
- guaranteed profit;
- highest-return transaction in the world;

unless candidate coverage is demonstrably exhaustive, which should normally be treated as unknown.

A ranking combines:
- objective fit;
- expected economics;
- downside / risk fit;
- evidence strength;
- personal relevance;
- counterparty quality;
- liquidity / ability to complete;
- capital and cash-cycle constraints;
- compliance eligibility.

Headline profit alone must not determine rank.

# Economics truth floor

An executable transaction candidate must have attributable inputs for at least:
- capital required;
- expected revenue;
- expected total cost;
- downside loss;
- cycle days;
- completion probability or explicitly calibrated equivalent;
- evidence score;
- transaction type;
- compliance state;
- economics status.

Synthetic, missing or unverified prices/costs/profits must fail closed.

Allowed economics statuses should describe evidence quality, for example:
- verified_quotes
- observed_market
- contractually_indicated

Statuses such as synthetic, unverified or insufficient must never be ranked as executable profit opportunities.

# Supply-chain economics

The mature engine should compute every material layer, not just buy price and sell price:

```text
producer / supplier
→ aggregation
→ processing
→ inland transport
→ inspection / certification
→ export handling
→ international freight
→ insurance
→ duties / taxes
→ financing / FX
→ import handling
→ warehousing
→ distribution
→ buyer
→ settlement
```

AICIS should compare alternative paths and may conclude that:
- a more expensive supplier is better after quality/reliability;
- a lower-paying buyer is better because settlement is faster;
- local processing improves margin;
- brokerage is better than owning inventory;
- a different destination has better landed economics;
- no transaction clears the threshold.

# Counterparty layer

Future candidate enrichment should contain:
- legal company identity;
- role in chain;
- jurisdiction;
- official website;
- public/licensed business contact channels;
- procurement/sales channel;
- quoted price and timestamp;
- minimum order quantity;
- payment terms;
- delivery terms / Incoterm where relevant;
- reliability / fulfillment evidence;
- sanctions and compliance state;
- source provenance.

Do not infer private personal contact data.

# Contact and execution assistance

AICIS may prepare:
- RFQs;
- supplier inquiries;
- buyer offers;
- procurement requests;
- quote comparisons;
- purchase-order drafts;
- logistics checklists;
- due-diligence packs;
- transaction approval packs.

Sending messages, signing contracts, placing orders, moving money or submitting broker orders are separate actions requiring explicit authorization and the permissions of the connected external system.

# Financial-market boundary

AICIS already contains a fail-closed market-data function. Preserve that truth floor.

Do not generate "realistic" prices, volumes, executions or profits.

Before financial-market candidates can be executable, add:
- attributable market-data adapter;
- symbol / asset exposure mapping;
- point-in-time historical replay;
- slippage / spread / fee model;
- out-of-sample validation;
- paper execution;
- portfolio and concentration limits;
- execution connector with kill switch;
- human authorization.

# Current v1 implementation

Canonical shared deterministic engine:
`supabase/functions/_shared/opportunity-engine-v1.mjs`

Authenticated ranking endpoint:
`supabase/functions/rank-opportunities/index.ts`

Tests:
`tests/opportunity-transaction-engine-v1.test.mjs`

Workspace:
`/opportunities` → `src/pages/OpportunityRadar.tsx`

The workspace currently:
- reads existing personalized signal relevance;
- lets a user set transaction-objective constraints;
- stores those constraints in the existing relevance preference record;
- surfaces a research queue;
- clearly separates research signals from executable transaction candidates.

# Required next build sequence

1. Candidate schema and immutable evidence links.
2. Asset / product / counterparty mapping.
3. Quote and market-data provider adapters.
4. Full landed-cost / settlement economics.
5. Candidate builder from verified signal + economic evidence.
6. Personalized rank endpoint integration into the UI.
7. Alternative-path optimizer across supplier × route × buyer × structure.
8. Scenario ranges and thesis invalidation rules.
9. Paper transaction ledger and realized-outcome scoring.
10. Human-approved external execution connectors.
11. Portfolio allocation and capital recycling optimizer.
12. Learning loop based on realized outcomes, never self-reported synthetic profit.

# Governing rules

- Unknown stays unknown.
- Prediction is not causality.
- Recommendation is not execution.
- Ranking is scoped to evaluated candidates.
- Profit is not guaranteed.
- No transaction is a valid recommendation.
- Evidence precedes recommendation.
- Every material economic input should be attributable.
- Human approval remains mandatory for execution in v1.
