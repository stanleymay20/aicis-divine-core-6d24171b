/**
 * AICIS Ingestion Service — Client-side wrapper for the ingest edge function
 */
import { supabase } from "@/integrations/supabase/client";
import { NormalizedMetric } from "@/lib/providers/types";

interface IngestionRunResult {
  ok: boolean;
  run_id: string;
  provider: string;
  endpoint: string;
  records_fetched: number;
  records_normalized: number;
  records_written: number;
  records_deduplicated: number;
  entities_resolved: number;
  error_count: number;
  duration_ms: number;
}

interface MetricResult {
  metrics: any[];
  count: number;
}

interface TimeseriesResult {
  metric: string;
  series: Array<{ period: string; value: number; unit?: string; confidence?: number; provider_name: string }>;
  count: number;
}

interface EventResult {
  events: any[];
  count: number;
}

interface RunHealthResult {
  runs: any[];
  summary: {
    total_runs: number;
    successful: number;
    with_errors: number;
    failed: number;
    running: number;
    avg_duration_ms: number;
    total_records_written: number;
  };
}

async function invokeIngest(action: string, params: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke("ingest", {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Run ingestion for a provider endpoint.
 * Pass pre-normalized data (from client-side adapter) or a fetch_url for server-side fetch.
 */
export async function runIngestion(params: {
  provider_name: string;
  endpoint: string;
  data?: NormalizedMetric[] | any[];
  fetch_url?: string;
  fetch_params?: Record<string, any>;
}): Promise<IngestionRunResult> {
  return invokeIngest("run", params);
}

/** Get latest metrics for an entity */
export async function getMetricsByEntity(
  entityId: string,
  options?: { domain?: string; metric_name?: string; limit?: number }
): Promise<MetricResult> {
  return invokeIngest("metrics_by_entity", { entity_id: entityId, ...options });
}

/** Get time-series data for a specific metric */
export async function getTimeseries(params: {
  metric_name: string;
  entity_id?: string;
  iso3?: string;
  domain?: string;
  start_period?: string;
  end_period?: string;
  limit?: number;
}): Promise<TimeseriesResult> {
  return invokeIngest("timeseries", params);
}

/** Get events for an entity or location */
export async function getEventsByEntity(params: {
  entity_id?: string;
  iso3?: string;
  event_type?: string;
  limit?: number;
}): Promise<EventResult> {
  return invokeIngest("events_by_entity", params);
}

/** Get provider run health/history */
export async function getRunHealth(
  providerName?: string,
  limit?: number
): Promise<RunHealthResult> {
  return invokeIngest("run_health", { provider_name: providerName, limit });
}

/** Get latest metrics by country ISO3 */
export async function getLatestByCountry(
  iso3: string,
  domain?: string
): Promise<{ iso3: string; metrics: any[]; count: number }> {
  return invokeIngest("latest_by_country", { iso3, domain });
}
