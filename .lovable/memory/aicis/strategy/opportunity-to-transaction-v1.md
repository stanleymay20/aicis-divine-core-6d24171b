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

# Provider-neutral execution preview

## Core implementation

- `supabase/functions/_shared/execution-quote-contract-v1.mjs`
- `supabase/functions/preview-execution/index.ts`
- `src/components/opportunities/ExecutionPreviewPanel.tsx`
- `tests/execution-quote-contract-v1.test.mjs`

The execution-preview layer sits **after** transaction/strategy evaluation and **before** any future external execution connector.

It can:
- validate a normalized provider quote;
- enforce candidate binding;
- reject stale/future/provenance-free quotes;
- reject secret-bearing payloads;
- select bid/ask/rate according to side/instrument;
- calculate gross notional and explicit quote costs;
- fingerprint the normalized quote and preview package;
- create a human-review request object;
- normalize zero-explicit-cost provider-attested FX into the existing verified-FX schema.

It cannot:
- submit a provider order;
- sign a contract;
- move money;
- mutate an external brokerage account;
- mint an approval token;
- treat user-pasted JSON as provider-authenticated evidence.

## Quote statuses

Input quote claims may use:
- `indicative`;
- `verified_market`;
- `official_reference`;
- `executable_quote`.

A syntactically valid `executable_quote` claim is **not** executable evidence by itself.

Server-side provider attestation is separately required.

Without provider attestation:
```text
preview_status = unattested_quote
normalized_fx_rate = null
human_approval_package_ready = false
```

This prevents manually supplied JSON from bypassing a real provider adapter.

## Provider attestation boundary

Only trusted server-side provider-adapter code may call the execution contract with:
```text
provider_attested = true
```

The generic `preview-execution` endpoint currently sets:
```text
provider_attested = false
```

because it accepts a user-supplied normalized quote.

A future provider adapter must:
- authenticate to the provider using server-side or connected-account credentials;
- retrieve the provider response itself;
- preserve provider quote/order identifiers;
- preserve observed time and validity/freshness;
- retain attributable evidence;
- normalize without accepting provider credentials in the client request;
- call the shared contract only after provider response verification.

## Candidate binding

Every quote must carry:
```text
execution_context.candidate_id
execution_context.purpose
```

Allowed purposes:
- `primary_transaction`;
- `fx_conversion`;
- `fee_estimate`.

The candidate id must match the AICIS candidate being previewed.

An FX quote must use:
```text
purpose = fx_conversion
side = convert
```

This prevents an unrelated quote from being attached to a different strategy/candidate.

## Secret boundary

Execution-preview payloads reject fields whose keys imply:
- passwords;
- secrets;
- API keys;
- access/refresh tokens;
- authorization headers;
- private keys;
- client secrets.

Masked account references are permitted.

Provider credentials belong only in the provider connector / server secret boundary.

## FX cost truth floor

An executable FX quote may be injected into `fx_rates` only when:
- it is provider-attested;
- current;
- attributable;
- candidate-bound;
- status = `executable_quote`;
- it has no explicit costs that would be lost by converting it into a bare rate.

If explicit FX commission/fees are present:
```text
normalized_fx_rate = null
fx_handoff_blocked_reason =
  explicit_fx_costs_require_transaction_cost_integration
```

AICIS must not improve apparent transaction economics by silently dropping FX costs.

## Human-review package

A provider-attested executable quote may produce an auditable review request containing:
- strategic audit hash;
- quote hash;
- preview hash;
- candidate id;
- provider quote id;
- quote expiry;
- idempotency key.

It still retains:
```text
approval_status = not_approved
approval_token = null
executable_action_available = false
```

If new evidence changes the transaction bundle, the prior ranking is stale and the user must rebuild before approval readiness can be reconsidered.

## Interactive Brokers what-if adapter v1

Implementation:
- `supabase/functions/_shared/ibkr-order-preview-v1.mjs`
- `supabase/functions/preview-execution-ibkr/index.ts`
- `supabase/functions/execution-provider-status/index.ts`
- `src/components/opportunities/IbkrWhatIfPreviewPanel.tsx`
- `tests/ibkr-order-preview-v1.test.mjs`
- `tests/ibkr-preview-adapter-source-guard.test.mjs`

Purpose:
- real server-side provider order preview;
- market-data snapshot + commission/margin impact;
- no order submission.

Server-only configuration:
```text
IBKR_WEB_API_BASE_URL
IBKR_WEB_API_BEARER_TOKEN
IBKR_ACCOUNT_ID
```

Client requests never contain the broker bearer token or account id.

The adapter requires the configured brokerage session to already be authenticated.
It checks `/iserver/auth/status` and fails closed if the session is not authenticated.
It deliberately does not initialize or compete for a brokerage session.

Market-data flow:
1. call `/iserver/marketdata/snapshot` as pre-flight;
2. wait a bounded local delay;
3. call the snapshot endpoint again for fields:
   - last;
   - bid;
   - ask;
   - ask size;
   - bid size;
   - market-data availability;
4. preserve the provider `_updated` timestamp.

Order-preview flow:
- v1 allows only:
  - BUY or SELL;
  - LMT order;
  - DAY time-in-force;
  - positive conid / quantity / limit price.
- call only:
  `/iserver/account/{accountId}/orders/whatif`
- retain:
  - provider amount;
  - commission;
  - total;
  - equity impact;
  - initial-margin impact;
  - maintenance-margin impact;
  - position impact;
  - provider warning/error.

The what-if response receives its own retrieval timestamp and SHA-256 fingerprint.
The market snapshot receives a separate SHA-256 fingerprint.

The adapter must always retain:
```text
order_endpoint_called = false
order_submitted = false
money_moved = false
approval_token = null
```

The source guard test prevents an accidental place-order endpoint from being introduced.

Provider capability status is exposed without secrets.
The UI distinguishes:
- adapter code exists;
- server-side provider session configured;
- provider-attested executable quote capability;
- order submission capability.

In v1:
```text
market_snapshot = configured provider session
order_preview_whatif = configured provider session
provider_attested_executable_quote = false
order_submission = false
money_movement = false
```

A provider what-if preview is useful evidence about costs/margin, but it is **not** itself an executable quote and does not authorize a trade.

## Legacy governance trade quarantine

Historical endpoints:
- `gov-initiate-trade`;
- `gov-execute-trade`.

They previously used demo pricing / internal SC-wallet mutation.

They now fail closed with HTTP 410 after authentication:
- no wallet lock;
- no wallet debit;
- no governance-trade insert;
- no SC ledger execution write.

The legacy Governance Market UI is view-only and routes users to Opportunity Radar.

Regression guard:
- `tests/legacy-governance-trade-quarantine.test.mjs`

The legacy endpoints must never become a parallel execution path beside the audited execution architecture.

# Physical-trade RFQ workflow v1

## Implementation

Core contracts:
- `supabase/functions/_shared/rfq-contract-v1.mjs`
- `supabase/functions/_shared/rfq-quote-comparison-v1.mjs`

Authenticated Edge Functions:
- `generate-rfq-draft`
- `normalize-rfq-response`
- `compare-rfq-responses`

UI:
- `src/components/opportunities/RfqDraftPanel.tsx`
- integrated into `TransactionPathLab`

Tests:
- `tests/rfq-contract-v1.test.mjs`
- `tests/rfq-quote-comparison-v1.test.mjs`
- RFQ metadata lineage is guarded in `tests/transaction-path-builder-v1.test.mjs`.

## Candidate lineage

Verified transaction paths preserve procurement metadata needed to draft an RFQ:
- product id/name/unit/specification;
- transaction quantity/unit;
- supplier/buyer role;
- registration id;
- official website;
- compliance status;
- payment terms;
- Incoterm;
- public/licensed business contact;
- evidence refs.

RFQ drafting must use this preserved candidate lineage instead of reconstructing identity from display text.

## RFQ draft truth boundary

A valid RFQ draft requires:
- strategic audit hash;
- transaction candidate id;
- counterparty id, legal name, jurisdiction and clear compliance;
- attributable counterparty evidence;
- public/licensed business contact;
- product identity;
- positive quantity/unit;
- destination;
- requested Incoterm(s);
- requested payment terms;
- valid currency preferences when supplied;
- a future response deadline.

Generic business email channels are allowed.
Personal-looking email addresses are not treated as verified business channels.

RFQ text is deterministic and must explicitly state that it is:
- a request for quotation / due-diligence inquiry;
- not a purchase order;
- not a contract;
- not a commitment;
- not authorization to supply.

The generated object always retains:
```text
human_approval_required_before_send = true
approved_to_send = false
approval_token = null
sent = false
outbound_message_sent = false
purchase_order_created = false
contract_signed = false
money_moved = false
```

v1 supports **draft + copy for human review only**.
No outbound email/message provider is wired.

## RFQ response truth boundary

A returned supplier/buyer quote may be normalized only when attributable evidence is supplied.

Normalization still forces:
```text
evidence_status = rfq_response_unverified
transaction_eligible = false
```

The response must pass the existing counterparty/commercial verification stack before it may become a source/sale offer.

The RFQ UI may seed Counterparty Verification, but deliberately leaves:
- legal-identity evidence incomplete;
- official-site evidence incomplete;
- compliance = review;
- capacity evidence incomplete;
- payment-term evidence incomplete.

This prevents the RFQ response itself from silently verifying the company or quote.

## Cost-completeness evidence

Allowed response cost-completeness states:
- `quoted_price_only`;
- `explicit_additional_costs`;
- `full_landed_cost`.

Any claim beyond `quoted_price_only` requires attributable
`cost_completeness_evidence_refs`.

Every explicit additional cost must contain:
- cost type;
- non-negative amount;
- basis = fixed | per_unit;
- ISO currency;
- evidence refs.

A `full_landed_cost` label without evidence must never unlock quote ordering.

## RFQ quote comparison

Quote comparison is research-only.

A lowest evaluated landed-cost response is allowed only when at least two normalized responses have:
- the same RFQ id;
- same product;
- same quantity;
- same quantity unit;
- same Incoterm;
- same named place/port;
- same payment terms;
- evidenced `full_landed_cost` completeness;
- current quote validity;
- comparable total costs;
- one comparison currency.

Cross-currency comparison reuses the canonical AICIS verified-FX layer.
No procurement-specific FX subsystem is allowed.

If any of those conditions fail:
```text
ordering_allowed = false
lowest_evaluated_landed_cost_response = null
```

When ordering is allowed, the semantics are explicitly:
```text
lowest_landed_cost_among_supplied_unverified_rfq_responses_not_supplier_recommendation
```

Even the lowest landed-cost response retains:
```text
transaction_eligible = false
human_verification_required = true
```

A lower quoted unit price is never assumed to mean lower landed cost.

# Landed-cost evidence truth floor v1

## Implementation

Core:
- `supabase/functions/_shared/landed-cost-evidence-v1.mjs`
- `supabase/functions/verify-landed-cost-evidence/index.ts`
- `src/components/opportunities/LandedCostVerificationPanel.tsx`

Integration:
- `supabase/functions/_shared/transaction-path-builder-v1.mjs`
- `supabase/functions/_shared/opportunity-engine-v1.mjs`
- `supabase/functions/_shared/strategic-research-planner-v1.mjs`
- `supabase/functions/_shared/strategic-research-workflow-v1.mjs`
- `supabase/functions/_shared/strategic-research-completion-v1.mjs`
- `src/components/opportunities/TransactionPathLab.tsx`
- `src/components/opportunities/StrategicResearchTracker.tsx`

Tests:
- `tests/landed-cost-evidence-v1.test.mjs`
- landed-cost transaction accounting in `tests/transaction-path-builder-v1.test.mjs`
- ranking/execution boundaries in `tests/opportunity-transaction-engine-v1.test.mjs`
- research planner/workflow/completion tests.

## Required physical-trade coverage

A physical-trade landed-cost stack must account for every category below as:
- `included_here`;
- `covered_elsewhere`;
- `not_applicable`;
- or `unknown`.

Required categories:
1. origin inland transport;
2. origin handling;
3. export customs;
4. export duty/tax;
5. international freight;
6. cargo insurance;
7. import duty;
8. import tax;
9. customs brokerage;
10. destination handling;
11. inspection/certification;
12. financing;
13. storage/distribution.

`unknown` is a blocker.

`covered_elsewhere` requires an existing cost identity and attributable evidence.

`not_applicable` requires an explicit reason and attributable evidence.

The system must not silently omit a category merely because another quote or Incoterm might appear to cover it.

## Customs and tax truth boundary

AICIS must not infer:
- HS classification;
- tariff rate;
- customs value;
- tax basis;
- tax recoverability;
- preferential-origin eligibility;
- legal applicability of a customs/tax rule.

When a customs/tax component depends on classification, an attributable HS classification must be supplied.

Official rules must carry attributable provenance and an effective period.
Commercial quotes must remain current at evaluation time.

## Calculation models

Evidence-backed components may use:
- fixed amount;
- per-unit amount;
- percentage of an attributable basis.

A percentage rule is invalid unless the calculation basis itself has attributable evidence.

## Economic cost vs cash requirement

The engine keeps economic cost separate from recoverable-tax cash flow.

```text
expected_cost
= purchase
+ route/logistics economic cost
+ structure economic cost
+ verified landed-cost economic components
```

Recoverable tax is not automatically counted as profit-reducing economic cost.

For full-landed-cost capital models:

```text
cash_required
= expected_cost
+ recoverable_tax_cash_flow
```

This prevents both:
- overstating profit cost by treating recoverable tax as permanent expense; and
- understating required working capital by ignoring the temporary tax cash outflow.

## FX boundary

Landed-cost normalization reuses the canonical verified-FX layer.

- same currency: no FX evidence required;
- official/reference/verified-market FX may support research comparison;
- execution readiness requires execution-eligible FX where conversion is required.

No procurement-specific or customs-specific FX subsystem should be created.

## Builder and ranking behavior

The path builder may retain a physical-trade candidate for research when landed-cost evidence is incomplete.

It must then emit:

```text
landed_cost_complete = false
landed_cost_execution_ready = false
```

This preserves the candidate id and scope needed to collect evidence.

The opportunity engine must hard-reject that candidate from eligible profit ranking with:

```text
landed_cost_incomplete
```

A research-complete stack may become rankable while still remaining non-executable when:

```text
landed_cost_complete = true
landed_cost_execution_ready = false
```

The execution dossier must then retain:

```text
execution_grade_landed_cost_evidence
```

as a missing execution field.

## Scoped evidence packs

Verified landed-cost evidence is attached through `landed_cost_packs`.

A pack is scoped by:
- source id;
- buyer id;
- route id;
- transaction type.

The pack may also bind to the deterministic candidate id.

Evidence for one path must never contaminate another supplier, buyer, route or structure.

Attaching a new pack makes the previous:
- economics;
- rank;
- strategy;
- portfolio allocation

stale and requires a complete rebuild.

## Landed Cost Verification UI

The verification panel is available even when no physical-trade candidate is ranked because incomplete landed-cost evidence correctly caused `NO TRANSACTION`.

The panel may conservatively mark a cost as `covered_elsewhere` only when the existing candidate already carries attributable evidence for that exact known cost.

It must not auto-infer customs, duties, tax, brokerage, financing, storage or legal applicability.

A completed evidence pack can be attached to the transaction bundle and rebuilt.

## Research loop

Incomplete coverage creates a blocking action:

```text
verify_landed_cost_evidence
```

A research-complete but non-execution-grade stack creates:

```text
upgrade_landed_cost_execution_evidence
```

Both route to the existing `landed_cost_verification` workflow.

Completion kinds:
- `landed_cost_verified` resolves only the incomplete-coverage blocker;
- `landed_cost_execution_evidence_verified` resolves only the execution-evidence upgrade blocker.

Evidence completion records satisfaction of a research blocker, not profit success or transaction authorization.

## External-action boundary

Landed-cost verification never:
- files a customs declaration;
- claims legal tariff treatment;
- binds insurance;
- accepts financing;
- creates a purchase order;
- signs a contract;
- submits a payment;
- moves money.

```text
transaction_eligible = false
human_review_required = true
```

The verified cost stack is evidence for decision support. It is not authorization to transact.

# Official customs evidence routing and TARIC normalization v1

## Official source routing

Implementation:
- `supabase/functions/_shared/official-customs-source-plan-v1.mjs`
- `supabase/functions/plan-official-customs-evidence-sources/index.ts`
- official-source guidance in `LandedCostVerificationPanel`
- `tests/official-customs-source-plan-v1.test.mjs`

The source planner identifies authoritative research sources. It does **not** extract or apply a duty/tax rate.

Current configured source registry:

### EU TARIC
Authority:
European Commission — DG TAXUD.

Research scope:
- EU common customs tariff;
- third-country duties;
- preferences;
- suspensions;
- quotas;
- trade-defence measures;
- EU import/export controls;
- goods nomenclature.

Important exclusion:
TARIC does not contain national VAT or national excise rates.

Therefore TARIC must never be used as the source for a German/French/etc. national import-tax rate.

### Germany EZT
Authority:
German Customs Administration / Generalzolldirektion.

Research scope:
- TARIC-derived tariff/customs measures;
- German national customs information;
- German import-VAT display;
- German excise information.

For a Germany-bound import, AICIS may route:
- common EU tariff evidence → TARIC;
- German national import-tax/excise evidence → EZT.

For another EU Member State, TARIC may supply common EU measures, but a destination-country official source is still required for national VAT/excise until a dedicated adapter is configured.

For a non-EU destination without a configured official national source, the planner must return a provider/source blocker rather than infer a rate.

Source-plan outputs always retain:
```text
automated_rate_extraction_performed = false
customs_rate = null
tax_rate = null
legal_determination_made = false
transaction_eligible = false
```

## TARIC raw extraction semantics

Current Commission extraction documentation describes TARIC duty rows using columns A–L:

A. goods code (10 digits);
B. additional code;
C. tariff quota order number;
D. measure validity start;
E. measure validity end;
F. reduction indicator;
G. origin/destination description;
H. measure-type description;
I. legal reference;
J. duty expression;
K. origin/destination code;
L. measure-type code.

The Commission documentation also requires broader TARIC logic when determining actual applicability, including:
- goods-nomenclature parent cascade;
- geographical-area membership;
- measure exclusions;
- measure conditions;
- additional codes when present;
- tariff quota status when present;
- agricultural reduction indicators when present;
- compound duty-expression rules when present.

## TARIC row normalizer

Implementation:
- `supabase/functions/_shared/taric-duty-row-normalizer-v1.mjs`
- `supabase/functions/normalize-taric-duty-row/index.ts`
- `tests/taric-duty-row-normalizer-v1.test.mjs`

The normalizer accepts an attributable official extraction row and preserves the documented A–L semantics.

It may parse a syntactically simple expression such as:
```text
74.900 %
```

into:
```text
kind = simple_ad_valorem_percentage
candidate_rate_pct = 74.9
```

That parse is only syntax.

It must retain:
```text
applicability_status = unresolved
landed_cost_component = null
tariff_rate_claimed_applicable = false
legal_determination_made = false
transaction_eligible = false
```

A compound expression such as a percentage combined with minimum/maximum unit duties must remain complex/conditional rather than being reduced to the first visible percentage.

The normalizer requires:
- official extraction reference date;
- observation time;
- SHA-256 provenance for the source artifact.

## Raw-data freshness boundary

TARIC online consultation is the authoritative current consultation surface.

The Commission's extraction documentation describes monthly extraction snapshots plus daily-update files.
Raw extraction ingestion must preserve:
- extraction reference date;
- observation/download time;
- source digest;
- whether daily updates have been reconciled.

A monthly extraction alone must not be represented as guaranteed current when subsequent daily updates may exist.

## Next TARIC build boundary

Before a TARIC measure can become a landed-cost component, AICIS still needs a deterministic applicability layer over attributable:
- nomenclature hierarchy;
- geographical-area composition;
- exclusions;
- conditions;
- additional codes;
- quota state where applicable;
- business-code semantics;
- origin evidence.

Until those dependencies exist and are resolved:
```text
official row ≠ applicable tariff
parsed percentage ≠ payable duty
```

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
