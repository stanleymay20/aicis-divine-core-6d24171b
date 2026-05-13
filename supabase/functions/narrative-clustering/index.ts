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

function normalize(text?: string | null) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(signal: any): string[] {
  const text = normalize([
    signal.translated_title,
    signal.title,
    signal.category,
    ...(signal.affected_countries || []),
  ].join(" "));

  const words = text
    .split(" ")
    .filter((w: string) => w.length >= 4)
    .filter((w: string) => !STOPWORDS.has(w));

  return [...new Set(words)].slice(0, 12);
}

function similarity(a: string[], b: string[]) {
  const sa = new Set(a);
  const sb = new Set(b);
  const overlap = [...sa].filter((x) => sb.has(x)).length;
  return overlap / Math.max(sa.size, sb.size, 1);
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
    const { data: signals, error } = await supabase
      .from("global_signals")
      .select("id,title,translated_title,category,affected_countries,urgency_score,impact_score,created_at")
      .is("narrative_clustered_at", null)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) throw error;

    const { data: narratives } = await supabase
      .from("signal_narratives")
      .select("id,narrative_title,canonical_countries,canonical_sectors,metadata,signal_count");

    let clustered = 0;
    let created = 0;

    for (const signal of signals || []) {
      const keywords = extractKeywords(signal);

      let bestNarrative: any = null;
      let bestScore = 0;

      for (const n of narratives || []) {
        const existingKeywords = (n.metadata?.keywords || []) as string[];
        const score = similarity(keywords, existingKeywords);

        if (score > bestScore) {
          bestScore = score;
          bestNarrative = n;
        }
      }

      if (bestNarrative && bestScore >= 0.35) {
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
            last_signal_at: new Date().toISOString(),
            escalation_score: Math.max(
              signal.urgency_score || 0,
              signal.impact_score || 0
            ),
          })
          .eq("id", bestNarrative.id);

        clustered++;
      } else {
        const narrativeKey = crypto.randomUUID();

        const { data: inserted } = await supabase
          .from("signal_narratives")
          .insert({
            narrative_key: narrativeKey,
            narrative_title:
              signal.translated_title || signal.title || "Emerging Narrative",
            narrative_type: signal.category || "emerging",
            canonical_countries: signal.affected_countries || [],
            signal_count: 1,
            first_signal_at: new Date().toISOString(),
            last_signal_at: new Date().toISOString(),
            escalation_score: Math.max(
              signal.urgency_score || 0,
              signal.impact_score || 0
            ),
            metadata: {
              keywords,
              origin: "auto_cluster_v1",
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
      message: `clustered=${clustered} created=${created}`,
    });

    return new Response(
      JSON.stringify({ clustered, created }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (e: any) {
    await supabase.from("automation_logs").insert({
      job_name: "narrative-clustering",
      status: "error",
      message: e.message?.slice(0, 500) || "unknown",
    });

    return new Response(
      JSON.stringify({ error: e.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});