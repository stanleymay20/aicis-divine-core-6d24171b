# AICIS Intelligence Source & Evidence Fabric v1

Status: **controlled candidate; not deployed**

## Purpose

AICIS needs more than source URLs attached to intelligence outputs. It needs a reproducible chain showing what source artifact existed, when it became knowable, how it was transformed, which claims were extracted, how those claims were assessed, and which downstream facts or forecasts depended on them.

Evidence Fabric v1 defines that chain without turning provenance metadata into an automatic truth score.

```text
Source / Provider
      ↓
Immutable Artifact
      ↓
Transformation Activity
      ↓
Claim
      ↓
Independent Assessment
      ↓
Fact Lineage
      ↓
Normalized Event / Metric / Signal / World State
      ↓
Forecast
      ↓
Future Resolution + Score
```

## Compatibility with the existing AICIS ingestion layer

Evidence Fabric v1 is additive.

Existing structures remain useful:

- `data_provider_registry` identifies recurring providers and ingestion status;
- `provider_runs` records ingestion executions;
- `provider_raw_payloads` preserves replay/audit payloads and existing payload hashes;
- `normalized_events` and `normalized_metrics` remain canonical downstream facts;
- `data_provenance` remains available for historical compatibility;
- cognitive `Provenance` and `EvidenceClaim` contracts remain useful application-level concepts.

Evidence Fabric v1 does **not** treat legacy `data_provenance.confidence`, `quality_score`, or `freshness_score` defaults as scientifically admissible evidence. The compatibility view exposes those rows as `legacy_unverified` and returns `NULL` for admissible quantitative confidence/quality.

## Core objects

### 1. Immutable artifact

`aicis_evidence_artifacts_v1`

Represents one exact source artifact or source record revision. It records:

- source identity/class/provider;
- source and canonical URI when available;
- license/media type;
- SHA-256 artifact identity;
- optional link to `provider_raw_payloads`;
- publication, retrieval, first-observation, valid-time, and knowledge-time fields;
- knowledge-time verification status;
- revision/supersession links;
- optional C2PA and STIX interoperability metadata.

Corrections create new artifact revisions. They do not overwrite history.

### 2. Transformation run

`aicis_evidence_transform_runs_v1`

Represents an extraction/normalization/derivation activity. It records producer identity, code/model/prompt fingerprints, input/output set hashes, and start/completion times.

For a self-hosted model transform, the exact model revision and Sovereign Artifact Lock digest are required. For an external model, provider/model/prompt/request-configuration identity must be explicit.

### 3. Claim

`aicis_evidence_claims_v1`

Represents an immutable proposition extracted or entered from evidence. A claim can be observed, derived, inferred, unverified, or contradicted. Numeric confidence is optional; if present, its semantics must be named.

Claims extracted or derived by a machine must identify the transform run that produced them.

### 4. Claim ↔ artifact relationship

`aicis_evidence_claim_artifacts_v1`

Links claims to exact artifacts with a controlled role:

- `source_of`
- `supports`
- `contradicts`
- `mentions`
- `context`

A source locator can identify a page, row, JSON pointer, timestamp, cell range, or other exact location. An excerpt may be represented by SHA-256 without storing copyrighted text in the evidence ledger.

### 5. Independent claim assessment

`aicis_evidence_claim_assessments_v1`

Verification is separate from extraction. Assessments are immutable and record:

- status;
- assessment method;
- assessor identity/type;
- evidence-set hash;
- assessment knowledge time;
- optional quantified confidence with explicit semantics.

A model-assisted assessment can support review, but Evidence Fabric v1 does not allow a model-assisted assessment by itself to establish verified truth.

### 6. Fact lineage

`aicis_evidence_fact_lineage_v1`

Links evidence artifacts/claims to downstream facts, including normalized events, normalized metrics, global signals, world entities/relationships, forecast resolutions, and admitted training rows.

This is the bridge between the evidence layer and the existing AICIS world-state/forecasting system.

## Knowledge-time truth floor

AICIS distinguishes:

- **valid time** — when something was true in the world;
- **published time** — when the source made it available;
- **knowledge time** — earliest governed time AICIS could legitimately know it;
- **retrieved / first-observed time** — when AICIS actually acquired or observed it;
- **assessment knowledge time** — evidence cutoff available to a verifier;
- **system time** — when AICIS stored the ledger row.

`verified_leakage_safe` requires explicit `knowledge_time` and `knowledge_time_verified_at`. Historical evaluation rejects artifacts or assessments whose knowledge time falls after the experiment cutoff.

## Unknown stays unknown

Evidence Fabric v1 has no default source reliability, quality, freshness, or confidence score.

A missing number remains `NULL`.

A numeric confidence can be stored only with explicit semantics. Provenance integrity and source identity are not converted into invented probabilities.

## Standards interoperability

Evidence Fabric is AICIS-specific but deliberately maps to established concepts.

### W3C PROV

- artifact / claim → PROV Entity
- transformation → PROV Activity
- producer / assessor → PROV Agent
- fact lineage → derivation / attribution / association

W3C PROV supplies a domain-neutral provenance model. AICIS adds its own knowledge-time and scientific forecasting admission rules.

### OpenLineage

Existing `provider_runs`, raw payloads, transforms, and normalized facts can be exported into OpenLineage-style run/dataset lineage. OpenLineage is useful for pipeline lineage but does not decide whether a geopolitical/economic claim is true.

### STIX 2.1

Cyber evidence may retain a STIX object ID and be translated to/from STIX objects. STIX is a cyber-domain interchange format, not the universal AICIS world-state schema.

### C2PA

When a media artifact contains Content Credentials, AICIS may record the manifest verification status and manifest hash. A valid C2PA manifest supports integrity/provenance assertions; it does **not** by itself establish factual truth. A C2PA-verified artifact still requires the normal AICIS claim/assessment process.

## Append-only policy

The candidate tables are append-only. Updates/deletes are rejected by trigger. Corrections are represented by:

- new artifact revisions;
- superseding claims;
- new assessments;
- additional lineage edges.

This preserves what AICIS knew and believed at each historical point.

## Security boundary

The candidate grants no direct access to `anon` or `authenticated`. Only `service_role` receives `SELECT`/`INSERT` in the candidate. A future deployment should expose narrowly scoped security-invoker views/RPCs rather than raw evidence tables.

## Non-claims

Evidence Fabric v1 does **not** claim:

- the candidate schema is deployed;
- existing historical AICIS rows have been re-admitted;
- source reliability has been calibrated;
- C2PA/STIX metadata proves truth;
- a model can verify its own extracted claims;
- any world-model training set is now automatically leakage-safe.

Deployment and historical backfill require separate source-controlled migrations, restore completeness proof, security review, and exact-SHA staging evidence.
