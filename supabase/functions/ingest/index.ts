import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import {
  structuredLog,
  handleCors,
  errorResponse,
  jsonResponse,
  resilientCall,
} from "../_shared/resilience.ts";

const FN = "ingest";
const ADAPTER_VERSION = "v3-evidence-preserving";

type JsonRecord = Record<string, unknown>;
type ResolutionMethod = "reviewed_mapping" | "verified_external_id";

type IdentityIdentifier = {
  provider: string;
  externalId: string;
};

type ResolutionResult = {
  id: string | null;
  method: ResolutionMethod | null;
  candidateCount: number;
  candidateRecordIds: string[];
  semantics: string;
};

type EntityLinkCandidate = {
  entityId: string;
  role: string;
  resolutionMethod: ResolutionMethod;
};

type LinkQueueItem = {
  factType: "metric" | "event";
  dedupKey: string;
  links: EntityLinkCandidate[];
};

type NormalizedItem = {
  domain: string;
  metric?: string;
  metric_name?: string;
  iso3?: string;
  period?: string;
  value?: number;
  unit?: string | null;
  confidence?: number | null;
  confidence_semantics?: string | null;
  freshness_score?: number | null;
  freshness_semantics?: string | null;
  source?: string | null;
  provenance_observed_at?: string | null;
  provenance_observed_at_semantics?: string | null;
  raw?: JsonRecord;
  event_type?: string;
  title?: string;
  description?: string | null;
  entity_name?: string;
  entity_type?: string;
  location_name?: string;
  started_at?: string | null;
  started_at_semantics?: string | null;
  ended_at?: string | null;
  severity?: number | null;
  metadata?: JsonRecord;
  partner_iso3?: string;
  partner_name?: string;
  institution_name?: string;
  commodity_name?: string;
  identity_external_ids?: IdentityIdentifier[];
};

const PROVIDER_URLS: Record<string, (params: JsonRecord) => string> = {
  worldbank: (params) => {
    const countries = stringValue(params.countries) ?? "USA;CHN;GBR;DEU;JPN;FRA;IND;BRA";
    const indicator = stringValue(params.indicator) ?? "NY.GDP.MKTP.KD.ZG";
    const dateRange = stringValue(params.date_range) ?? "2018:2023";
    const perPage = positiveInteger(params.per_page, 10_000) ?? 1_000;
    return `https://api.worldbank.org/v2/country/${countries}/indicator/${indicator}?format=json&date=${dateRange}&per_page=${perPage}`;
  },
  imf: (params) => {
    const dataset = stringValue(params.dataset) ?? "IFS";
    const frequency = stringValue(params.frequency) ?? "A";
    const indicator = stringValue(params.indicator) ?? "PCPI_IX";
    const area = stringValue(params.area) ?? "US";
    return `https://dataservicesstg.imf.org/REST/SDMX_JSON.svc/CompactData/${dataset}/${frequency}.${area}.${indicator}`;
  },
  openalex: (params) => {
    const entity = stringValue(params.entity) ?? "works";
    const filter = stringValue(params.filter) ?? "publication_year:2024";
    const perPage = positiveInteger(params.per_page, 200) ?? 50;
    return `https://api.openalex.org/${entity}?filter=${encodeURIComponent(filter)}&per_page=${perPage}`;
  },
};

const PROVIDER_HOSTS: Record<string, Set<string>> = {
  worldbank: new Set(["api.worldbank.org"]),
  imf: new Set(["dataservicesstg.imf.org"]),
  openalex: new Set(["api.openalex.org"]),
};

const ALLOWED_PROVIDERS = new Set(Object.keys(PROVIDER_URLS));
const ALLOWED_ACTIONS = new Set([
  "run",
  "replay",
  "metrics_by_entity",
  "timeseries",
  "events_by_entity",
  "run_health",
  "latest_by_country",
]);

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse(new Error("Unauthorized"), 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return errorResponse(new Error("Unauthorized"), 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: roles, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  if (roleError) return errorResponse(roleError);
  const allowed = (roles ?? []).some((row) => row.role === "admin" || row.role === "operator");
  if (!allowed) return errorResponse(new Error("Forbidden"), 403);

  try {
    const parsed = await req.json();
    if (!isRecord(parsed)) return errorResponse(new Error("Request body must be an object"), 400);
    const action = stringValue(parsed.action);
    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return errorResponse(new Error(`Unknown action: ${String(action)}`), 400);
    }
    const { action: _action, ...params } = parsed;
    void _action;

    const providerName = stringValue(params.provider_name);
    if (providerName && !ALLOWED_PROVIDERS.has(providerName)) {
      return errorResponse(new Error(`Provider not allowed: ${providerName}`), 400);
    }

    switch (action) {
      case "run": return await runIngestion(supabase, params);
      case "replay": return await replayIngestion(supabase, params);
      case "metrics_by_entity": return await metricsByEntity(supabase, params);
      case "timeseries": return await timeseries(supabase, params);
      case "events_by_entity": return await eventsByEntity(supabase, params);
      case "run_health": return await runHealth(supabase, params);
      case "latest_by_country": return await latestByCountry(supabase, params);
      default: return errorResponse(new Error(`Unknown action: ${action}`), 400);
    }
  } catch (error) {
    structuredLog("error", FN, error instanceof Error ? error.message : String(error));
    return errorResponse(error);
  }
});

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function metricDedupKey(
  provider: string,
  metric: string,
  iso3: string | undefined,
  period: string,
  entityId?: string,
): string {
  return `m:${provider}:${metric}:${iso3 ?? ""}:${period}:${entityId ?? ""}`;
}

function eventDedupKey(
  provider: string,
  eventType: string,
  title: string,
  startedAt?: string | null,
): string {
  return `e:${provider}:${eventType}:${title.slice(0, 80)}:${startedAt ?? ""}`;
}

/**
 * Ingestion may attach identity only when a reviewed mapping or explicitly
 * verified external identifier already exists. Name/alias/ISO/fuzzy matches are
 * persisted as review candidates and never auto-linked.
 */
async function resolveEntityForIngestion(
  supabase: SupabaseClient,
  input: {
    name?: string;
    entityType: string;
    iso3?: string;
    externalIds?: IdentityIdentifier[];
  },
): Promise<ResolutionResult> {
  const name = input.name?.trim() ?? "";
  const iso3 = input.iso3?.trim().toUpperCase() ?? "";
  const requestedName = name || iso3;
  if (!requestedName) {
    return {
      id: null,
      method: null,
      candidateCount: 0,
      candidateRecordIds: [],
      semantics: "unresolved_no_identity_evidence",
    };
  }

  try {
    let acceptedQuery = supabase
      .from("entity_resolution_candidates")
      .select("candidate_entity_id")
      .eq("requested_entity_type", input.entityType)
      .eq("status", "accepted")
      .ilike("requested_name", requestedName)
      .order("reviewed_at", { ascending: false })
      .limit(1);
    acceptedQuery = iso3
      ? acceptedQuery.eq("requested_iso3", iso3)
      : acceptedQuery.is("requested_iso3", null);
    const { data: acceptedRows } = await acceptedQuery;
    const acceptedId = stringValue(acceptedRows?.[0]?.candidate_entity_id);
    if (acceptedId) {
      return {
        id: acceptedId,
        method: "reviewed_mapping",
        candidateCount: 0,
        candidateRecordIds: [],
        semantics: "human_reviewed_identity_mapping_not_probability",
      };
    }

    for (const identifier of input.externalIds ?? []) {
      if (!identifier.provider || !identifier.externalId) continue;
      const { data: match } = await supabase
        .from("entity_external_ids")
        .select("entity_id")
        .eq("provider", identifier.provider)
        .eq("external_id", identifier.externalId)
        .eq("verification_status", "verified")
        .limit(1)
        .maybeSingle();
      const entityId = stringValue(match?.entity_id);
      if (entityId) {
        return {
          id: entityId,
          method: "verified_external_id",
          candidateCount: 0,
          candidateRecordIds: [],
          semantics: "verified_external_identifier_identity_decision_not_probability",
        };
      }
    }

    const candidates = new Map<string, {
      matchType: "exact_name" | "alias" | "fuzzy" | "iso3";
      score: number | null;
      scoreSemantics: string;
      evidence: JsonRecord;
    }>();

    if (name) {
      const { data: exactRows } = await supabase
        .from("canonical_entities")
        .select("id")
        .eq("entity_type", input.entityType)
        .eq("normalized_name", name.toLowerCase())
        .limit(10);
      for (const row of exactRows ?? []) {
        const id = stringValue(row.id);
        if (id) candidates.set(id, {
          matchType: "exact_name",
          score: null,
          scoreSemantics: "exact_normalized_name_match_not_identity_probability",
          evidence: { normalized_name: name.toLowerCase() },
        });
      }

      const { data: aliasRows } = await supabase
        .from("entity_aliases")
        .select("entity_id,alias,verification_status")
        .ilike("alias", name)
        .limit(10);
      for (const row of aliasRows ?? []) {
        const id = stringValue(row.entity_id);
        if (id && !candidates.has(id)) candidates.set(id, {
          matchType: "alias",
          score: null,
          scoreSemantics: "exact_alias_text_match_not_identity_probability",
          evidence: {
            alias: row.alias,
            alias_verification_status: row.verification_status ?? null,
          },
        });
      }
    }

    if (iso3 && input.entityType === "country") {
      const { data: isoRows } = await supabase
        .from("canonical_entities")
        .select("id")
        .eq("entity_type", "country")
        .eq("iso3", iso3)
        .limit(10);
      for (const row of isoRows ?? []) {
        const id = stringValue(row.id);
        if (id && !candidates.has(id)) candidates.set(id, {
          matchType: "iso3",
          score: null,
          scoreSemantics: "stored_iso3_equality_not_authoritative_verification",
          evidence: { iso3 },
        });
      }
    }

    if (name.length > 2) {
      const { data: fuzzyRows } = await supabase.rpc("similarity_search_entities", {
        search_name: name,
        search_type: input.entityType,
        min_similarity: 0.3,
        max_results: 5,
      });
      for (const row of fuzzyRows ?? []) {
        const id = stringValue(row.id);
        if (!id || candidates.has(id)) continue;
        candidates.set(id, {
          matchType: "fuzzy",
          score: unitOrNull(row.similarity),
          scoreSemantics: "trigram_string_similarity_not_identity_probability",
          evidence: { match_source: row.match_source ?? null },
        });
      }
    }

    const candidateRecordIds = await persistResolutionCandidates(
      supabase,
      requestedName,
      input.entityType,
      iso3 || null,
      candidates,
    );

    return {
      id: null,
      method: null,
      candidateCount: candidates.size,
      candidateRecordIds,
      semantics: candidates.size > 0
        ? "candidate_review_required_identity_not_attached"
        : "unresolved_no_candidate",
    };
  } catch (error) {
    structuredLog("warn", FN, `identity resolution withheld: ${error instanceof Error ? error.message : String(error)}`);
    return {
      id: null,
      method: null,
      candidateCount: 0,
      candidateRecordIds: [],
      semantics: "identity_resolution_error_withheld",
    };
  }
}

async function persistResolutionCandidates(
  supabase: SupabaseClient,
  requestedName: string,
  entityType: string,
  iso3: string | null,
  candidates: Map<string, {
    matchType: "exact_name" | "alias" | "fuzzy" | "iso3";
    score: number | null;
    scoreSemantics: string;
    evidence: JsonRecord;
  }>,
): Promise<string[]> {
  if (candidates.size === 0) return [];

  let pendingQuery = supabase
    .from("entity_resolution_candidates")
    .select("id,candidate_entity_id,match_type")
    .eq("requested_entity_type", entityType)
    .eq("status", "pending_review")
    .ilike("requested_name", requestedName);
  pendingQuery = iso3
    ? pendingQuery.eq("requested_iso3", iso3)
    : pendingQuery.is("requested_iso3", null);
  const { data: pendingRows } = await pendingQuery;
  const existing = new Map(
    (pendingRows ?? []).map((row) => [
      `${String(row.candidate_entity_id)}:${String(row.match_type)}`,
      String(row.id),
    ]),
  );

  const ids: string[] = [];
  const rowsToInsert: JsonRecord[] = [];
  const keysToInsert: string[] = [];
  for (const [candidateEntityId, candidate] of candidates) {
    const key = `${candidateEntityId}:${candidate.matchType}`;
    const existingId = existing.get(key);
    if (existingId) {
      ids.push(existingId);
      continue;
    }
    rowsToInsert.push({
      requested_name: requestedName,
      requested_entity_type: entityType,
      requested_iso3: iso3,
      candidate_entity_id: candidateEntityId,
      match_type: candidate.matchType,
      match_score: candidate.score,
      match_score_semantics: candidate.scoreSemantics,
      evidence: candidate.evidence,
      status: "pending_review",
    });
    keysToInsert.push(key);
  }

  if (rowsToInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from("entity_resolution_candidates")
      .insert(rowsToInsert)
      .select("id,candidate_entity_id,match_type");
    if (error) {
      structuredLog("warn", FN, `candidate persistence failed: ${error.message}`);
    } else {
      const insertedByKey = new Map(
        (inserted ?? []).map((row) => [
          `${String(row.candidate_entity_id)}:${String(row.match_type)}`,
          String(row.id),
        ]),
      );
      for (const key of keysToInsert) {
        const id = insertedByKey.get(key);
        if (id) ids.push(id);
      }
    }
  }
  return ids;
}

function normalizeWorldBank(rawData: unknown, endpoint: string): NormalizedItem[] {
  if (!Array.isArray(rawData) || rawData.length < 2 || !Array.isArray(rawData[1])) return [];
  return rawData[1].flatMap((rawRow) => {
    const row = asRecord(rawRow);
    const value = finiteNumber(row?.value);
    if (!row || value === null) return [];
    const indicator = asRecord(row.indicator);
    const country = asRecord(row.country);
    const indicatorId = stringValue(indicator?.id) ?? endpoint;
    const iso3 = stringValue(row.countryiso3code) ?? undefined;
    return [{
      domain: inferDomain(endpoint),
      metric: indicatorId.toLowerCase().replace(/\./g, "_"),
      iso3,
      entity_name: stringValue(country?.value) ?? iso3,
      period: stringValue(row.date) ?? "",
      value,
      unit: stringValue(row.unit),
      confidence: null,
      confidence_semantics: "not_reported_by_worldbank_adapter",
      source: "worldbank",
      raw: {
        indicator: indicatorId,
        country: stringValue(country?.value),
      },
    } satisfies NormalizedItem];
  });
}

function normalizeIMF(rawData: unknown, endpoint: string): NormalizedItem[] {
  const compactData = asRecord(asRecord(rawData)?.CompactData);
  const dataSet = asRecord(compactData?.DataSet);
  const rawSeries = dataSet?.Series;
  const series = Array.isArray(rawSeries) ? rawSeries : rawSeries ? [rawSeries] : [];
  const items: NormalizedItem[] = [];

  for (const rawItem of series) {
    const item = asRecord(rawItem);
    if (!item) continue;
    const indicator = stringValue(item["@INDICATOR"]) ?? stringValue(item["@SUBJECT"]) ?? endpoint;
    const country = stringValue(item["@REF_AREA"]) ?? "";
    const rawObs = item.Obs;
    const observations = Array.isArray(rawObs) ? rawObs : rawObs ? [rawObs] : [];
    for (const rawObservation of observations) {
      const observation = asRecord(rawObservation);
      if (!observation) continue;
      const value = numericStringOrNumber(observation["@OBS_VALUE"]);
      if (value === null) continue;
      const unitMult = stringValue(item["@UNIT_MULT"]);
      items.push({
        domain: "finance",
        metric: indicator.toLowerCase().replace(/\s+/g, "_"),
        iso3: country || undefined,
        entity_name: country || undefined,
        period: stringValue(observation["@TIME_PERIOD"]) ?? "",
        value,
        unit: unitMult ? `10^${unitMult}` : null,
        confidence: null,
        confidence_semantics: "not_reported_by_imf_adapter",
        source: "imf",
      });
    }
  }
  return items;
}

function normalizeOpenAlex(rawData: unknown): NormalizedItem[] {
  const results = asRecord(rawData)?.results;
  if (!Array.isArray(results)) return [];
  const items: NormalizedItem[] = [];

  for (const rawResult of results) {
    const result = asRecord(rawResult);
    if (!result) continue;
    const citedByCount = finiteNumber(result.cited_by_count);
    if (citedByCount === null) continue;

    const authorships = Array.isArray(result.authorships) ? result.authorships : [];
    const firstAuthorship = asRecord(authorships[0]);
    const institutions = Array.isArray(firstAuthorship?.institutions) ? firstAuthorship.institutions : [];
    const institution = asRecord(institutions[0]);
    const countryCode = stringValue(institution?.country_code) ?? undefined;
    const institutionName = stringValue(institution?.display_name) ?? undefined;

    items.push({
      domain: "research",
      metric: "citation_count",
      iso3: countryCode,
      period: integerString(result.publication_year) ?? "",
      value: citedByCount,
      unit: "citations",
      confidence: null,
      confidence_semantics: "not_reported_by_openalex_adapter",
      source: "openalex",
      institution_name: institutionName,
      raw: {
        id: stringValue(result.id),
        title: (stringValue(result.display_name) ?? "").slice(0, 200),
        doi: stringValue(result.doi),
      },
    });
  }
  return items;
}

function normalizeGeneric(rawData: unknown): NormalizedItem[] {
  const container = asRecord(rawData);
  const source = Array.isArray(rawData)
    ? rawData
    : Array.isArray(container?.metrics)
      ? container.metrics
      : Array.isArray(container?.events)
        ? container.events
        : [];
  return source.flatMap((rawItem) => {
    const item = asRecord(rawItem);
    if (!item) return [];
    return [recordToNormalizedItem(item)];
  });
}

function recordToNormalizedItem(item: JsonRecord): NormalizedItem {
  const rawIdentifiers = Array.isArray(item.identity_external_ids) ? item.identity_external_ids : [];
  const identityExternalIds = rawIdentifiers.flatMap((rawIdentifier) => {
    const identifier = asRecord(rawIdentifier);
    const provider = stringValue(identifier?.provider);
    const externalId = stringValue(identifier?.external_id);
    return provider && externalId ? [{ provider, externalId }] : [];
  });

  return {
    domain: stringValue(item.domain) ?? "unknown",
    metric: stringValue(item.metric) ?? undefined,
    metric_name: stringValue(item.metric_name) ?? undefined,
    iso3: stringValue(item.iso3) ?? undefined,
    period: stringValue(item.period) ?? undefined,
    value: finiteNumber(item.value) ?? undefined,
    unit: stringValue(item.unit),
    confidence: unitOrNull(item.confidence),
    confidence_semantics: stringValue(item.confidence_semantics),
    freshness_score: unitOrNull(item.freshness_score),
    freshness_semantics: stringValue(item.freshness_semantics),
    source: stringValue(item.source),
    provenance_observed_at: isoDateOrNull(item.provenance_observed_at),
    provenance_observed_at_semantics: stringValue(item.provenance_observed_at_semantics),
    raw: asRecord(item.raw) ?? undefined,
    event_type: stringValue(item.event_type) ?? undefined,
    title: stringValue(item.title) ?? undefined,
    description: stringValue(item.description),
    entity_name: stringValue(item.entity_name) ?? undefined,
    entity_type: stringValue(item.entity_type) ?? undefined,
    location_name: stringValue(item.location_name) ?? undefined,
    started_at: isoDateOrNull(item.started_at),
    started_at_semantics: stringValue(item.started_at_semantics),
    ended_at: isoDateOrNull(item.ended_at),
    severity: unitOrNull(item.severity),
    metadata: asRecord(item.metadata) ?? undefined,
    partner_iso3: stringValue(item.partner_iso3) ?? undefined,
    partner_name: stringValue(item.partner_name) ?? undefined,
    institution_name: stringValue(item.institution_name) ?? undefined,
    commodity_name: stringValue(item.commodity_name) ?? undefined,
    identity_external_ids: identityExternalIds,
  };
}

function serverNormalize(providerName: string, rawData: unknown, endpoint: string): NormalizedItem[] {
  switch (providerName) {
    case "worldbank": return normalizeWorldBank(rawData, endpoint);
    case "imf": return normalizeIMF(rawData, endpoint);
    case "openalex": return normalizeOpenAlex(rawData);
    default: return [];
  }
}

function inferDomain(indicator: string): string {
  const value = indicator.toUpperCase();
  if (value.includes("GDP") || value.includes("INF") || value.includes("CPI") || value.includes("DEBT") || value.includes("FDI")) return "finance";
  if (value.includes("POP") || value.includes("LIFE") || value.includes("MORT")) return "demographics";
  if (value.includes("UEM") || value.includes("LABOR") || value.includes("EMP")) return "labor";
  if (value.includes("EXP") || value.includes("IMP") || value.includes("TRADE")) return "trade";
  if (value.includes("CO2") || value.includes("ENERGY") || value.includes("ELEC")) return "environment";
  if (value.includes("INTERNET") || value.includes("TECH") || value.includes("MOBILE")) return "technology";
  if (value.includes("EDUC") || value.includes("LITERACY") || value.includes("SCHOOL")) return "education";
  if (value.includes("HEALTH") || value.includes("DISEASE")) return "health";
  if (value.includes("GINI") || value.includes("POV")) return "inequality";
  return "unknown";
}

async function runIngestion(supabase: SupabaseClient, params: JsonRecord) {
  const providerName = stringValue(params.provider_name);
  const endpoint = stringValue(params.endpoint);
  const runMode = stringValue(params.run_mode) ?? "live";
  if (!providerName || !endpoint || !ALLOWED_PROVIDERS.has(providerName)) {
    return errorResponse(new Error("valid provider_name and endpoint required"), 400);
  }

  const startTime = Date.now();
  const retrievedAt = new Date().toISOString();
  const fetchParams = asRecord(params.fetch_params) ?? {};

  const { data: run, error: runError } = await supabase
    .from("provider_runs")
    .insert({
      provider_name: providerName,
      endpoint,
      params: fetchParams,
      status: "running",
      run_mode: runMode,
      adapter_version: ADAPTER_VERSION,
    })
    .select()
    .single();
  if (runError) return errorResponse(runError);

  const runId = String(run.id);
  const errors: Array<{
    stage: string;
    error_message: string;
    error_detail?: JsonRecord;
    source_record?: unknown;
  }> = [];
  let recordsFetched = 0;
  let recordsNormalized = 0;
  let recordsInserted = 0;
  let recordsUpdated = 0;
  let entitiesResolved = 0;
  let entityCandidatesQueued = 0;
  let linksCreated = 0;

  try {
    const suppliedData = params.data;
    let rawData: unknown = suppliedData;
    let sourceUrl: string | null = null;

    if (rawData === undefined || rawData === null) {
      const explicitFetchUrl = stringValue(params.fetch_url);
      const generatedUrl = buildProviderUrl(providerName, endpoint, fetchParams);
      sourceUrl = explicitFetchUrl
        ? validateProviderFetchUrl(providerName, explicitFetchUrl)
        : generatedUrl;
      if (!sourceUrl) throw new Error("No safe provider URL available");

      rawData = await resilientCall(`fetch:${providerName}`, async () => {
        const response = await fetch(sourceUrl as string);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        return response.json() as Promise<unknown>;
      }, { timeoutMs: 30_000 });
    }

    if (rawData === undefined || rawData === null) throw new Error("No data returned");

    const rawJson = JSON.stringify(rawData);
    const payloadHash = await sha256(rawJson);
    const { data: rawPayload, error: rawError } = await supabase
      .from("provider_raw_payloads")
      .insert({
        provider_run_id: runId,
        payload: rawData,
        payload_hash: payloadHash,
        fetched_at: retrievedAt,
      })
      .select("id")
      .single();
    if (rawError) throw rawError;
    const rawPayloadId = String(rawPayload.id);

    const normalizedItems = suppliedData !== undefined && runMode !== "replay"
      ? normalizeGeneric(rawData)
      : serverNormalize(providerName, rawData, endpoint);
    recordsFetched = normalizedItems.length;

    const metricRows: JsonRecord[] = [];
    const eventRows: JsonRecord[] = [];
    const entityLinkQueue: LinkQueueItem[] = [];
    const resolutionByDedupKey = new Map<string, ResolutionResult[]>();

    for (const item of normalizedItems) {
      try {
        const isEvent = Boolean(item.event_type || item.title);

        if (isEvent) {
          const primary = await resolveEntityForIngestion(supabase, {
            name: item.entity_name,
            entityType: item.entity_type ?? "country",
            iso3: item.iso3,
            externalIds: item.identity_external_ids,
          });
          const location = await resolveEntityForIngestion(supabase, {
            name: item.location_name ?? item.iso3,
            entityType: "country",
            iso3: item.iso3,
          });
          entityCandidatesQueued += primary.candidateRecordIds.length + location.candidateRecordIds.length;

          const links: EntityLinkCandidate[] = [];
          if (primary.id && primary.method) {
            links.push({ entityId: primary.id, role: "primary_entity", resolutionMethod: primary.method });
            entitiesResolved += 1;
          }
          if (location.id && location.method && location.id !== primary.id) {
            links.push({ entityId: location.id, role: "location_entity", resolutionMethod: location.method });
            entitiesResolved += 1;
          }

          const eventType = item.event_type ?? "unknown";
          const title = item.title ?? "Untitled";
          const dedupKey = eventDedupKey(providerName, eventType, title, item.started_at);
          const confidence = canonicalUnitValue(item.confidence, item.confidence_semantics);
          const freshness = canonicalUnitValue(item.freshness_score, item.freshness_semantics);
          const startedAt = canonicalTimeValue(item.started_at, item.started_at_semantics);

          eventRows.push({
            provider_name: providerName,
            event_type: eventType,
            title,
            description: item.description ?? null,
            entity_id: primary.id,
            location_entity_id: location.id,
            iso3: item.iso3 ?? null,
            started_at: startedAt.value,
            started_at_semantics: startedAt.semantics,
            reported_started_at: startedAt.reported,
            ended_at: item.ended_at ?? null,
            severity: item.severity ?? null,
            confidence: confidence.value,
            confidence_semantics: confidence.semantics,
            reported_confidence: confidence.reported,
            provenance_source: item.source ?? providerName,
            raw_payload_id: rawPayloadId,
            provider_run_id: runId,
            dedup_key: dedupKey,
            metadata: {
              ...(item.raw ?? item.metadata ?? {}),
              identity_resolution: [primary.semantics, location.semantics],
              identity_candidate_record_ids: [
                ...primary.candidateRecordIds,
                ...location.candidateRecordIds,
              ],
            },
            freshness_score: freshness.value,
            freshness_semantics: freshness.semantics,
            reported_freshness_score: freshness.reported,
            retrieved_at: retrievedAt,
            last_verified_at: null,
          });

          resolutionByDedupKey.set(dedupKey, [primary, location]);
          if (links.length > 0) entityLinkQueue.push({ factType: "event", dedupKey, links });
        } else {
          if (!Number.isFinite(item.value)) throw new Error("Metric requires a finite value");

          const primary = await resolveEntityForIngestion(supabase, {
            name: item.entity_name ?? item.iso3,
            entityType: "country",
            iso3: item.iso3,
            externalIds: item.identity_external_ids,
          });
          const partner = item.partner_iso3 || item.partner_name
            ? await resolveEntityForIngestion(supabase, {
                name: item.partner_name ?? item.partner_iso3,
                entityType: "country",
                iso3: item.partner_iso3,
              })
            : emptyResolution();
          const institution = item.institution_name
            ? await resolveEntityForIngestion(supabase, {
                name: item.institution_name,
                entityType: "company",
              })
            : emptyResolution();
          entityCandidatesQueued += primary.candidateRecordIds.length + partner.candidateRecordIds.length + institution.candidateRecordIds.length;

          const links: EntityLinkCandidate[] = [];
          for (const [resolution, role] of [
            [primary, "primary_entity"],
            [partner, "partner_entity"],
            [institution, "institution_entity"],
          ] as const) {
            if (resolution.id && resolution.method) {
              links.push({ entityId: resolution.id, role, resolutionMethod: resolution.method });
              entitiesResolved += 1;
            }
          }

          const metricName = item.metric ?? item.metric_name ?? "unknown";
          const period = item.period ?? "";
          const dedupKey = metricDedupKey(
            providerName,
            metricName,
            item.iso3,
            period,
            primary.id ?? undefined,
          );
          const confidence = canonicalUnitValue(item.confidence, item.confidence_semantics);
          const freshness = canonicalUnitValue(item.freshness_score, item.freshness_semantics);
          const sourceObservedAt = canonicalTimeValue(
            item.provenance_observed_at,
            item.provenance_observed_at_semantics,
          );

          metricRows.push({
            provider_name: providerName,
            domain: item.domain || "unknown",
            metric_name: metricName,
            entity_id: primary.id,
            related_entity_id: partner.id,
            location_entity_id: primary.id,
            iso3: item.iso3 ?? null,
            period,
            value: item.value,
            unit: item.unit ?? null,
            confidence: confidence.value,
            confidence_semantics: confidence.semantics,
            reported_confidence: confidence.reported,
            provenance_source: item.source ?? providerName,
            provenance_observed_at: sourceObservedAt.value,
            provenance_observed_at_semantics: sourceObservedAt.semantics,
            reported_provenance_observed_at: sourceObservedAt.reported,
            retrieved_at: retrievedAt,
            raw_payload_id: rawPayloadId,
            provider_run_id: runId,
            dedup_key: dedupKey,
            freshness_score: freshness.value,
            freshness_semantics: freshness.semantics,
            reported_freshness_score: freshness.reported,
            last_verified_at: null,
          });

          resolutionByDedupKey.set(dedupKey, [primary, partner, institution]);
          if (links.length > 0) entityLinkQueue.push({ factType: "metric", dedupKey, links });
        }
        recordsNormalized += 1;
      } catch (error) {
        errors.push({
          stage: "normalize",
          error_message: error instanceof Error ? error.message : String(error),
          source_record: item,
        });
      }
    }

    const metricWrite = await upsertFacts(supabase, "normalized_metrics", metricRows);
    recordsInserted += metricWrite.inserted;
    recordsUpdated += metricWrite.updated;
    errors.push(...metricWrite.errors);

    const eventWrite = await upsertFacts(supabase, "normalized_events", eventRows);
    recordsInserted += eventWrite.inserted;
    recordsUpdated += eventWrite.updated;
    errors.push(...eventWrite.errors);

    const linkResult = await persistEntityFactLinks(supabase, entityLinkQueue);
    linksCreated += linkResult.created;
    errors.push(...linkResult.errors);

    const provenanceRows: JsonRecord[] = [
      ...metricRows.map((row) => provenanceRow({
        row,
        factType: "metric",
        providerName,
        endpoint,
        retrievedAt,
        sourceUrl,
        resolutions: resolutionByDedupKey.get(String(row.dedup_key)) ?? [],
      })),
      ...eventRows.map((row) => provenanceRow({
        row,
        factType: "event",
        providerName,
        endpoint,
        retrievedAt,
        sourceUrl,
        resolutions: resolutionByDedupKey.get(String(row.dedup_key)) ?? [],
      })),
    ];
    for (let index = 0; index < provenanceRows.length; index += 500) {
      const { error } = await supabase
        .from("data_provenance")
        .insert(provenanceRows.slice(index, index + 500));
      if (error) errors.push({ stage: "persist_provenance", error_message: error.message });
    }

    if (errors.length > 0) {
      await supabase.from("ingestion_errors").insert(
        errors.map((error) => ({ provider_run_id: runId, ...error })),
      );
    }

    const durationMs = Date.now() - startTime;
    const recordsWritten = recordsInserted + recordsUpdated;
    await supabase.from("provider_runs").update({
      status: errors.length > 0 ? "completed_with_errors" : "completed",
      completed_at: new Date().toISOString(),
      records_fetched: recordsFetched,
      records_normalized: recordsNormalized,
      records_written: recordsWritten,
      records_inserted: recordsInserted,
      records_updated: recordsUpdated,
      records_deduplicated: 0,
      entities_resolved: entitiesResolved,
      error_count: errors.length,
      error_summary: errors.length > 0
        ? errors.slice(0, 3).map((error) => error.error_message).join("; ")
        : null,
      duration_ms: durationMs,
    }).eq("id", runId);

    structuredLog("info", FN, `Ingestion complete: ${providerName}/${endpoint}`, {
      recordsFetched,
      recordsNormalized,
      recordsInserted,
      recordsUpdated,
      entitiesResolved,
      entityCandidatesQueued,
      linksCreated,
      errors: errors.length,
      durationMs,
    });

    return jsonResponse({
      ok: true,
      run_id: runId,
      provider: providerName,
      endpoint,
      run_mode: runMode,
      records_fetched: recordsFetched,
      records_normalized: recordsNormalized,
      records_inserted: recordsInserted,
      records_updated: recordsUpdated,
      records_written: recordsWritten,
      entities_resolved: entitiesResolved,
      entity_candidates_queued: entityCandidatesQueued,
      links_created: linksCreated,
      error_count: errors.length,
      duration_ms: durationMs,
      epistemic_contract: {
        name_alias_fuzzy_auto_linking: false,
        missing_confidence_remains_null: true,
        missing_freshness_remains_null: true,
        retrieval_time_used_as_source_event_time: false,
      },
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    await supabase.from("provider_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_summary: error instanceof Error ? error.message : String(error),
      error_count: errors.length + 1,
      duration_ms: durationMs,
    }).eq("id", runId);

    structuredLog("error", FN, `Ingestion failed: ${error instanceof Error ? error.message : String(error)}`);
    return errorResponse(error);
  }
}

async function upsertFacts(
  supabase: SupabaseClient,
  table: "normalized_metrics" | "normalized_events",
  rows: JsonRecord[],
): Promise<{
  inserted: number;
  updated: number;
  errors: Array<{ stage: string; error_message: string }>;
}> {
  let inserted = 0;
  let updated = 0;
  const errors: Array<{ stage: string; error_message: string }> = [];
  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    const keys = batch.map((row) => String(row.dedup_key));
    const { data: existing } = await supabase
      .from(table)
      .select("dedup_key")
      .in("dedup_key", keys);
    const existingKeys = new Set((existing ?? []).map((row) => String(row.dedup_key)));

    const { data: upserted, error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: "dedup_key", ignoreDuplicates: false })
      .select("id,dedup_key");
    if (error) {
      errors.push({ stage: `persist_${table}`, error_message: error.message });
      continue;
    }
    for (const row of upserted ?? []) {
      if (existingKeys.has(String(row.dedup_key))) updated += 1;
      else inserted += 1;
    }
  }
  return { inserted, updated, errors };
}

async function persistEntityFactLinks(
  supabase: SupabaseClient,
  queue: LinkQueueItem[],
): Promise<{ created: number; errors: Array<{ stage: string; error_message: string }> }> {
  const errors: Array<{ stage: string; error_message: string }> = [];
  if (queue.length === 0) return { created: 0, errors };

  const metricKeys = queue.filter((item) => item.factType === "metric").map((item) => item.dedupKey);
  const eventKeys = queue.filter((item) => item.factType === "event").map((item) => item.dedupKey);
  const metricIds = await lookupFactIds(supabase, "normalized_metrics", metricKeys);
  const eventIds = await lookupFactIds(supabase, "normalized_events", eventKeys);
  const metricRows: JsonRecord[] = [];
  const eventRows: JsonRecord[] = [];

  for (const item of queue) {
    const factId = item.factType === "metric"
      ? metricIds.get(item.dedupKey)
      : eventIds.get(item.dedupKey);
    if (!factId) continue;
    for (const link of item.links) {
      const row = {
        entity_id: link.entityId,
        link_role: link.role,
        confidence: null,
        confidence_semantics: `${link.resolutionMethod}_identity_decision_not_probability`,
      };
      if (item.factType === "metric") metricRows.push({ metric_id: factId, ...row });
      else eventRows.push({ event_id: factId, ...row });
    }
  }

  let created = 0;
  for (let index = 0; index < metricRows.length; index += 200) {
    const batch = metricRows.slice(index, index + 200);
    const { error } = await supabase.from("entity_metric_links").upsert(
      batch,
      { onConflict: "metric_id,entity_id,link_role", ignoreDuplicates: true },
    );
    if (error) errors.push({ stage: "persist_metric_entity_links", error_message: error.message });
    else created += batch.length;
  }
  for (let index = 0; index < eventRows.length; index += 200) {
    const batch = eventRows.slice(index, index + 200);
    const { error } = await supabase.from("entity_event_links").upsert(
      batch,
      { onConflict: "event_id,entity_id,link_role", ignoreDuplicates: true },
    );
    if (error) errors.push({ stage: "persist_event_entity_links", error_message: error.message });
    else created += batch.length;
  }
  return { created, errors };
}

async function lookupFactIds(
  supabase: SupabaseClient,
  table: "normalized_metrics" | "normalized_events",
  keys: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let index = 0; index < keys.length; index += 200) {
    const chunk = keys.slice(index, index + 200);
    const { data } = await supabase.from(table).select("id,dedup_key").in("dedup_key", chunk);
    for (const row of data ?? []) result.set(String(row.dedup_key), String(row.id));
  }
  return result;
}

function provenanceRow(input: {
  row: JsonRecord;
  factType: "metric" | "event";
  providerName: string;
  endpoint: string;
  retrievedAt: string;
  sourceUrl: string | null;
  resolutions: ResolutionResult[];
}): JsonRecord {
  const resolutionMethods = input.resolutions
    .filter((resolution) => resolution.id && resolution.method)
    .map((resolution) => resolution.method);
  const candidateIds = input.resolutions.flatMap((resolution) => resolution.candidateRecordIds);

  return {
    fact_type: input.factType,
    fact_id: String(input.row.dedup_key),
    source_provider: input.providerName,
    source_endpoint: input.endpoint,
    source_url: input.sourceUrl,
    confidence: input.row.confidence ?? null,
    confidence_semantics: input.row.confidence_semantics ?? "not_quantified",
    freshness_score: input.row.freshness_score ?? null,
    freshness_semantics: input.row.freshness_semantics ?? "not_quantified",
    quality_score: null,
    quality_semantics: "not_assessed",
    entity_match_confidence: null,
    entity_match_confidence_semantics: resolutionMethods.length > 0
      ? "not_issued_identity_resolution_decision_not_probability"
      : "not_issued_identity_unresolved_or_candidate_only",
    observed_at: input.retrievedAt,
    observed_at_semantics: "system_ingestion_observation_time",
    retrieved_at: input.retrievedAt,
    adapter_version: ADAPTER_VERSION,
    metadata: {
      identity_resolution_methods: resolutionMethods,
      identity_candidate_record_ids: candidateIds,
      source_event_time_substituted_from_retrieval_time: false,
    },
  };
}

async function replayIngestion(supabase: SupabaseClient, params: JsonRecord) {
  const providerRunId = stringValue(params.provider_run_id);
  if (!providerRunId) return errorResponse(new Error("provider_run_id required"), 400);

  const { data: originalRun, error: runError } = await supabase
    .from("provider_runs")
    .select("provider_name,endpoint,params")
    .eq("id", providerRunId)
    .single();
  if (runError || !originalRun) return errorResponse(new Error("Original run not found"), 404);

  const { data: rawPayload } = await supabase
    .from("provider_raw_payloads")
    .select("payload")
    .eq("provider_run_id", providerRunId)
    .limit(1)
    .single();
  if (!rawPayload) return errorResponse(new Error("No raw payload found for run"), 404);

  return runIngestion(supabase, {
    provider_name: originalRun.provider_name,
    endpoint: originalRun.endpoint,
    data: rawPayload.payload,
    run_mode: "replay",
    fetch_params: {
      ...(asRecord(originalRun.params) ?? {}),
      replay_source_run_id: providerRunId,
    },
  });
}

async function metricsByEntity(supabase: SupabaseClient, params: JsonRecord) {
  const entityId = stringValue(params.entity_id);
  const domain = stringValue(params.domain);
  const metricName = stringValue(params.metric_name);
  const limit = positiveInteger(params.limit, 500) ?? 50;
  if (!entityId) return errorResponse(new Error("entity_id required"), 400);

  let query = supabase
    .from("normalized_metrics")
    .select("*")
    .eq("entity_id", entityId)
    .order("period", { ascending: false })
    .limit(limit);
  if (domain) query = query.eq("domain", domain);
  if (metricName) query = query.eq("metric_name", metricName);

  const { data, error } = await query;
  if (error) return errorResponse(error);
  return jsonResponse({ metrics: data, count: data?.length ?? 0 });
}

async function timeseries(supabase: SupabaseClient, params: JsonRecord) {
  const entityId = stringValue(params.entity_id);
  const iso3 = stringValue(params.iso3);
  const metricName = stringValue(params.metric_name);
  const domain = stringValue(params.domain);
  const startPeriod = stringValue(params.start_period);
  const endPeriod = stringValue(params.end_period);
  const limit = positiveInteger(params.limit, 5_000) ?? 500;
  if (!metricName) return errorResponse(new Error("metric_name required"), 400);

  let query = supabase
    .from("normalized_metrics")
    .select("period,value,unit,confidence,confidence_semantics,provider_name,provenance_source,freshness_score,freshness_semantics,retrieved_at")
    .eq("metric_name", metricName)
    .order("period", { ascending: true })
    .limit(limit);
  if (entityId) query = query.eq("entity_id", entityId);
  if (iso3) query = query.eq("iso3", iso3);
  if (domain) query = query.eq("domain", domain);
  if (startPeriod) query = query.gte("period", startPeriod);
  if (endPeriod) query = query.lte("period", endPeriod);

  const { data, error } = await query;
  if (error) return errorResponse(error);
  return jsonResponse({ metric: metricName, series: data, count: data?.length ?? 0 });
}

async function eventsByEntity(supabase: SupabaseClient, params: JsonRecord) {
  const entityId = stringValue(params.entity_id);
  const iso3 = stringValue(params.iso3);
  const eventType = stringValue(params.event_type);
  const limit = positiveInteger(params.limit, 500) ?? 50;

  let query = supabase
    .from("normalized_events")
    .select("*")
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (entityId) query = query.or(`entity_id.eq.${entityId},location_entity_id.eq.${entityId}`);
  if (iso3) query = query.eq("iso3", iso3);
  if (eventType) query = query.eq("event_type", eventType);

  const { data, error } = await query;
  if (error) return errorResponse(error);
  return jsonResponse({ events: data, count: data?.length ?? 0 });
}

async function runHealth(supabase: SupabaseClient, params: JsonRecord) {
  const providerName = stringValue(params.provider_name);
  const limit = positiveInteger(params.limit, 200) ?? 20;

  let query = supabase
    .from("provider_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (providerName) query = query.eq("provider_name", providerName);

  const { data, error } = await query;
  if (error) return errorResponse(error);
  const runs = data ?? [];
  const numericSum = (field: string) => runs.reduce(
    (sum, row) => sum + (finiteNumber(row[field]) ?? 0),
    0,
  );
  const measuredDurations = runs
    .map((row) => finiteNumber(row.duration_ms))
    .filter((value): value is number => value !== null);

  return jsonResponse({
    runs,
    summary: {
      total_runs: runs.length,
      successful: runs.filter((row) => row.status === "completed").length,
      with_errors: runs.filter((row) => row.status === "completed_with_errors").length,
      failed: runs.filter((row) => row.status === "failed").length,
      running: runs.filter((row) => row.status === "running").length,
      avg_duration_ms: measuredDurations.length > 0
        ? Math.round(measuredDurations.reduce((sum, value) => sum + value, 0) / measuredDurations.length)
        : null,
      total_records_inserted: numericSum("records_inserted"),
      total_records_updated: numericSum("records_updated"),
      total_records_written: numericSum("records_written"),
      total_entities_resolved: numericSum("entities_resolved"),
    },
  });
}

async function latestByCountry(supabase: SupabaseClient, params: JsonRecord) {
  const iso3 = stringValue(params.iso3);
  const domain = stringValue(params.domain);
  const limit = positiveInteger(params.limit, 1_000) ?? 100;
  if (!iso3) return errorResponse(new Error("iso3 required"), 400);

  let query = supabase
    .from("normalized_metrics")
    .select("metric_name,value,unit,period,confidence,confidence_semantics,provider_name,domain,freshness_score,freshness_semantics,retrieved_at")
    .eq("iso3", iso3.toUpperCase())
    .order("period", { ascending: false })
    .limit(limit);
  if (domain) query = query.eq("domain", domain);

  const { data, error } = await query;
  if (error) return errorResponse(error);
  const latest = new Map<string, JsonRecord>();
  for (const row of (data ?? []) as JsonRecord[]) {
    const metricName = stringValue(row.metric_name);
    const period = stringValue(row.period);
    if (!metricName || !period) continue;
    const existing = latest.get(metricName);
    const existingPeriod = stringValue(existing?.period);
    if (!existing || !existingPeriod || period > existingPeriod) latest.set(metricName, row);
  }
  return jsonResponse({ iso3, metrics: [...latest.values()], count: latest.size });
}

function buildProviderUrl(providerName: string, endpoint: string, params: JsonRecord): string | null {
  const builder = PROVIDER_URLS[providerName];
  if (!builder) return null;
  return builder({ ...params, indicator: endpoint, endpoint });
}

function validateProviderFetchUrl(providerName: string, value: string): string {
  const url = new URL(value);
  const allowedHosts = PROVIDER_HOSTS[providerName];
  if (url.protocol !== "https:" || !allowedHosts?.has(url.hostname.toLowerCase())) {
    throw new Error(`fetch_url host is not allowed for provider ${providerName}`);
  }
  return url.toString();
}

function canonicalUnitValue(
  value: number | null | undefined,
  semantics: string | null | undefined,
): { value: number | null; semantics: string; reported: number | null } {
  const numeric = unitOrNull(value);
  const semanticText = semantics?.trim() ?? "";
  if (numeric === null) {
    return { value: null, semantics: semanticText || "not_quantified", reported: null };
  }
  if (!semanticText || semanticsAreUnlabeled(semanticText)) {
    return {
      value: null,
      semantics: "withheld_unlabeled_numeric_value",
      reported: numeric,
    };
  }
  return { value: numeric, semantics: semanticText, reported: null };
}

function canonicalTimeValue(
  value: string | null | undefined,
  semantics: string | null | undefined,
): { value: string | null; semantics: string; reported: string | null } {
  const timestamp = isoDateOrNull(value);
  const semanticText = semantics?.trim() ?? "";
  if (!timestamp) {
    return { value: null, semantics: semanticText || "source_time_unknown", reported: null };
  }
  if (!semanticText || semanticsAreUnlabeled(semanticText)) {
    return {
      value: null,
      semantics: "withheld_unlabeled_source_time",
      reported: timestamp,
    };
  }
  return { value: timestamp, semantics: semanticText, reported: null };
}

function semanticsAreUnlabeled(value: string): boolean {
  const normalized = value.toLowerCase();
  return ["legacy", "unknown", "unverified", "unspecified", "not_quantified"]
    .some((token) => normalized.includes(token));
}

function emptyResolution(): ResolutionResult {
  return {
    id: null,
    method: null,
    candidateCount: 0,
    candidateRecordIds: [],
    semantics: "not_applicable",
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericStringOrNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function unitOrNull(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric >= 0 && numeric <= 1 ? numeric : null;
}

function isoDateOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function positiveInteger(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max
    ? value
    : null;
}

function integerString(value: unknown): string | null {
  return typeof value === "number" && Number.isInteger(value) ? String(value) : stringValue(value);
}
