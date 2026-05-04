INSERT INTO global_signals (
  title, summary, category, status, confidence_score, impact_score, urgency_score,
  source_count, primary_source, source_references,
  first_detected_at, latest_update_at, occurred_at,
  affected_regions, affected_countries, affected_sectors, affected_stakeholders,
  ingestion_source, dedup_key, source_trust_tier, multi_source_confirmed,
  enrichment_status, ingested_at, official_source, official_source_present,
  canonical_source_name, source_rank_score, merged_source_count
)
SELECT
  'Togo-flagged oil tanker hijacked by Somali pirates off Yemen',
  'Armed Somali pirates hijacked a Togo-flagged oil tanker off the Yemeni coast on Saturday, May 2, 2026 — the most significant Somali piracy incident in the Gulf of Aden corridor in recent years. Implications: rising war-risk insurance premiums, potential rerouting around Cape of Good Hope, escalating fuel/freight costs across Asia-Europe trade lanes.',
  'maritime_security'::signal_category,'confirmed',85,80,90,
  1,'Manual analyst entry',
  '[{"url":"https://www.google.com/search?q=Togo+tanker+hijacked+Somali+pirates+Yemen+May+2+2026","name":"Manual analyst entry","published":"2026-05-02T12:00:00Z"}]'::jsonb,
  '2026-05-02 12:00:00+00','2026-05-04 04:00:00+00','2026-05-02 12:00:00+00',
  ARRAY['horn_of_africa','middle_east','indian_ocean'],
  ARRAY['YEM','SOM','TGO'],
  ARRAY['shipping','energy','insurance','supply_chain'],
  ARRAY['shipowners','insurers','energy_importers','navies'],
  'manual_enrichment','tanker_hijack_yemen_2026_05_02::manual','tier_1',false,
  'enriched',now(),true,true,'Manual analyst entry',95,1
WHERE NOT EXISTS (SELECT 1 FROM global_signals WHERE dedup_key='tanker_hijack_yemen_2026_05_02::manual');