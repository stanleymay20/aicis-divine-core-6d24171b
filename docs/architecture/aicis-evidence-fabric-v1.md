# AICIS Intelligence Source & Evidence Fabric v1

Status: **controlled candidate; not deployed**

## Purpose

AICIS needs more than source URLs attached to intelligence outputs. It needs a reproducible chain showing what source artifact existed, when it became knowable, how it was transformed, which claims were extracted, how those claims were assessed, and which downstream facts or forecasts depended on them.

Evidence Fabric v1 defines that chain without turning provenance metadata into an automatic truth score.

```text
Source / Provider
      ↓
Immutable Artifact + Origin Group
      ↓
Transformation Activity
      ↓
Canonical Claim
      ↓
Claim ↔ Artifact Binding
      ↓
Independent Assessment + Materialized Evidence Manifest
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
- governed `source_independence_key` when an origin group can be established;
- source and canonical URI when available;
- license/media type;
- SHA-256 artifact identity;
- optional link to `provider_raw_payloads`;
- publication, retrieval, first-observation, valid-time, and knowledge-time fields;
- knowledge-time verification status;
- revision/supersession links;
- explicit synthetic flag;
- optional C2PA and STIX interoperability metadata.

Corrections create new artifact revisions. They do not overwrite history.

A `source_independence_key` identifies the underlying origin group for corroboration. It is deliberately distinct from URL, publisher name, feed record ID, and provider record ID. Two outlets carrying the same wire-service story, copied press release, shared sensor upstream, or republished dataset may have different `source_id` values while sharing one independence key. Missing independence information may remain as metadata, but such an artifact cannot qualify as verified external evidence in the v1 admission contract.

### 2. Transformation run

`aicis_evidence_transform_runs_v1`

Represents an extraction/normalization/derivation activity. It records producer identity, code/model/prompt fingerprints, input/output set hashes, and start/completion times.

For deterministic or rule-based transforms, a code SHA-256 is required. For a self-hosted model transform, the exact model revision, Sovereign Artifact Lock digest, and prompt hash are required. For an external model, provider/model/prompt/request-configuration identity must be explicit.

An extracted or derived claim cannot qualify through a syntactically valid transform UUID alone: the Evidence Fabric admission contract evaluates the referenced transform and requires its identity to match the claim. Synthetic transform output cannot create verified external truth.

### 3. Canonical claim

`aicis_evidence_claims_v1`

Represents an immutable proposition extracted or entered from evidence. A claim can be observed, derived, inferred, unverified, or contradicted. Numeric confidence is optional; if present, its semantics must be named and usable.

`claim_sha256` is not treated as an arbitrary caller-supplied fingerprint. The admission contract recomputes it from canonical claim content, including statement, subject/predicate/object content, object value, and claim-validity timestamps. Reordering JSON object keys or equivalent timestamp formatting does not change the claim identity; changing the proposition does.

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

A verified evidence bundle must bind the exact claim ID to the exact artifact ID. Only `source_of` or `supports` can support verification; `contradicts`, `mentions`, and `context` cannot be silently treated as supporting evidence.

### 5. Independent claim assessment

`aicis_evidence_claim_assessments_v1`

Verification is separate from extraction. Assessments are immutable and record:

- status;
- assessment method;
- assessor identity/type;
- canonical evidence manifest;
- evidence-set SHA-256;
- artifact count and independently identified **origin-group** count;
- assessment knowledge time;
- optional quantified confidence with explicit semantics.

The evidence manifest contains exact `{artifact_id, artifact_sha256, source_id, source_independence_key}` entries. Its canonical SHA-256 is recomputed by the admission contract. Changing the artifact identity, record identity, or source-origin grouping changes the evidence-set identity. Declared artifact/source counts must equal manifest-derived counts, so a caller cannot establish “two independent sources” by setting a numeric counter alone.

A manifest entry is not evidence merely because it is syntactically valid. For a verified evidence bundle, **every manifest entry must resolve to a supplied artifact with the same ID, artifact SHA-256, source ID, and origin-group key, and that artifact must independently pass the verified-external-evidence admission rules**. A phantom manifest row therefore cannot manufacture corroboration.

The assessment's knowledge time must be at or after the knowledge time of every artifact it relies on. Historical cutoffs apply to every artifact in the manifest, not only the primary linked artifact. This prevents a retrospective assessment from silently using a supporting source that became knowable after the forecast cutoff.

`independent_source_corroboration` requires at least two distinct `source_independence_key` values in the bound evidence manifest. Merely having two URLs, publishers, API records, or news articles is insufficient. If two records derive from one common origin, they count as one source for corroboration.

The independence key is a governed grouping attribute, not a probability or a truth score. Future source-registry work should record how each grouping was established and support audit/revision when syndication or common upstream lineage is discovered.

Model-assisted and rule-based assessments can support review, but Evidence Fabric v1 does not allow either to independently establish verified truth. A model cannot verify its own extraction merely by assigning a confidence score.

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

`verified_leakage_safe` requires explicit `knowledge_time` and `knowledge_time_verified_at`. Historical evaluation rejects artifacts or assessments whose knowledge time falls after the experiment cutoff. Optional timestamps, when supplied, must parse as real timestamps; malformed temporal metadata does not silently become `NULL` in the admission contract.

## Unknown stays unknown

Evidence Fabric v1 has no default source reliability, quality, freshness, or confidence score.

A missing number remains `NULL`.

A numeric confidence can be stored only with explicit usable semantics. Labels containing legacy, unknown, unspecified, unverified, or not-quantified semantics are not admitted as quantified confidence. Provenance integrity, source identity, and source independence grouping are never converted into invented probabilities.

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

When a media artifact contains Content Credentials, AICIS may record the manifest verification status and manifest hash. A valid C2PA manifest supports integrity/provenance assertions; it does **not** by itself establish factual truth. An invalid C2PA manifest prevents that artifact from qualifying as verified external evidence; a valid manifest still requires the normal AICIS claim/assessment process.

## Append-only policy

The candidate tables are append-only. Updates/deletes are rejected by trigger. Corrections are represented by:

- new artifact revisions;
- superseding claims;
- new assessments;
- additional lineage edges.

This preserves what AICIS knew and believed at each historical point.

## Security boundary

The candidate grants no direct access to `anon` or `authenticated`. Only `service_role` receives `SELECT`/`INSERT` in the candidate. The legacy compatibility view is `security_invoker`. A future deployment should expose narrowly scoped security-invoker views/RPCs rather than raw evidence tables.

## Non-claims

Evidence Fabric v1 does **not** claim:

- the candidate schema is deployed;
- existing historical AICIS rows have been re-admitted;
- source reliability has been calibrated;
- every `source_independence_key` is already historically audited;
- distinct publishers automatically imply independent evidence;
- C2PA/STIX metadata proves truth;
- a model or deterministic rule can independently verify its own extracted claims;
- any world-model training set is now automatically leakage-safe;
- evidence-manifest admission replaces future database-level or staging integrity testing.

Deployment and historical backfill require separate source-controlled migrations, restore completeness proof, source-independence audit, security review, and exact-SHA staging evidence.
