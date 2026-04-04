## Phase 16.1 — Signal Quality & Trust Hardening

### Objective
Harden the Global Signal Engine from "first working version" to "trustworthy intelligence layer" by improving source diversity, dedup quality, source trust scoring, and routing precision validation.

### Step 1: Source Trust Scoring System
**Database**: Add `source_trust_scores` table with fields: source_name, source_type (wire_agency, state_media, financial, tech, tabloid, official_body), credibility_weight (0-100), verification_level (primary, secondary, aggregated), notes.

**Edge function update**: When ingesting, look up source trust weight and factor it into final impact_score calculation. Pre-seed ~30 known sources with trust weights (AP, Reuters, BBC = 95; CNN, CNBC = 85; Gizmodo, Eonline = 40).

### Step 2: Enhanced Deduplication — Semantic Similarity
Upgrade dedup from exact-title-match to semantic similarity:
- Normalize titles more aggressively (remove source suffixes like "- CNN", "- BBC News")
- Compare word overlap ratio between new and existing signals (Jaccard similarity > 0.6 = duplicate)
- Add `related_signal_ids` field to global_signals for event clustering
- When a near-duplicate is found, increment `source_count` on the existing signal and add the new source to `source_references`

### Step 3: Multi-Source Confirmation Score  
Add `multi_source_confirmed` boolean and upgrade source_count tracking:
- If source_count >= 3 from different credible sources → mark as confirmed
- Display confirmation badge on SignalCard ("3+ sources confirmed")
- Factor multi-source status into impact_score boost (+5 for 2 sources, +10 for 3+)

### Step 4: Source Diversity — Add RSS Feed Support
Add a second ingestion pathway for official/institutional sources:
- GDELT API (already in providers.registry.yml) for geopolitical events
- This runs alongside NewsAPI, not replacing it
- Update edge function to support multiple source connectors

### Step 5: Routing Quality Audit Panel
Add a "Signal Audit" section to the /live page:
- Show last 20 routed signals with their scores
- Display category accuracy indicator (was the AI classification sensible?)
- Add manual "Confirm" / "Reject" buttons for operators to validate routing quality
- Store routing feedback in a new `signal_routing_feedback` table

### Step 6: Signal Freshness & Staleness
- Add visual freshness indicator on each signal card (green < 2h, yellow < 12h, orange < 24h, red > 24h)
- Show "last ingestion" timestamp in the header
- Add staleness warning if no new signals in 4+ hours

### Step 7: UI Polish
- Add source credibility badge (Tier 1 / Tier 2 / Tier 3) on SignalCard
- Add multi-source confirmation indicator
- Improve mobile tap targets (ensure all interactive elements ≥ 40px)

### Files to create/edit:
- Migration: `source_trust_scores` table, `signal_routing_feedback` table, add `source_trust_tier` and `multi_source_confirmed` to global_signals
- `supabase/functions/ingest-global-signals/index.ts` — trust scoring, enhanced dedup, GDELT support
- `src/components/live/SignalCard.tsx` — freshness indicator, trust tier badge, confirmation badge
- `src/components/live/SignalDetailPanel.tsx` — routing audit actions
- `src/pages/LiveCommandFeed.tsx` — last ingestion timestamp, staleness warning
- `src/hooks/useGlobalSignals.ts` — add freshness helpers
