// signal-canonicalizer
// Phase 2.6 — Hardened Signal Constitution Layer.
//
// Pulls up to BATCH signals where canonical_event_status IS NULL, clusters near-duplicates by
// (category × affected_country × time-window × title trigram similarity), and assigns:
//   - canonical_event_id, duplicate_of_signal_id, canonical_event_status, canonicalized_at
//   - source_credibility_score, propaganda_risk_score, source_trust_tier, official_source
//   - corroboration_count, novelty_score
//   - confidence_score + confidence_explanation (jsonb)
//
// Hardening (Phase 2.6):
//   - All arithmetic uses explicit operators
//   - automation_logs.status uses 'success' / 'error'
//   - Canonical recompute pulls EXISTING duplicates already linked by canonical_event_id
//     so a smaller follow-up batch cannot lower confidence
//   - Defensive clustering guards (null timestamps, empty country sets, cross-category)
//   - Per-run update cap to avoid gateway timeouts
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
const MAX_UPDATES_PER_RUN = 1500; // hard cap including canonical recomputes
const SIM_THRESHOLD = 0.55;
const SIM_THRESHOLD_NO_GEO = 0.75;        // both country sets empty -> need very high similarity
const SIM_THRESHOLD_CROSS_CATEGORY = 0.85; // different category allowed only if very high sim + tight window
const WINDOW_HOURS = 24;
const WINDOW_HOURS_CROSS_CATEGORY = 6;
const MS_PER_HOUR = 3_600_000;

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

function tsOf(s: { occurred_at: string | null; first_detected_at: string }): string {
  return s.occurred_at || s.first_detected_at;
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / MS_PER_HOUR;
}

function countriesOverlap(a: string[] | null, b: string[] | null): { overlap: boolean; bothEmpty: boolean } {
  const aEmpty = !a || a.length === 0;
  const bEmpty = !b || b.length === 0;
  if (aEmpty && bEmpty) return { overlap: true, bothEmpty: true };
  if (aEmpty || bEmpty) return { overlap: false, bothEmpty: false };
  const sa = new Set(a);
  for (const x of b!) if (sa.has(x)) return { overlap: true, bothEmpty: false };
  return { overlap: false, bothEmpty: false };
}

async function loadTrust(supa: ReturnType<typeof createClient>): Promise<{ pattern: string; row: TrustRow }[]> {
  const { data, error } = await supa
    .from("signal_source_trust_registry")
    .select("pattern, tier, credibility_score, propaganda_risk_score, is_official")
    .neq("pattern", "__default__");
  if (error) throw error;
  return (data || [])
    .map((r: any) => ({ pattern: r.pattern as string, row: r as TrustRow }))
    .sort((a, b) => b.pattern.length - a.pattern.length);
}

const DEFAULT_TRUST: TrustRow = { tier: "tier_4", credibility_score: 35, propaganda_risk_score: 30, is_official: false };

function resolveTrust(sourceName: string | null, registry: { pattern: string; row: TrustRow }[]): TrustRow {
  if (!sourceName) return DEFAULT_TRUST;
  const lower = sourceName.toLowerCase();
  for (const { pattern, row } of registry) {
    const re = new RegExp("^" + pattern.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$");
    if (re.test(lower)) return row;
  }
  return DEFAULT_TRUST;
}

function computeConfidence(opts: {
  trust: TrustRow;
  distinctSources: number;
  ageHours: number;
}): { score: number; recency: number; corrobBoost: number; officialBoost: number; propPenalty: number } {
  const recency = Math.max(0, 1 - opts.ageHours / 72); // decay over 3 days
  const corrobBoost = Math.min(25, Math.max(0, opts.distinctSources - 1) * 8);
  const officialBoost = opts.trust.is_official ? 8 : 0;
  const propPenalty = Math.round(opts.trust.propaganda_risk_score * 0.25);
  const score = Math.max(
    5,
    Math.min(99,
      Math.round(
        opts.trust.credibility_score * 0.6
        + corrobBoost
        + officialBoost
        + recency * 8
        - propPenalty,
      ),
    ),
  );
  return { score, recency, corrobBoost, officialBoost, propPenalty };
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
        status: "success",
        message: "No pending signals.",
      });
      return new Response(JSON.stringify({ processed: 0, clusters: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Pull recent canonicals to potentially attach new dupes to
    const earliest = pendingSignals[0].first_detected_at;
    const sinceTs = new Date(new Date(earliest).getTime() - WINDOW_HOURS * MS_PER_HOUR).toISOString();
    const { data: recentCanonicals, error: rcErr } = await supa
      .from("global_signals")
      .select("id,title,category,affected_countries,occurred_at,first_detected_at,primary_source,canonical_source_name,ingestion_source,canonical_event_id,corroboration_count")
      .eq("canonical_event_status", "canonical")
      .gte("first_detected_at", sinceTs)
      .limit(5000);
    if (rcErr) throw rcErr;

    type Canon = Sig & {
      canonical_event_id: string;
      sources: Set<string>;
      newDupeIds: string[];   // dupes added in THIS run
      existingDupeCount: number;
      touched: boolean;       // needs recompute?
    };
    const canonicals: Canon[] = (recentCanonicals || []).map((c: any) => ({
      ...c,
      canonical_event_id: c.canonical_event_id || c.id,
      sources: new Set<string>([c.canonical_source_name || c.primary_source || "unknown"]),
      newDupeIds: [],
      existingDupeCount: 0,
      touched: false,
    }));

    // 2b. Pull EXISTING duplicates already linked to these canonicals so we can stably
    //     recompute distinct-source counts (prevents a small batch from lowering confidence).
    const canonIds = canonicals.map(c => c.canonical_event_id);
    if (canonIds.length > 0) {
      // chunk IN() to keep query small
      const chunkSize = 200;
      for (let i = 0; i < canonIds.length; i += chunkSize) {
        const slice = canonIds.slice(i, i + chunkSize);
        const { data: existingDupes, error: edErr } = await supa
          .from("global_signals")
          .select("id,canonical_event_id,canonical_source_name,primary_source")
          .in("canonical_event_id", slice)
          .eq("canonical_event_status", "duplicate");
        if (edErr) throw edErr;
        const byCanon = new Map<string, Canon>();
        for (const c of canonicals) byCanon.set(c.canonical_event_id, c);
        for (const d of existingDupes || []) {
          const c = byCanon.get((d as any).canonical_event_id);
          if (!c) continue;
          c.sources.add((d as any).canonical_source_name || (d as any).primary_source || "unknown");
          c.existingDupeCount += 1;
        }
      }
    }

    const updates: any[] = [];

    // 3. Walk pending in chronological order
    for (const sig of pendingSignals) {
      const nt = normTitle(sig.title);
      const ts = tsOf(sig);
      const sigSource = sig.canonical_source_name || sig.primary_source || "unknown";

      // find best canonical match
      let best: { c: Canon; sim: number } | null = null;
      for (const c of canonicals) {
        const cTs = tsOf(c);
        const dt = hoursBetween(cTs, ts);
        const sameCategory = c.category === sig.category;
        const window = sameCategory ? WINDOW_HOURS : WINDOW_HOURS_CROSS_CATEGORY;
        if (dt > window) continue;

        const geo = countriesOverlap(c.affected_countries, sig.affected_countries);
        if (!geo.overlap) continue;

        const sim = similarity(normTitle(c.title), nt);
        // pick threshold based on context
        let threshold = SIM_THRESHOLD;
        if (!sameCategory) threshold = SIM_THRESHOLD_CROSS_CATEGORY;
        else if (geo.bothEmpty) threshold = SIM_THRESHOLD_NO_GEO;

        if (sim >= threshold && (!best || sim > best.sim)) best = { c, sim };
      }

      const trust = resolveTrust(sigSource, registry);

      if (best) {
        // duplicate
        best.c.newDupeIds.push(sig.id);
        best.c.sources.add(sigSource);
        best.c.touched = true;
        const totalDupes = best.c.existingDupeCount + best.c.newDupeIds.length;
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
          novelty_score: Math.max(0, 100 - totalDupes * 12),
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
          sources: new Set([sigSource]),
          newDupeIds: [],
          existingDupeCount: 0,
          touched: true,
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

      if (updates.length >= MAX_UPDATES_PER_RUN) break;
    }

    // 4. Recompute touched canonicals' corroboration / confidence using FULL source set
    const canonPatch: any[] = [];
    const nowIso = new Date().toISOString();
    for (const c of canonicals) {
      if (!c.touched) continue;
      const distinct = c.sources.size;
      const trust = resolveTrust(c.canonical_source_name || c.primary_source, registry);
      const ageHours = hoursBetween(nowIso, tsOf(c));
      const conf = computeConfidence({ trust, distinctSources: distinct, ageHours });

      canonPatch.push({
        id: c.id,
        corroboration_count: distinct,
        multi_source_confirmed: distinct >= 2,
        confidence_score: conf.score,
        confidence_explanation: {
          role: "canonical",
          source_tier: trust.tier,
          source_credibility: trust.credibility_score,
          propaganda_risk: trust.propaganda_risk_score,
          official_source: trust.is_official,
          distinct_sources: distinct,
          recency_factor: Number(conf.recency.toFixed(3)),
          corroboration_boost: conf.corrobBoost,
          official_boost: conf.officialBoost,
          propaganda_penalty: conf.propPenalty,
          formula: "0.6*cred + min(25,(n-1)*8) + officialBoost(8) + recency*8 - 0.25*propRisk",
        },
      });
    }

    // 5. Apply updates
    let written = 0;
    for (const u of updates) {
      const { id, ...patch } = u;
      const { error } = await supa.from("global_signals").update(patch).eq("id", id);
      if (error) throw error;
      written++;
    }
    for (const u of canonPatch) {
      const { id, ...patch } = u;
      const { error } = await supa.from("global_signals").update(patch).eq("id", id);
      if (error) throw error;
    }

    const duration = Date.now() - startedAt;
    const newCanonicals = updates.filter(u => u.canonical_event_status === "canonical").length;
    const dupes = updates.filter(u => u.canonical_event_status === "duplicate").length;

    await supa.from("automation_logs").insert({
      job_name: "signal-canonicalizer",
      status: "success",
      message: `Processed ${written} | canonicals ${newCanonicals} | duplicates ${dupes} | recomputed ${canonPatch.length} | ${duration}ms`,
    });

    return new Response(
      JSON.stringify({
        processed: written,
        new_canonicals: newCanonicals,
        duplicates: dupes,
        recomputed_canonicals: canonPatch.length,
        duration_ms: duration,
        capped: pendingSignals.length > updates.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    const msg = e?.message || e?.error_description || e?.error || e?.details || e?.hint || e?.code || JSON.stringify(e, Object.getOwnPropertyNames(e || {})) || String(e);
    console.error("signal-canonicalizer error:", msg);
    await supa.from("automation_logs").insert({
      job_name: "signal-canonicalizer",
      status: "error",
      message: String(msg).slice(0, 500),
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
