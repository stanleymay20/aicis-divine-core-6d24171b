import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } }
);

const CLUSTERING_METHOD = "keyword_overlap_v1";
const CLUSTERING_EPISTEMIC_STATUS = "unverified_semantic_cluster";
const MATCH_THRESHOLD = 0.35;

type Signal = {
  id: string;
  title: string | null;
  translated_title: string | null;
  category: string | null;
  affected_countries: string[] | null;
  urgency_score: number | null;
  impact_score: number | null;
  created_at: string | null;
};

type NarrativeMetadata = Record<string, unknown> & { keywords?: string[] };

type Narrative = {
  id: string;
  narrative_title: string | null;
  canonical_countries: string[] | null;
  canonical_sectors: string[] | null;
  metadata: NarrativeMetadata | null;
  signal_count: number | null;
};

function normalize(text?: string | null) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(signal: Signal): string[] {
  const text = normalize([
    signal.translated_title,
    signal.title,
    signal.category,
    ...(signal.affected_countries || []),
  ].filter((value): value is string => typeof value === "string").join(" "));

  const words = text
    .split(" ")
    .filter((w) => w.length >= 4)
    .filter((w) => !STOPWORDS.has(w));

  return [...new Set(words)].slice(0, 12);
}

function lexicalSimilarity(a: string[], b: string[]) {
  const sa = new Set(a);
  const sb = new Set(b);
  const overlap = [...sa].filter((x) => sb.has(x)).length;
  return overlap / Math.max(sa.size, sb.size, 1);
}

function observedEscalationScore(signal: Signal): number | null {
  const values = [signal.urgency_score, signal.impact_score]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

const STOPWORDS = new Set([
  "about","after","before","their","there","would","could","should",
  "because","between","during","against","through","global","breaking",
  "update","official","reports","report","says","according"
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { data: signalRows, error } = await supabase
      .from("global_signals")
      .select("id,title,translated_title,category,affected_countries,urgency_score,impact_score,created_at")
      .is("narrative_clustered_at", null)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) throw error;

    const { data: narrativeRows } = await supabase
      .from("signal_narratives")
      .select("id,narrative_title,canonical_countries,canonical_sectors,metadata,signal_count");

    const signals = (signalRows ?? []) as Signal[];
    const narratives = (narrativeRows ?? []) as Narrative[];
    let clustered = 0;
    let created = 0;

    for (const signal of signals) {
      const keywords = extractKeywords(signal);

      let bestNarrative: Narrative | null = null;
      let bestScore = 0;

      for (const narrative of narratives) {
        const existingKeywords = Array.isArray(narrative.metadata?.keywords)
          ? narrative.metadata.keywords.filter((word): word is string => typeof word === "string")
          : [];
        const score = lexicalSimilarity(keywords, existingKeywords);

        if (score > bestScore) {
          bestScore = score;
          bestNarrative = narrative;
        }
      }

      const escalationScore = observedEscalationScore(signal);
      const signalTime = signal.created_at ?? null;

      if (bestNarrative && bestScore >= MATCH_THRESHOLD) {
        await supabase.from("signal_narrative_members").upsert({
          narrative_id: bestNarrative.id,
          signal_id: signal.id,
          membership_strength: Math.round(bestScore * 100),
          narrative_role: bestScore >= 0.7 ? "core" : "supporting",
          matched_features: keywords,
        });

        await supabase
          .from("signal_narratives")
          .update({
            signal_count: (bestNarrative.signal_count || 0) + 1,
            last_signal_at: signalTime,
            escalation_score: escalationScore,
            metadata: {
              ...(bestNarrative.metadata || {}),
              clustering_method: CLUSTERING_METHOD,
              epistemic_status: CLUSTERING_EPISTEMIC_STATUS,
              similarity_semantics: "lexical_keyword_overlap_not_causality",
              causal_inference: false,
              verification_status: "not_verified",
              match_threshold: MATCH_THRESHOLD,
            },
          })
          .eq("id", bestNarrative.id);

        clustered++;
      } else {
        const narrativeKey = crypto.randomUUID();

        const { data: inserted } = await supabase
          .from("signal_narratives")
          .insert({
            narrative_key: narrativeKey,
            narrative_title: signal.translated_title || signal.title || "Emerging Narrative",
            narrative_type: signal.category || "emerging",
            canonical_countries: signal.affected_countries || [],
            signal_count: 1,
            first_signal_at: signalTime,
            last_signal_at: signalTime,
            escalation_score: escalationScore,
            metadata: {
              keywords,
              origin: "auto_cluster_v1",
              clustering_method: CLUSTERING_METHOD,
              epistemic_status: CLUSTERING_EPISTEMIC_STATUS,
              similarity_semantics: "lexical_keyword_overlap_not_causality",
              causal_inference: false,
              verification_status: "not_verified",
              match_threshold: MATCH_THRESHOLD,
            },
          })
          .select()
          .single();

        if (inserted) {
          await supabase.from("signal_narrative_members").insert({
            narrative_id: inserted.id,
            signal_id: signal.id,
            membership_strength: 100,
            narrative_role: "seed",
            matched_features: keywords,
          });

          created++;
        }
      }

      await supabase
        .from("global_signals")
        .update({
          narrative_clustered_at: new Date().toISOString(),
          last_pipeline_stage: "narrative_clustered",
        })
        .eq("id", signal.id);
    }

    await supabase.from("automation_logs").insert({
      job_name: "narrative-clustering",
      status: "success",
      message: `clustered=${clustered} created=${created} method=${CLUSTERING_METHOD} epistemic=${CLUSTERING_EPISTEMIC_STATUS}`,
    });

    return new Response(
      JSON.stringify({
        clustered,
        created,
        clustering_method: CLUSTERING_METHOD,
        epistemic_status: CLUSTERING_EPISTEMIC_STATUS,
        causal_inference: false,
        verification_status: "not_verified",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("automation_logs").insert({
      job_name: "narrative-clustering",
      status: "error",
      message: message.slice(0, 500) || "unknown",
    });

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});