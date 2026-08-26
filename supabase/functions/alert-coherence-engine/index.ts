import { requireAdminOrTrustedWorker } from "../_shared/auth.ts";
// Alert Coherence Engine — deterministic, no AI credits required.
// 1. Escalates fresh high/critical `alerts` into `critical_alerts` (powers map + notifications).
// 2. Synthesizes `intelligence_signals` from cross-domain correlation patterns.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SEVERITY_MAP: Record<string, number> = { critical: 9, high: 7, medium: 5, low: 3 };
const DIVISION_TO_DOMAIN: Record<string, string> = {
  food: 'food', health: 'health', energy: 'energy', crisis: 'crisis',
  intelligence: 'intelligence', governance: 'governance', system: 'system',
  'decision-engine': 'decisions',
};

// Simple country-name → ISO3 fallback (extend as needed; null when unknown is fine)
const COUNTRY_TO_ISO3: Record<string, string> = {
  'United States': 'USA', 'USA': 'USA', 'US': 'USA',
  'United Kingdom': 'GBR', 'UK': 'GBR',
  'Germany': 'DEU', 'France': 'FRA', 'China': 'CHN', 'India': 'IND',
  'Brazil': 'BRA', 'Russia': 'RUS', 'Japan': 'JPN', 'Canada': 'CAN',
  'Australia': 'AUS', 'Mexico': 'MEX', 'Nigeria': 'NGA', 'Kenya': 'KEN',
  'South Africa': 'ZAF', 'Egypt': 'EGY', 'Turkey': 'TUR', 'Iran': 'IRN',
  'Saudi Arabia': 'SAU', 'Indonesia': 'IDN', 'Pakistan': 'PAK',
  'Bangladesh': 'BGD', 'Vietnam': 'VNM', 'Thailand': 'THA',
  'Philippines': 'PHL', 'Ukraine': 'UKR', 'Poland': 'POL', 'Italy': 'ITA',
  'Spain': 'ESP', 'Argentina': 'ARG', 'Colombia': 'COL', 'Chile': 'CHL',
};

function toIso3(country: string | null): string | null {
  if (!country) return null;
  if (country.length === 3 && country === country.toUpperCase()) return country;
  return COUNTRY_TO_ISO3[country] ?? null;
}

serve(async (req) => {
  const callerAuth = await requireAdminOrTrustedWorker(req, corsHeaders);
  if (callerAuth.response) return callerAuth.response;

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const start = Date.now();
  const stats = { escalated: 0, signals_created: 0, scanned: 0, skipped_dup: 0 };

  try {
    // ===== STAGE 1: Escalate alerts → critical_alerts =====
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: freshAlerts } = await supabase
      .from('alerts')
      .select('id, severity, title, message, division, country, metadata, created_at')
      .gte('created_at', since)
      .in('severity', ['critical', 'high'])
      .order('created_at', { ascending: false })
      .limit(100);

    stats.scanned = freshAlerts?.length || 0;

    for (const a of freshAlerts || []) {
      // Dedup: skip if a critical_alert with same headline exists in last 24h
      const { data: existing } = await supabase
        .from('critical_alerts')
        .select('id')
        .eq('headline', a.title)
        .gte('triggered_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (existing && existing.length > 0) { stats.skipped_dup++; continue; }

      const iso3 = toIso3(a.country);
      const sevNum = SEVERITY_MAP[a.severity] ?? 5;

      const { error } = await supabase.from('critical_alerts').insert({
        level: a.severity,
        headline: a.title,
        country: a.country,
        iso3,
        event_type: a.division,
        severity: sevNum,
        triggered_at: a.created_at,
        acknowledged: false,
        meta: { source: 'alert-coherence-engine', alert_id: a.id, message: a.message, ...(a.metadata as object || {}) },
      });
      if (!error) stats.escalated++;
    }

    // ===== STAGE 2: Synthesize cross-domain intelligence_signals =====
    // Pattern: same country has alerts across 2+ different divisions in last 24h → cross-domain signal
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentAlerts } = await supabase
      .from('alerts')
      .select('division, country, severity, title, created_at')
      .gte('created_at', since24h)
      .not('country', 'is', null)
      .limit(500);

    // Group by country
    const byCountry = new Map<string, Array<{ division: string; severity: string; title: string; created_at: string }>>();
    for (const a of recentAlerts || []) {
      const key = a.country as string;
      if (!byCountry.has(key)) byCountry.set(key, []);
      byCountry.get(key)!.push(a as any);
    }

    for (const [country, items] of byCountry) {
      const divisions = Array.from(new Set(items.map(i => DIVISION_TO_DOMAIN[i.division] ?? i.division)));
      if (divisions.length < 2) continue; // need cross-domain

      const hasCritical = items.some(i => i.severity === 'critical');
      const sevLabel = hasCritical ? 'critical' : (items.length >= 4 ? 'high' : 'medium');
      const iso3 = toIso3(country);

      const title = `Cross-Domain Pressure: ${country}`;
      // Dedup: skip if same title active in last 24h
      const { data: dupSig } = await supabase
        .from('intelligence_signals')
        .select('id')
        .eq('title', title)
        .gte('created_at', since24h)
        .limit(1);
      if (dupSig && dupSig.length > 0) continue;

      const evidence = items.slice(0, 8).map(i => ({
        source: i.division,
        detail: i.title,
        timestamp: i.created_at,
      }));

      const { error } = await supabase.from('intelligence_signals').insert({
        signal_type: 'cross_domain',
        severity: sevLabel,
        title,
        description: `${country} shows simultaneous pressure across ${divisions.length} domains (${divisions.join(', ')}) with ${items.length} active alerts in the last 24h.`,
        domains: divisions,
        countries: iso3 ? [iso3] : [country],
        source_pages: ['command-center', 'risk-atlas', 'decision-log'],
        confidence: Math.min(95, 50 + items.length * 5 + divisions.length * 5),
        evidence,
        escalation_reason: hasCritical
          ? `Critical-severity alert combined with cross-domain correlation across ${divisions.length} domains.`
          : `Cross-domain correlation detected: ${divisions.length} domains affected simultaneously.`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      if (!error) stats.signals_created++;
    }

    // ===== STAGE 3: Confidence-drop signal — if no high-severity alerts in 12h while events flow =====
    const since12h = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { count: recentHigh } = await supabase
      .from('alerts').select('*', { count: 'exact', head: true })
      .gte('created_at', since12h).in('severity', ['critical', 'high']);
    const { count: recentEvents } = await supabase
      .from('normalized_events').select('*', { count: 'exact', head: true })
      .gte('occurred_at', since12h);

    if ((recentEvents || 0) > 100 && (recentHigh || 0) === 0) {
      const title = 'Detection Quiet Period';
      const { data: dupQ } = await supabase
        .from('intelligence_signals').select('id').eq('title', title)
        .gte('created_at', since24h).limit(1);
      if (!dupQ || dupQ.length === 0) {
        await supabase.from('intelligence_signals').insert({
          signal_type: 'confidence_drop',
          severity: 'low',
          title,
          description: `${recentEvents} events ingested in 12h but zero high/critical alerts emitted. Possible threshold or rule drift.`,
          domains: ['system'],
          countries: [],
          source_pages: ['command-center', 'system-health'],
          confidence: 70,
          evidence: [{ source: 'normalized_events', detail: `${recentEvents} events`, timestamp: new Date().toISOString() }],
          escalation_reason: 'Anomalously low alert rate vs. event ingestion volume.',
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
        stats.signals_created++;
      }
    }

    await supabase.from('automation_logs').insert({
      job_name: 'alert-coherence-engine',
      status: 'success',
      message: `Escalated ${stats.escalated}, signals ${stats.signals_created}, scanned ${stats.scanned}, dup-skipped ${stats.skipped_dup} (${Date.now() - start}ms)`,
    });

    return new Response(JSON.stringify({ ok: true, ...stats, duration_ms: Date.now() - start }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await supabase.from('automation_logs').insert({
      job_name: 'alert-coherence-engine', status: 'error', message: msg,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
