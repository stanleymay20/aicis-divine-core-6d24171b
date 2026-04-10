import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface WatchItem {
  id: string;
  user_id: string;
  watch_type: string;
  country_iso3: string | null;
  region_id: string | null;
  hotspot_key: string | null;
  label: string;
  alert_enabled: boolean;
  alert_threshold: number;
  last_alerted_at: string | null;
  current_status: string;
  last_risk_value: number | null;
  last_checked_at: string | null;
}

interface EventCandidate {
  watchlist_item_id: string;
  event_type: string;
  event_summary: string;
  severity: string;
  previous_value: number | null;
  current_value: number | null;
  delta_value: number | null;
  metadata: Record<string, any>;
  event_hash: string;
}

function computeHash(itemId: string, eventType: string, currentValue: number | null): string {
  // Quantize value to prevent micro-change spam
  const quantized = currentValue != null ? Math.round(currentValue * 10) / 10 : 0;
  return `${itemId}:${eventType}:${quantized}`;
}

function deriveSeverity(delta: number | null, currentValue: number | null): string {
  if (currentValue != null && currentValue >= 80) return "critical";
  if (delta != null && Math.abs(delta) >= 15) return "high";
  if (delta != null && Math.abs(delta) >= 5) return "medium";
  return "low";
}

function deriveStatus(avgRisk: number | null, delta: number | null): string {
  if (avgRisk == null) return "stable";
  if (avgRisk >= 75) return "critical";
  if (delta != null && delta > 5) return "rising";
  if (delta != null && delta < -5) return "improving";
  return "stable";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const results = { processed: 0, eventsCreated: 0, errors: [] as string[] };

  try {
    // Fetch all active watchlist items
    const { data: items, error: itemsErr } = await supabase
      .from("watchlist_items")
      .select("*")
      .eq("is_active", true);

    if (itemsErr) throw itemsErr;
    if (!items?.length) {
      return new Response(JSON.stringify({ message: "No active watch items", ...results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const candidates: EventCandidate[] = [];

    // Process each item by type
    for (const item of items as WatchItem[]) {
      try {
        if (item.watch_type === "country" && item.country_iso3) {
          await processCountry(supabase, item, candidates);
        } else if (item.watch_type === "region" && item.region_id) {
          await processRegion(supabase, item, candidates);
        } else if (item.watch_type === "hotspot" && item.hotspot_key) {
          await processHotspot(supabase, item, candidates);
        }
        results.processed++;
      } catch (e: any) {
        results.errors.push(`${item.id}: ${e.message}`);
      }
    }

    // Insert events with ON CONFLICT to prevent duplicates
    for (const candidate of candidates) {
      const { error: insertErr } = await supabase
        .from("watchlist_events")
        .upsert(candidate, { onConflict: "watchlist_item_id,event_hash", ignoreDuplicates: true });

      if (!insertErr) {
        results.eventsCreated++;

        // Update item status + last_risk_value
        const updatePayload: Record<string, any> = {
          last_checked_at: new Date().toISOString(),
          current_status: deriveStatus(candidate.current_value, candidate.delta_value),
        };
        if (candidate.current_value != null) {
          updatePayload.last_risk_value = candidate.current_value;
        }

        // Alert threshold check
        const matchedItem = (items as WatchItem[]).find((i) => i.id === candidate.watchlist_item_id);
        if (matchedItem?.alert_enabled && candidate.current_value != null && candidate.current_value >= (matchedItem.alert_threshold || 70)) {
          // Only alert if last alert was >6 hours ago
          const lastAlerted = matchedItem.last_alerted_at ? new Date(matchedItem.last_alerted_at).getTime() : 0;
          if (Date.now() - lastAlerted > 6 * 60 * 60 * 1000) {
            updatePayload.last_alerted_at = new Date().toISOString();
          }
        }

        await supabase
          .from("watchlist_items")
          .update(updatePayload)
          .eq("id", candidate.watchlist_item_id);
      }
    }

    // Update last_checked_at for items with no events
    const processedIds = (items as WatchItem[]).map((i) => i.id);
    const eventItemIds = new Set(candidates.map((c) => c.watchlist_item_id));
    const noEventIds = processedIds.filter((id) => !eventItemIds.has(id));
    if (noEventIds.length > 0) {
      await supabase
        .from("watchlist_items")
        .update({ last_checked_at: new Date().toISOString() })
        .in("id", noEventIds);
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message, ...results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Country processing ──
async function processCountry(supabase: any, item: WatchItem, candidates: EventCandidate[]) {
  // 1. Get average risk from country_performance_snapshots
  const { data: snapshots } = await supabase
    .from("country_performance_snapshots")
    .select("domain, risk_pressure_score, momentum_score, forecast_direction")
    .eq("iso3", item.country_iso3)
    .order("snapshot_date", { ascending: false })
    .limit(20);

  if (snapshots?.length) {
    const avgRisk = snapshots.reduce((s: number, r: any) => s + (r.risk_pressure_score || 0), 0) / snapshots.length;
    const previousRisk = item.last_risk_value;
    const delta = previousRisk != null ? avgRisk - previousRisk : null;

    // Risk change event
    if (delta != null && Math.abs(delta) >= 5) {
      candidates.push({
        watchlist_item_id: item.id,
        event_type: delta > 0 ? "risk_increase" : "risk_decrease",
        event_summary: `${item.label} risk ${delta > 0 ? "increased" : "decreased"} by ${Math.abs(delta).toFixed(1)} points to ${avgRisk.toFixed(1)}`,
        severity: deriveSeverity(delta, avgRisk),
        previous_value: previousRisk,
        current_value: Math.round(avgRisk * 10) / 10,
        delta_value: Math.round(delta * 10) / 10,
        metadata: { iso3: item.country_iso3, domains_checked: snapshots.length },
        event_hash: computeHash(item.id, delta > 0 ? "risk_increase" : "risk_decrease", avgRisk),
      });
    }

    // Multi-domain stress (3+ domains elevated simultaneously)
    const stressedDomains = snapshots.filter((s: any) => s.risk_pressure_score >= 50);
    const uniqueStressedDomains = [...new Set(stressedDomains.map((s: any) => s.domain))];
    if (uniqueStressedDomains.length >= 3) {
      candidates.push({
        watchlist_item_id: item.id,
        event_type: "multi_domain_stress",
        event_summary: `${item.label}: ${uniqueStressedDomains.length} domains under stress (${uniqueStressedDomains.slice(0, 3).join(", ")})`,
        severity: uniqueStressedDomains.length >= 5 ? "critical" : "high",
        previous_value: null,
        current_value: uniqueStressedDomains.length,
        delta_value: null,
        metadata: { domains: uniqueStressedDomains, iso3: item.country_iso3 },
        event_hash: computeHash(item.id, "multi_domain_stress", uniqueStressedDomains.length),
      });
    }
  }

  // 2. Detect new high-impact signals for this country
  const cutoff = item.last_checked_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: newSignals } = await supabase
    .from("global_signals")
    .select("id, title, impact_score, category")
    .contains("affected_countries", [item.country_iso3])
    .gte("impact_score", 65)
    .gt("created_at", cutoff)
    .limit(5);

  if (newSignals?.length) {
    const topSignal = newSignals.sort((a: any, b: any) => b.impact_score - a.impact_score)[0];
    candidates.push({
      watchlist_item_id: item.id,
      event_type: topSignal.impact_score >= 80 ? "signal_escalation" : "new_signal",
      event_summary: `${newSignals.length} new signal${newSignals.length > 1 ? "s" : ""} for ${item.label}: "${topSignal.title}" (impact ${topSignal.impact_score})`,
      severity: topSignal.impact_score >= 80 ? "critical" : "medium",
      previous_value: null,
      current_value: topSignal.impact_score,
      delta_value: null,
      metadata: { signal_count: newSignals.length, top_signal_id: topSignal.id, top_category: topSignal.category },
      event_hash: computeHash(item.id, "new_signal", newSignals.length + topSignal.impact_score),
    });
  }
}

// ── Region processing ──
async function processRegion(supabase: any, item: WatchItem, candidates: EventCandidate[]) {
  // Get village indicators for this region
  const { data: indicators } = await supabase
    .from("village_indicators")
    .select("domain, value, confidence, observed_at")
    .eq("region_id", item.region_id)
    .order("observed_at", { ascending: false })
    .limit(30);

  if (indicators?.length) {
    // Calculate average stress
    const avgValue = indicators.reduce((s: number, v: any) => s + (v.value || 0), 0) / indicators.length;
    const previousRisk = item.last_risk_value;
    const delta = previousRisk != null ? avgValue - previousRisk : null;

    if (delta != null && Math.abs(delta) >= 0.1) {
      candidates.push({
        watchlist_item_id: item.id,
        event_type: delta > 0 ? "region_deterioration" : "region_improvement",
        event_summary: `${item.label} indicators ${delta > 0 ? "worsened" : "improved"} by ${Math.abs(delta).toFixed(2)}`,
        severity: deriveSeverity(delta * 50, avgValue * 50),
        previous_value: previousRisk,
        current_value: Math.round(avgValue * 100) / 100,
        delta_value: Math.round(delta * 100) / 100,
        metadata: { region_id: item.region_id, indicators_checked: indicators.length },
        event_hash: computeHash(item.id, delta > 0 ? "region_deterioration" : "region_improvement", avgValue),
      });
    }

    // Low confidence indicators = data quality concern
    const lowConf = indicators.filter((v: any) => v.confidence != null && v.confidence < 0.3);
    if (lowConf.length >= 3) {
      candidates.push({
        watchlist_item_id: item.id,
        event_type: "propagation_alert",
        event_summary: `${item.label}: ${lowConf.length} indicators with low confidence — data quality risk`,
        severity: "medium",
        previous_value: null,
        current_value: lowConf.length,
        delta_value: null,
        metadata: { low_confidence_count: lowConf.length },
        event_hash: computeHash(item.id, "propagation_alert", lowConf.length),
      });
    }
  }
}

// ── Hotspot processing ──
async function processHotspot(supabase: any, item: WatchItem, candidates: EventCandidate[]) {
  // Hotspots are keyed by category or signal cluster
  const cutoff = item.last_checked_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: signals } = await supabase
    .from("global_signals")
    .select("id, title, impact_score, urgency_score, category")
    .eq("category", item.hotspot_key)
    .gte("impact_score", 60)
    .gt("created_at", cutoff)
    .order("impact_score", { ascending: false })
    .limit(10);

  if (signals?.length) {
    const avgImpact = signals.reduce((s: number, sig: any) => s + sig.impact_score, 0) / signals.length;
    const previousRisk = item.last_risk_value;
    const delta = previousRisk != null ? avgImpact - previousRisk : null;

    candidates.push({
      watchlist_item_id: item.id,
      event_type: avgImpact >= 80 ? "signal_escalation" : "new_signal",
      event_summary: `${item.label}: ${signals.length} new signal${signals.length > 1 ? "s" : ""}, avg impact ${avgImpact.toFixed(0)}`,
      severity: avgImpact >= 80 ? "critical" : avgImpact >= 65 ? "high" : "medium",
      previous_value: previousRisk,
      current_value: Math.round(avgImpact * 10) / 10,
      delta_value: delta != null ? Math.round(delta * 10) / 10 : null,
      metadata: { signal_count: signals.length, hotspot_key: item.hotspot_key },
      event_hash: computeHash(item.id, "hotspot_scan", signals.length + avgImpact),
    });
  }
}
