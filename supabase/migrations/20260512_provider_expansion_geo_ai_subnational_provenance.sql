-- AICIS Provider Expansion, AI Geo Enrichment, Subnational Metrics, and Provenance UI Layer
-- Adds provider registry, high-value provider backlog, AI geo enrichment result table,
-- subnational metric coverage foundations, and UI-ready provenance views.

create table if not exists public.data_provider_registry (
  id uuid primary key default gen_random_uuid(),
  provider_key text unique not null,
  display_name text not null,
  provider_tier text not null default 'candidate' check (provider_tier in ('tier_1','tier_2','tier_3','candidate')),
  domain text not null,
  ingestion_status text not null default 'planned' check (ingestion_status in ('planned','active','degraded','paused','retired')),
  cadence text,
  auth_type text default 'none' check (auth_type in ('none','api_key','oauth','token','manual')),
  base_url text,
  priority integer not null default 100,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.data_provider_registry(provider_key, display_name, provider_tier, domain, ingestion_status, cadence, auth_type, base_url, priority, notes) values
  ('ucdp','Uppsala Conflict Data Program','tier_1','conflict','planned','daily','token','https://ucdp.uu.se/api',1,'Structured conflict intelligence; API token required via UCDP_API_TOKEN'),
  ('acled','ACLED','tier_1','conflict','planned','daily','api_key','https://api.acleddata.com',2,'Near-real-time political violence and protest data; account required'),
  ('imf_sdmx','IMF SDMX','tier_1','macro','planned','daily','none','https://dataservices.imf.org/REST/SDMX_JSON.svc',3,'High-value macroeconomic and financial indicators'),
  ('oecd_sdmx','OECD SDMX','tier_1','macro','planned','weekly','none','https://sdmx.oecd.org/public/rest/v1',4,'OECD indicators for advanced economies and policy analysis'),
  ('un_comtrade','UN Comtrade','tier_1','trade','planned','daily','api_key','https://comtradeapi.un.org',5,'Trade flows, HS codes, commodity risk, bilateral dependencies'),
  ('emdat','EM-DAT','tier_1','disaster','planned','weekly','manual',null,6,'Disaster risk and historical disaster impact data'),
  ('copernicus','Copernicus / Sentinel','tier_1','satellite','planned','daily','oauth','https://dataspace.copernicus.eu',7,'Satellite-derived environmental and infrastructure monitoring'),
  ('owid_full','Our World in Data Full Catalog','tier_1','social_indicators','planned','daily','none','https://catalog.ourworldindata.org',8,'Deep social, health, energy and development indicators')
on conflict (provider_key) do update set
  display_name = excluded.display_name,
  provider_tier = excluded.provider_tier,
  domain = excluded.domain,
  cadence = excluded.cadence,
  auth_type = excluded.auth_type,
  base_url = excluded.base_url,
  priority = excluded.priority,
  notes = excluded.notes,
  updated_at = now();

create table if not exists public.provider_ingestion_backlog (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null references public.data_provider_registry(provider_key) on delete cascade,
  adapter_name text not null,
  target_table text not null,
  target_domain text not null,
  status text not null default 'queued' check (status in ('queued','in_progress','blocked','completed','paused')),
  blocker text,
  expected_value text,
  priority integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key, adapter_name)
);

insert into public.provider_ingestion_backlog(provider_key, adapter_name, target_table, target_domain, status, expected_value, priority, metadata) values
  ('ucdp','pull-ucdp-ged','normalized_events','conflict','queued','Geocoded conflict events with actors and fatalities',1,jsonb_build_object('secret','UCDP_API_TOKEN')),
  ('acled','pull-acled-events','normalized_events','conflict','queued','Near-real-time political violence and protest events',2,jsonb_build_object('secrets', jsonb_build_array('ACLED_EMAIL','ACLED_API_KEY'))),
  ('imf_sdmx','pull-imf-sdmx','normalized_metrics','macro','queued','IMF macro indicators by country and time',3,jsonb_build_object('datasets', jsonb_build_array('IFS','WEO','BOP','DOT'))),
  ('oecd_sdmx','pull-oecd-sdmx','normalized_metrics','macro','queued','OECD policy and macro indicators',4,jsonb_build_object('datasets', jsonb_build_array('SDMX common API'))),
  ('un_comtrade','pull-un-comtrade','normalized_metrics','trade','queued','Trade dependency and commodity flow indicators',5,jsonb_build_object('secret','UN_COMTRADE_API_KEY')),
  ('emdat','pull-emdat-disasters','normalized_events','disaster','queued','Structured disaster impact events',6,jsonb_build_object('mode','manual_or_api_when_available')),
  ('copernicus','pull-copernicus-observations','satellite_observations','satellite','queued','Remote sensing features for admin1/admin2 areas',7,jsonb_build_object('secrets', jsonb_build_array('COPERNICUS_CLIENT_ID','COPERNICUS_CLIENT_SECRET'))),
  ('owid_full','pull-owid-full-catalog','normalized_metrics','social_indicators','queued','Full OWID indicator catalog expansion',8,jsonb_build_object('mode','catalog_fetch'))
on conflict (provider_key, adapter_name) do update set
  target_table = excluded.target_table,
  target_domain = excluded.target_domain,
  expected_value = excluded.expected_value,
  priority = excluded.priority,
  metadata = excluded.metadata,
  updated_at = now();

create table if not exists public.ai_geo_enrichment_results (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid references public.event_geo_enrichment_queue(id) on delete cascade,
  event_id uuid references public.normalized_events(id) on delete cascade,
  model_name text,
  prompt_version text not null default 'aicis-geo-enrichment-v1',
  inferred_iso3 text,
  inferred_country text,
  confidence numeric(5,2) check (confidence between 0 and 100),
  evidence_text text,
  explanation text,
  raw_response jsonb not null default '{}'::jsonb,
  status text not null default 'pending_review' check (status in ('pending_review','accepted','rejected','auto_applied','failed')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

create index if not exists idx_ai_geo_enrichment_results_status_created on public.ai_geo_enrichment_results(status, created_at desc);
create index if not exists idx_ai_geo_enrichment_results_event on public.ai_geo_enrichment_results(event_id, created_at desc);

create table if not exists public.subnational_metric_coverage_targets (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  admin_level integer not null check (admin_level between 0 and 5),
  metric_family text not null,
  expected_countries integer,
  expected_regions integer,
  status text not null default 'planned' check (status in ('planned','active','degraded','paused','completed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key, admin_level, metric_family)
);

insert into public.subnational_metric_coverage_targets(provider_key, admin_level, metric_family, expected_countries, expected_regions, status, notes) values
  ('nasa_power', 1, 'climate_energy', 200, null, 'planned', 'Admin1 weather, solar, temperature and precipitation metrics'),
  ('copernicus', 1, 'environment_satellite', 200, null, 'planned', 'Satellite-derived vegetation, flood, fire and land indicators'),
  ('dhs', 1, 'health_demographics', 90, null, 'planned', 'Subnational health and demographic survey indicators where licensed/available'),
  ('gadm', 1, 'admin_boundaries', 240, null, 'active', 'Administrative boundary backbone for subnational aggregation'),
  ('worldpop', 1, 'population_density', 240, null, 'planned', 'Population density and demographic raster aggregation')
on conflict (provider_key, admin_level, metric_family) do update set
  expected_countries = excluded.expected_countries,
  expected_regions = excluded.expected_regions,
  status = excluded.status,
  notes = excluded.notes,
  updated_at = now();

create or replace view public.v_provider_expansion_readiness as
select
  r.provider_key,
  r.display_name,
  r.provider_tier,
  r.domain,
  r.ingestion_status,
  b.adapter_name,
  b.status as backlog_status,
  b.target_table,
  b.expected_value,
  b.priority,
  b.blocker,
  b.metadata
from public.data_provider_registry r
left join public.provider_ingestion_backlog b on b.provider_key = r.provider_key
order by coalesce(b.priority, r.priority), r.provider_key;

create or replace view public.v_subnational_metric_coverage_readiness as
select
  t.provider_key,
  t.admin_level,
  t.metric_family,
  t.expected_countries,
  t.expected_regions,
  t.status,
  t.notes,
  coalesce(count(distinct ce.iso3) filter (where cm.iso3 is not null), 0)::bigint as observed_countries,
  coalesce(count(cm.*), 0)::bigint as observed_rows,
  max(cm.created_at) as latest_metric_at
from public.subnational_metric_coverage_targets t
left join public.community_metrics cm
  on lower(cm.provider) = lower(t.provider_key)
left join public.canonical_entities ce
  on ce.iso3 = cm.iso3 and ce.entity_type = 'country'
group by t.provider_key, t.admin_level, t.metric_family, t.expected_countries, t.expected_regions, t.status, t.notes
order by t.status, t.provider_key, t.admin_level;

create or replace view public.v_signal_card_provenance as
select
  p.signal_id,
  p.title,
  p.category,
  p.status,
  p.primary_source,
  p.ingestion_source,
  p.source_reference_count,
  p.has_evidence_hash,
  p.confidence_tier,
  p.final_confidence,
  p.source_confidence,
  p.geo_confidence,
  p.entity_confidence,
  p.freshness_score,
  p.evidence_score,
  p.contradiction_penalty,
  p.has_open_contradiction,
  case
    when p.final_confidence >= 85 and not p.has_open_contradiction then 'trusted'
    when p.final_confidence >= 65 then 'reviewable'
    when p.final_confidence >= 45 then 'weak'
    else 'insufficient'
  end as display_trust_state,
  case
    when p.has_open_contradiction then 'Open contradiction exists; review before acting.'
    when not p.has_evidence_hash then 'Missing evidence hash; treat as lower confidence.'
    when p.source_reference_count = 0 then 'No source references attached.'
    else 'Evidence and confidence metadata available.'
  end as provenance_warning,
  p.provenance_summary
from public.v_signal_provenance_explainability p;

create or replace function public.accept_ai_geo_enrichment(p_result_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_iso3 text;
  v_queue_id uuid;
begin
  select event_id, inferred_iso3, queue_id
  into v_event_id, v_iso3, v_queue_id
  from public.ai_geo_enrichment_results
  where id = p_result_id and status in ('pending_review','failed')
  limit 1;

  if v_event_id is null or v_iso3 is null then
    return false;
  end if;

  update public.normalized_events
  set iso3 = v_iso3
  where id = v_event_id and iso3 is null;

  insert into public.entity_event_links(entity_id, event_id, created_at)
  select ce.id, v_event_id, now()
  from public.canonical_entities ce
  where ce.iso3 = v_iso3 and ce.entity_type = 'country'
  on conflict do nothing;

  update public.event_geo_enrichment_queue
  set inferred_iso3 = v_iso3,
      method = 'ai_geo_enrichment',
      status = 'resolved',
      updated_at = now()
  where id = v_queue_id;

  update public.ai_geo_enrichment_results
  set status = 'accepted', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_result_id;

  insert into public.audit_events(action, resource_type, resource_id, new_value, reason, metadata)
  values (
    'ai_geo_enrichment_accepted',
    'normalized_event',
    v_event_id::text,
    jsonb_build_object('iso3', v_iso3, 'result_id', p_result_id),
    'Accepted AI-assisted event geo enrichment',
    jsonb_build_object('queue_id', v_queue_id)
  );

  return true;
end;
$$;

create or replace function public.mark_provider_backlog_status(p_provider_key text, p_adapter_name text, p_status text, p_blocker text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_ingestion_backlog
  set status = p_status,
      blocker = p_blocker,
      updated_at = now()
  where provider_key = p_provider_key and adapter_name = p_adapter_name;

  return found;
end;
$$;
