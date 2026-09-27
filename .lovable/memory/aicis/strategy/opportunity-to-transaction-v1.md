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

## Personalized research surface
- `/opportunities` → `src/pages/OpportunityRadar.tsx`
- existing AICIS relevance preferences are reused rather than duplicated;
- user controls now include objective, risk tolerance, available capital, cash reserve, cycle limit, minimum margin/evidence/relevance/rank, single-position concentration, country/sector concentration, position count and allowed transaction types.

## Signal → opportunity hypothesis
- `supabase/functions/_shared/opportunity-hypothesis-v1.mjs`
- `supabase/functions/generate-opportunity-hypotheses/index.ts`
- `src/components/opportunities/OpportunityHypothesesPanel.tsx`
- maps only explicitly supported products mentioned in relevant signals;
- produces research hypotheses, never price direction, profit or causal claims;
- one-click handoff pre-fills counterparty discovery.

## Counterparty discovery
- `supabase/functions/_shared/counterparty-discovery-v1.mjs`
- `supabase/functions/discover-transaction-counterparties/index.ts`
- `src/components/opportunities/CounterpartyDiscoveryPanel.tsx`
- Firecrawl/open-web results remain `discovery_only_unverified`;
- discovery candidates are always `transaction_eligible=false`;
- only generic public business mailboxes are surfaced; personal-looking addresses are excluded.

## Counterparty verification
- `supabase/functions/_shared/counterparty-verification-v1.mjs`
- `supabase/functions/verify-transaction-counterparty/index.ts`
- requires legal identity, jurisdiction/registration, official-site evidence, compliance evidence, current attributable quote, capacity evidence and payment terms;
- only a complete clear dossier normalizes into a supplier/buyer offer;
- compliance `review` or `blocked` never becomes transaction eligible.

## Transaction path construction
- `supabase/functions/_shared/transaction-path-builder-v1.mjs`
- `supabase/functions/build-transaction-paths/index.ts`
- `src/components/opportunities/TransactionPathLab.tsx`
- enumerates supplied supplier × buyer × route × structure combinations;
- calculates quote-backed purchase, route and structure costs;
- rejects expired, provenance-free, route-incompatible and currency-incompatible paths;
- cross-currency paths fail closed until a verified FX layer exists.

## Personalized transaction ranking
- `supabase/functions/_shared/opportunity-engine-v1.mjs`
- `supabase/functions/rank-opportunities/index.ts`
- evaluates economics, relevance, evidence, counterparty quality, liquidity, risk and user constraints;
- `no transaction` is a valid recommendation;
- every ranking is explicitly scoped to evaluated candidates.

## Execution dossier
Every ranked candidate can carry:
- source and destination;
- counterparties and public/licensed business contacts;
- route and logistics;
- timing and quote validity;
- full cost breakdown;
- downside/base/upside scenario fields;
- next actions;
- explicit missing execution fields.

A candidate can be rankable yet remain `execution_ready=false`.

## Portfolio allocation
- `supabase/functions/_shared/opportunity-portfolio-optimizer-v1.mjs`
- exact subset optimization for small candidate sets;
- heuristic allocation for larger sets with `optimality_proven=false`;
- preserves a configured cash reserve;
- enforces country, sector and position-count concentration limits;
- mixed currencies fail closed pending a verified FX layer;
- allocation remains advisory and requires human approval.

## Current tests
- `tests/opportunity-hypothesis-v1.test.mjs`
- `tests/counterparty-discovery-v1.test.mjs`
- `tests/counterparty-verification-v1.test.mjs`
- `tests/transaction-path-builder-v1.test.mjs`
- `tests/opportunity-transaction-engine-v1.test.mjs`
- `tests/opportunity-portfolio-optimizer-v1.test.mjs`

## Official sanctions coverage
- `supabase/functions/_shared/official-sanctions-screen-v1.mjs`
- `supabase/functions/screen-transaction-counterparty/index.ts`
- `src/components/opportunities/SanctionsScreenPanel.tsx`
- current official-source adapters:
  - US OFAC SDN;
  - UN Consolidated List;
  - UK Sanctions List;
  - EU Financial Sanctions File (FSF), with fail-closed handling if the Commission bulk endpoint is unavailable or parses to zero records;
- exact normalized-name and exact identifier matches are review triggers, never automatic legal determinations;
- incomplete source coverage can never be labelled clear;
- even a complete no-match screen remains `compliance_status=review` until an explicit human compliance decision supplies clear evidence.

## FX truth floor
- `supabase/functions/_shared/verified-fx-v1.mjs`
- `supabase/functions/_shared/ecb-reference-fx-v1.mjs`
- `supabase/functions/fetch-reference-fx/index.ts`
- research-comparison FX and execution-ready FX are distinct:
  - `official_reference` and `verified_market` may support comparative economics;
  - only `executable_quote` may satisfy final FX execution readiness;
- stale, provenance-free or missing FX fails closed;
- saved opportunity preferences include a comparison/base currency;
- ECB reference rates are explicitly labelled non-executable.

## Counterparty verification UX
- `src/components/opportunities/CounterpartyVerificationLab.tsx`
- sanctions evidence can seed a verification dossier only as `review`;
- legal identity, official-site evidence, current quote, capacity and payment terms remain required;
- a successful normalized supplier/buyer offer can be injected directly into the Transaction Lab;
- normalized offer IDs are de-duplicated on insertion.

## Logistics verification
- `supabase/functions/_shared/logistics-route-verification-v1.mjs`
- `supabase/functions/verify-logistics-route/index.ts`
- `src/components/opportunities/LogisticsRouteVerificationLab.tsx`
- a logistics company is not a route;
- a route becomes transaction-eligible input only after provider identity/compliance, current route quote, transit time, capacity and all cost components have attributable evidence;
- verified routes can be inserted directly into the Transaction Lab;
- logistics candidates pass through the same official sanctions review before route verification.

## Transaction-lab handoff chain
The intended UI path is now:
1. personalized signal;
2. product hypothesis;
3. supplier / buyer / logistics discovery;
4. official sanctions screening;
5. supplier/buyer verification or logistics-route verification;
6. verified offer/route insertion into Transaction Lab;
7. verified/reference FX attachment as needed;
8. path build;
9. personalized rank;
10. portfolio allocation;
11. explicit human approval boundary.

No step may silently promote discovery-only or review-only evidence into executable state.

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
