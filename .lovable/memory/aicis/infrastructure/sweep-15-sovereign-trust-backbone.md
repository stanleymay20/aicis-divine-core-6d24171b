---
name: Sweep 15 Phase A — Sovereign Trust Backbone
description: Ledger universality, citation layer with provenance hashing, knowledge graph foundation, federation Ed25519 with key rotation, residency manifest, simulation templates
type: feature
---

## What shipped (Phase A)

**Ledger universality** — `ledger_append(entry_type, payload)` SQL helper + 5 AFTER INSERT triggers on `aicis_early_warnings`, `risk_action_recommendations`, `risk_ranking_predictions`, `risk_ml_predictions`, `simulation_runs`. Failures warn but never block source inserts.

**Citation layer (soft enforcement only in Phase A)**
- `source_authority_registry` — 18 publishers seeded (IMF, World Bank, IAEA, OFAC, EU/UK/UN sanctions, ECB/Fed/BoE/BoJ/PBoC, Eurostat, ONS, BIS, OECD, WHO, UN). Tier 1–4.
- `intelligence_citations` — polymorphic `(subject_type, subject_id)`, with provenance hashing: `source_hash`, `citation_snapshot_hash`, `retrieved_at` for immutable evidence even if upstream page changes.
- `citation_enforcement_policy` — Phase A: warnings=`warning_only`, recommendations/forecasts=`soft_fail`, ml=`disabled`. Promote to `hard_fail` only after Phase B citation backfill.
- `assert_citation(subject_type, subject_id)` returns `(ok, mode, severity, message)` — never raises.
- View `intelligence_citation_strength` exposes count, best tier, avg confidence, has_provenance_hash.

**Knowledge graph foundation**
- `entity_identifiers (scheme, identifier UNIQUE)` for LEI, OpenCorporates, IMO, ICAO, UN/M49, ofac_uid, eu_sdn, uk_ofsi, iso3.
- `entity_link_provenance` attaches source/evidence_url/confidence to each entity link.
- `entity_aliases` extended with alias_source, alias_language, alias_authority.

**Legacy deprecation** — `deprecated_tables` registry; `metrics` marked deprecated → `normalized_metrics` (180-day removal target). Table COMMENT updated.

**Federation hardening (real Ed25519 + key rotation)**
- `federation_signing_keys` with key_id, public_key, key_status (active/rotating/revoked/compromised), is_active (UNIQUE partial index), rotation_policy_days, expires_at.
- `federation_active_key` view (security_invoker).
- `rotate_federation_key(new_key_id, new_public_key, days)` — atomic rotation, logs to ledger. EXECUTE revoked from PUBLIC/anon/authenticated.
- `federation_signed_bundles` records bundle_hash + key_id + signature + algorithm for verification trail.
- Edge fns: `federation-init-key` (one-time keypair generation), `federation-sign-bundle` (uses `FEDERATION_ED25519_PRIVATE_KEY` secret), `federation-verify-bundle` (validates against registered public key, embeds key_id in signed payload).
- **Operator setup:** call `federation-init-key` once → save returned `private_key_pkcs8_base64` to secret `FEDERATION_ED25519_PRIVATE_KEY`. Rotation: call init again every 180d.

**Data residency manifest** — `data_residency_manifest` table seeded with 25 core resources, mapped to EU/UK/CA/JP/US/GLOBAL and sovereign_mode_visibility (public/global/regional/national/isolated). Public page at `/residency` renders the live manifest for procurement review.

**Simulation templates (separate from runs)** — `simulation_templates` reusable scenarios. `simulation_runs.template_id` FK. Seeded 12 named scenarios: Hormuz Closure, Black Sea Grain, Taiwan Semi Shock, Arctic Shipping, EM Sovereign Debt, Election Instability, Climate Migration, Pandemic Resurgence, Suez Disruption, LNG Supply Shock, Rare-Earth Embargo, Cyber-Financial Cascade.

## Edits applied during scoping
1. Citation enforcement = soft only in Phase A (warning_only/soft_fail) so existing 3.7K warnings + 16K recommendations aren't blocked.
2. Citation provenance hashing (source_hash, citation_snapshot_hash, retrieved_at).
3. Federation keys include key_status + rotation_policy_days + active_key view; signed bundles embed key_id.
4. simulation_templates separated from simulation_runs (templates are reusable assets; runs are execution history).

## What's deferred to Phase B (next loop)
- Real bulk ingestion (GLEIF/OpenCorporates/OFAC/EU/UK/IMO/ICAO) — target ≥500K entities, ≥2M aliases, ≥200K links.
- Citation backfill across existing warnings/recommendations using GDELT URLs already in `global_signals`.
- Expand simulation portfolio to 100+ named scenarios.
- Promote citation enforcement to `hard_fail` once coverage threshold met.

## What's deferred to Phase C
- Public `/security`, `/sla`, `/dpa` static pages.
- SOC2 roadmap, sub-processor list, uptime dashboard at `/status`.
- Sovereign-mode boundary enforcement audit + signed evidence pack.
