// signal-canonicalizer
// Phase 2.5 — Signal Constitution Layer.
//
// Pulls up to N signals where canonical_event_status IS NULL, clusters near-duplicates by
// (category × affected_country × 24h window × title trigram similarity), and assigns:
//   - canonical_event_id          (cluster head)
//   - duplicate_of_signal_id      (for dupes)
//   - canonical_event_status      ('canonical' | 'duplicate')
//   - canonicalized_at
//   - source_credibility_score    (from registry)
//   - propaganda_risk_score       (from registry)
//   - corroboration_count         (independent sources backing the canonical)
//   - novelty_score               (100 = brand new, low if many recent dupes existed)
//   - confidence_explanation      (jsonb breakdown)
//   - confidence_score            (recomputed 0-100)
//
// Logs to automation_logs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Sig = {
  id: string;
  title: string;
  category: string | null;
  affected_countries: string[] | null;
  occurred_at: string | null;
  first_detected_at: string;
  primary_source: string | null;
  canonical_source_name: string | null;
  ingestion_source: string | null;
};

type TrustRow = { tier: string; credibility_score: number; propaganda_risk_score: number; is_official: boolean };

const BATCH = 1000;
const SIM_THRESHOLD = 0.55;
const WINDOW_HOURS = 24;

function normTitle(t: string): string {
  return (t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s}  `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = trigrams(a), B = trigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 36e5;
}

function countriesOverlap(a: string[] | null, b: string[] | null): boolean {
  if (!a?.length || !b?.length) return !a?.length && !b?.length; // both empty = ok
  const sa = new Set(a);
  for (const x of b) if (sa.has(x)) return true;
  return false;
}

async function loadTrust(supa: ReturnType<typeof createClient>): Promise<{ pattern: string; row: TrustRow }[]> {
  const { data, error } = await supa
    .from("signal_source_trust_registry")
    .select("pattern, tier, credibility_score, propaganda_risk_score, is_official")
    .neq("pattern", "__default__");
  if (error) throw error;
  // longest pattern first for specificity
  return (data || [])
    .map((r: any) => ({ pattern: r.pattern as string, row: r as TrustRow }))
    .sort((a, b) => b.pattern.length - a.pattern.length);
}

const DEFAULT_TRUST: TrustRow = { tier: "tier_4", credibility_score: 35, propaganda_risk_score: 30, is_official: false };

function resolveTrust(sourceName: string | null, registry: { pattern: string; row: TrustRow }[]): TrustRow {
  if (!sourceName) return DEFAULT_TRUST;
  const lower = sourceName.toLowerCase();
  for (const { pattern, row } of registry) {
    // SQL ILIKE -> JS: convert % to .*, escape regex
    const re = new RegExp("^" + pattern.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$");
    if (re.test(lower)) return row;
  }
  return DEFAULT_TRUST;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const registry = await loadTrust(supa);

    // 1. Pull pending signals
    const { data: pending, error: pErr } = await supa
      .from("global_signals")
      .select("id,title,category,affected_countries,occurred_at,first_detected_at,primary_source,canonical_source_name,ingestion_source")
      .is("canonical_event_status", null)
      .order("first_detected_at", { ascending: true })
      .limit(BATCH);
    if (pErr) throw pErr;

    const pendingSignals = (pending || []) as Sig[];
    if (pendingSignals.length === 0) {
      await supa.from("automation_logs").insert({
        job_name: "signal-canonicalizer",
        status: "ok",
        message: "No pending signals.",
      });
      return new Response(JSON.stringify({ processed: 0, clusters: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Pull recent canonicals to potentially attach new dupes to
    const earliest = pendingSignals[0].first_detected_at;
    const sinceTs = new Date(new Date(earliest).getTime() - WINDOW_HOURS * 36e5).toISOString();
    const { data: recentCanonicals, error: rcErr } = await supa
      .from("global_signals")
      .select("id,title,category,affected_countries,occurred_at,first_detected_at,primary_source,canonical_source_name,ingestion_source,canonical_event_id,corroboration_count")
      .eq("canonical_event_status", "canonical")
      .gte("first_detected_at", sinceTs)
      .limit(5000);
    if (rcErr) throw rcErr;

    type Canon = Sig & { canonical_event_id: string; corroboration_count: number; sources: Set<string>; dupeIds: string[] };
    const canonicals: Canon[] = (recentCanonicals || []).map((c: any) => ({
      ...c,
      canonical_event_id: c.canonical_event_id || c.id,
      corroboration_count: c.corroboration_count || 1,
      sources: new Set<string>([c.canonical_source_name || c.primary_source || "unknown"]),
      dupeIds: [],
    }));

    const updates: any[] = [];

    // 3. Walk pending in chronological order
    for (const sig of pendingSignals) {
      const nt = normTitle(sig.title);
      const ts = sig.occurred_at || sig.first_detected_at;
      const sigSource = sig.canonical_source_name || sig.primary_source || "unknown";

      // find best canonical match
      let best: { c: Canon; sim: number } | null = null;
      for (const c of canonicals) {
        if (c.category !== sig.category) continue;
        if (!countriesOverlap(c.affected_countries, sig.affected_countries)) continue;
        const cTs = c.occurred_at || c.first_detected_at;
        if (hoursBetween(cTs, ts) > WINDOW_HOURS) continue;
        const sim = similarity(normTitle(c.title), nt);
        if (sim >= SIM_THRESHOLD && (!best || sim > best.sim)) best = { c, sim };
      }

      const trust = resolveTrust(sigSource, registry);

      if (best) {
        // duplicate
        best.c.dupeIds.push(sig.id);
        best.c.sources.add(sigSource);
        updates.push({
          id: sig.id,
          canonical_event_id: best.c.canonical_event_id,
          duplicate_of_signal_id: best.c.id,
          canonical_event_status: "duplicate",
          canonicalized_at: new Date().toISOString(),
          source_credibility_score: trust.credibility_score,
          propaganda_risk_score: trust.propaganda_risk_score,
          source_trust_tier: trust.tier,
          official_source: trust.is_official,
          corroboration_count: 1,
          novelty_score: Math.max(0, 100 - best.c.dupeIds.length * 12),
          confidence_explanation: {
            role: "duplicate",
            of: best.c.id,
            similarity: Number(best.sim.toFixed(3)),
            source_tier: trust.tier,
          },
        });
      } else {
        // new canonical
        const canonId = sig.id;
        const newCanon: Canon = {
          ...sig,
          canonical_event_id: canonId,
          corroboration_count: 1,
          sources: new Set([sigSource]),
          dupeIds: [],
        };
        canonicals.push(newCanon);
        updates.push({
          id: sig.id,
          canonical_event_id: canonId,
          duplicate_of_signal_id: null,
          canonical_event_status: "canonical",
          canonicalized_at: new Date().toISOString(),
          source_credibility_score: trust.credibility_score,
          propaganda_risk_score: trust.propaganda_risk_score,
          source_trust_tier: trust.tier,
          official_source: trust.is_official,
          corroboration_count: 1,
          novelty_score: 100,
          confidence_explanation: {
            role: "canonical",
            source_tier: trust.tier,
            source_credibility: trust.credibility_score,
            propaganda_risk: trust.propaganda_risk_score,
            official_source: trust.is_official,
          },
        });
      }
    }

    // 4. Recompute canonicals' corroboration / confidence after grouping
    const canonPatch: any[] = [];
    for (const c of canonicals) {
      if (c.dupeIds.length === 0 && !pendingSignals.some(p => p.id === c.id)) continue;
      const distinct = c.sources.size;
      const trust = resolveTrust(c.canonical_source_name || c.primary_source, registry);
      const ageHours = hoursBetween(new Date().toISOString(), c.occurred_at || c.first_detected_at);
      const recency = Math.max(0, 1 - ageHours / 72); // decay over 3 days
      const corrobBoost = Math.min(25, (distinct - 1) * 8);
      const officialBoost = trust.is_official ? 8 : 0;
      const propPenalty = Math.round(trust.propaganda_risk_score * 0.25);
      const confidence = Math.max(
        5,
        Math.min(99,
          Math.round(trust.credibility_score * 0.6 + corrobBoost + officialBoost + recency * 8 - propPenalty),
        ),
      );
      canonPatch.push({
        id: c.id,
        corroboration_count: distinct,
        multi_source_confirmed: distinct >= 2,
        confidence_score: confidence,
        confidence_explanation: {
          role: "canonical",
          source_tier: trust.tier,
          source_credibility: trust.credibility_score,
          propaganda_risk: trust.propaganda_risk_score,
          official_source: trust.is_official,
          distinct_sources: distinct,
          recency_factor: Number(recency.toFixed(3)),
          formula: "0.6*cred + min(25,(n-1)*8) + officialBoost(8) + recency*8 - 0.25*propRisk",
        },
      });
    }

    // 5. Apply updates (chunked)
    let written = 0;
    const chunk = <T,>(arr: T[], n: number) => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    for (const part of chunk(updates, 200)) {
      const { error } = await supa.from("global_signals").upsert(part, { onConflict: "id" });
      if (error) throw error;
      written += part.length;
    }
    for (const part of chunk(canonPatch, 200)) {
      const { error } = await supa.from("global_signals").upsert(part, { onConflict: "id" });
      if (error) throw error;
    }

    const duration = Date.now() - startedAt;
    const newCanonicals = updates.filter(u => u.canonical_event_status === "canonical").length;
    const dupes = updates.filter(u => u.canonical_event_status === "duplicate").length;

    await supa.from("automation_logs").insert({
      job_name: "signal-canonicalizer",
      status: "ok",
      message: `Processed ${written} | canonicals ${newCanonicals} | duplicates ${dupes} | ${duration}ms`,
    });

    return new Response(
      JSON.stringify({ processed: written, new_canonicals: newCanonicals, duplicates: dupes, duration_ms: duration }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : (typeof e === "object" ? JSON.stringify(e) : String(e));
    console.error("signal-canonicalizer error:", msg, e);
    await supa.from("automation_logs").insert({
      job_name: "signal-canonicalizer",
      status: "error",
      message: msg.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
