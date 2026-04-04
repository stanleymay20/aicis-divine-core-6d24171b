import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORIES = [
  "geopolitical","economic","financial_markets","central_banking",
  "public_health","climate_disaster","energy","technology",
  "cybersecurity","defense_conflict","legal_regulatory",
  "supply_chain","elections","social_unrest","infrastructure"
];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  geopolitical: ["sanctions","diplomacy","treaty","summit","UN","NATO","ambassador","territorial","sovereignty"],
  economic: ["GDP","recession","inflation","unemployment","trade deficit","stimulus","fiscal"],
  financial_markets: ["stock","market","S&P","Nasdaq","Dow","bonds","rally","crash","IPO","SEC"],
  central_banking: ["Fed","ECB","interest rate","monetary policy","central bank","rate hike","rate cut","quantitative"],
  public_health: ["WHO","pandemic","outbreak","vaccine","epidemic","disease","health emergency","COVID","bird flu"],
  climate_disaster: ["earthquake","hurricane","flood","wildfire","tsunami","drought","climate","storm","tornado"],
  energy: ["oil","gas","OPEC","pipeline","renewable","solar","nuclear","energy crisis","power grid"],
  technology: ["AI","artificial intelligence","tech","semiconductor","chip","cyber","quantum","data breach"],
  cybersecurity: ["hack","ransomware","breach","malware","cyber attack","phishing","vulnerability","zero-day"],
  defense_conflict: ["military","war","troops","missile","bombing","ceasefire","invasion","defense","conflict"],
  legal_regulatory: ["regulation","lawsuit","court","ruling","law","antitrust","compliance","GDPR","ban"],
  supply_chain: ["supply chain","shipping","port","logistics","shortage","tariff","import","export","trade"],
  elections: ["election","vote","ballot","candidate","polling","referendum","inauguration","campaign"],
  social_unrest: ["protest","riot","demonstration","strike","unrest","civil","march","activist"],
  infrastructure: ["bridge","dam","grid","telecom","internet","rail","airport","infrastructure","blackout"],
};

// Source suffix patterns to strip for better dedup
const SOURCE_SUFFIXES = [
  / - [A-Z][A-Za-z\s.]+$/,
  / \| [A-Z][A-Za-z\s.]+$/,
  / — [A-Z][A-Za-z\s.]+$/,
  /: Live [Uu]pdates?$/,
  / Live [Uu]pdates?$/,
];

function stripSourceSuffix(title: string): string {
  let cleaned = title;
  for (const pattern of SOURCE_SUFFIXES) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.trim();
}

function normalizeForDedup(title: string): string {
  return stripSourceSuffix(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeDedup(title: string, source: string): string {
  const normalized = normalizeForDedup(title);
  const words = normalized.split(' ').slice(0, 8).join(' ');
  return `${words}::${source}`;
}

// Jaccard similarity for semantic dedup
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeForDedup(a).split(' '));
  const setB = new Set(normalizeForDedup(b).split(' '));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function classifyCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  let best = "geopolitical";
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter(k => text.includes(k.toLowerCase())).length;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

function getTrustTier(weight: number): string {
  if (weight >= 85) return "tier_1";
  if (weight >= 60) return "tier_2";
  return "tier_3";
}

// Fetch GDELT articles as a secondary source
async function fetchGdeltArticles(): Promise<any[]> {
  const queries = ["conflict", "economic crisis", "health emergency", "cybersecurity", "climate disaster"];
  const articles: any[] = [];
  
  for (const query of queries) {
    try {
      const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=10&timespan=1h`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.articles) {
          articles.push(...data.articles.map((a: any) => ({
            title: a.title || "",
            description: a.seendate ? `GDELT event detected: ${a.title}` : a.title,
            url: a.url || "",
            source: { name: a.domain || "GDELT" },
            publishedAt: a.seendate ? new Date(
              a.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')
            ).toISOString() : new Date().toISOString(),
            _ingestionSource: "gdelt",
          })));
        }
      }
    } catch (e) {
      console.error(`GDELT ${query} error:`, e);
    }
  }
  return articles;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const NEWSAPI_KEY = Deno.env.get("NEWSAPI_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!NEWSAPI_KEY) throw new Error("NEWSAPI_KEY not configured");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Load source trust scores
    const { data: trustData } = await supabase
      .from("source_trust_scores")
      .select("source_name, credibility_weight, source_type, verification_level");
    
    const trustMap: Record<string, { weight: number; type: string; level: string }> = {};
    for (const t of (trustData || [])) {
      trustMap[t.source_name.toLowerCase()] = {
        weight: t.credibility_weight,
        type: t.source_type,
        level: t.verification_level,
      };
    }

    // Step 1: Fetch from NewsAPI
    const categories = ["general", "business", "health", "science", "technology"];
    const allArticles: any[] = [];

    for (const cat of categories) {
      try {
        const url = `https://newsapi.org/v2/top-headlines?category=${cat}&language=en&pageSize=10&apiKey=${NEWSAPI_KEY}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.articles) {
            allArticles.push(...data.articles.map((a: any) => ({ ...a, _ingestionSource: "newsapi" })));
          }
        }
      } catch (e) {
        console.error(`NewsAPI ${cat} error:`, e);
      }
    }

    // Step 1b: Fetch from GDELT
    const gdeltArticles = await fetchGdeltArticles();
    allArticles.push(...gdeltArticles);

    console.log(`Fetched ${allArticles.length} raw articles (NewsAPI + GDELT)`);

    // Step 2: Filter junk
    const validArticles = allArticles.filter(a =>
      a.title && a.title !== "[Removed]" &&
      a.description && a.description !== "[Removed]" &&
      a.url
    );

    // Step 3: Enhanced dedup — exact key + semantic similarity
    const seen = new Set<string>();
    const keptArticles: any[] = [];
    
    for (const a of validArticles) {
      const key = computeDedup(a.title, a.source?.name || "unknown");
      if (seen.has(key)) continue;
      
      // Check semantic similarity against already-kept articles
      let isDuplicate = false;
      for (const kept of keptArticles) {
        if (jaccardSimilarity(a.title, kept.title) > 0.6) {
          // Near-duplicate: merge source into existing
          if (!kept._mergedSources) kept._mergedSources = [];
          kept._mergedSources.push({
            url: a.url,
            name: a.source?.name,
            published: a.publishedAt,
          });
          isDuplicate = true;
          break;
        }
      }
      
      if (!isDuplicate) {
        seen.add(key);
        keptArticles.push(a);
      }
    }

    // Check existing dedup keys in DB
    const dedupKeys = keptArticles.map(a => computeDedup(a.title, a.source?.name || "unknown"));
    const { data: existing } = await supabase
      .from("global_signals")
      .select("dedup_key, id, title, source_count, source_references")
      .in("dedup_key", dedupKeys);
    
    const existingKeyMap = new Map<string, any>();
    for (const r of (existing || [])) {
      existingKeyMap.set(r.dedup_key, r);
    }

    // Also check semantic similarity against recent DB signals
    const { data: recentSignals } = await supabase
      .from("global_signals")
      .select("id, title, source_count, source_references")
      .order("first_detected_at", { ascending: false })
      .limit(50);

    const newArticles: any[] = [];
    const updatedSignals: { id: string; source_count: number; source_references: any[]; multi_source_confirmed: boolean }[] = [];

    for (const a of keptArticles) {
      const key = computeDedup(a.title, a.source?.name || "unknown");
      
      // Exact dedup key match
      if (existingKeyMap.has(key)) continue;

      // Semantic match against recent DB signals
      let matchedExisting = false;
      for (const recent of (recentSignals || [])) {
        if (jaccardSimilarity(a.title, recent.title) > 0.6) {
          // Update existing signal's source count
          const newRefs = [...(recent.source_references || []), {
            url: a.url, name: a.source?.name, published: a.publishedAt,
          }];
          const newCount = (recent.source_count || 1) + 1;
          updatedSignals.push({
            id: recent.id,
            source_count: newCount,
            source_references: newRefs,
            multi_source_confirmed: newCount >= 3,
          });
          matchedExisting = true;
          break;
        }
      }

      if (!matchedExisting) {
        newArticles.push(a);
      }
    }

    // Update existing signals with new source confirmations
    for (const upd of updatedSignals) {
      await supabase.from("global_signals").update({
        source_count: upd.source_count,
        source_references: upd.source_references as any,
        multi_source_confirmed: upd.multi_source_confirmed,
      }).eq("id", upd.id);
    }

    console.log(`${newArticles.length} new, ${updatedSignals.length} updated with multi-source`);

    if (newArticles.length === 0) {
      return new Response(JSON.stringify({
        ok: true, new_signals: 0, updated_signals: updatedSignals.length,
        message: "No new signals, updated existing",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 4: AI classification
    const topArticles = newArticles.slice(0, 15);
    const articlesSummary = topArticles.map((a, i) =>
      `[${i}] "${a.title}" — ${a.description || "No description"} (Source: ${a.source?.name || "Unknown"})`
    ).join("\n");

    const classifyStart = Date.now();
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are AICIS, a global intelligence classification engine. For each news article, produce a JSON array of objects. Each object must have:
- index: article index number
- category: one of ${CATEGORIES.join(", ")}
- confidence_score: 0-100 how confident you are in category classification
- impact_score: 0-100 estimated global significance (80+ = major world event, 60-79 = significant, 40-59 = moderate, below 40 = minor)
- urgency_score: 0-100 how time-sensitive this is
- affected_regions: array of region names
- affected_countries: array of ISO3 country codes
- affected_sectors: array of sectors affected
- strategic_implications: one sentence on why this matters strategically
- likely_consequences: one sentence on probable outcomes
- recommended_actions: object with keys "government", "media", "business", "public" each being a short recommended action
- misinformation_risk: 0-100
- impact_reasoning: 2-3 sentences explaining why the impact score was assigned, who is affected, over what time horizon, and what could worsen or reduce the impact.

Only return the JSON array, no markdown.`
          },
          { role: "user", content: `Classify these articles:\n${articlesSummary}` }
        ],
      }),
    });

    let classifications: any[] = [];
    const classificationTimeMs = Date.now() - classifyStart;

    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || "";
      try {
        const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        classifications = JSON.parse(cleaned);
      } catch (e) {
        console.error("AI parse error:", e, "Content:", content.slice(0, 500));
      }
    } else {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
    }

    // Step 5: Build signal objects with trust scoring
    const signals: any[] = [];
    for (let i = 0; i < topArticles.length; i++) {
      const article = topArticles[i];
      const cls = classifications.find((c: any) => c.index === i) || {};
      const sourceName = article.source?.name || "Unknown";
      const trustInfo = trustMap[sourceName.toLowerCase()];
      const trustWeight = trustInfo?.weight ?? 50;
      const trustTier = getTrustTier(trustWeight);

      // Adjust impact score based on source trust
      let rawImpact = cls.impact_score || 40;
      if (trustWeight >= 85) rawImpact = Math.min(100, rawImpact + 5);
      else if (trustWeight < 50) rawImpact = Math.max(0, rawImpact - 10);

      const category = CATEGORIES.includes(cls.category) ? cls.category : classifyCategory(article.title, article.description || "");
      const dedupKey = computeDedup(article.title, sourceName);

      // Evidence hash
      const encoder = new TextEncoder();
      const hashData = encoder.encode(`${article.title}|${article.url}|${article.publishedAt}`);
      const hashBuffer = await crypto.subtle.digest("SHA-256", hashData);
      const evidenceHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      // Merged sources from semantic dedup
      const mergedSources = article._mergedSources || [];
      const allSourceRefs = [
        { url: article.url, name: sourceName, published: article.publishedAt },
        ...mergedSources,
      ];
      const sourceCount = allSourceRefs.length;

      signals.push({
        title: article.title,
        summary: article.description || article.title,
        normalized_summary: cls.strategic_implications || article.description || article.title,
        category,
        status: "new",
        confidence_score: Math.min(100, Math.max(0, cls.confidence_score || 50)),
        impact_score: Math.min(100, Math.max(0, rawImpact)),
        urgency_score: Math.min(100, Math.max(0, cls.urgency_score || 40)),
        source_count: sourceCount,
        primary_source: sourceName,
        source_references: allSourceRefs,
        first_detected_at: article.publishedAt || new Date().toISOString(),
        latest_update_at: new Date().toISOString(),
        occurred_at: article.publishedAt || null,
        affected_regions: cls.affected_regions || [],
        affected_countries: cls.affected_countries || [],
        affected_sectors: cls.affected_sectors || [],
        affected_stakeholders: [],
        strategic_implications: cls.strategic_implications || null,
        likely_consequences: cls.likely_consequences || null,
        misinformation_risk: cls.misinformation_risk || 0,
        recommended_actions: cls.recommended_actions || {},
        audience_framing: cls.recommended_actions || {},
        impact_reasoning: cls.impact_reasoning || cls.strategic_implications || null,
        evidence_hash: evidenceHash,
        model_version: "gemini-3-flash-preview",
        classification_time_ms: classificationTimeMs,
        ingestion_source: article._ingestionSource || "newsapi",
        dedup_key: dedupKey,
        source_trust_tier: trustTier,
        multi_source_confirmed: sourceCount >= 3,
        related_signal_ids: [],
      });
    }

    // Step 6: Insert
    const { data: inserted, error: insertErr } = await supabase
      .from("global_signals")
      .insert(signals)
      .select("id, title, impact_score, category");

    if (insertErr) {
      console.error("Insert error:", insertErr);
      throw new Error(`Insert failed: ${insertErr.message}`);
    }

    console.log(`Inserted ${inserted?.length || 0} signals`);

    // Step 7: Route high-impact signals to decisions
    const highImpact = (inserted || []).filter((s: any) => s.impact_score >= 70);
    let decisionsCreated = 0;

    for (const signal of highImpact) {
      await supabase.from("decision_outcome_log").insert({
        signal_title: `[SIGNAL] ${signal.title}`,
        signal_id: signal.id,
        signal_date: new Date().toISOString().split("T")[0],
        domain: signal.category === "public_health" ? "health" :
                signal.category === "defense_conflict" ? "security" :
                signal.category === "economic" || signal.category === "financial_markets" ? "economy" :
                signal.category === "energy" ? "energy" :
                signal.category === "climate_disaster" ? "food" :
                "governance",
        action_taken: false,
        evidence_type: "hypothetical",
      });
      decisionsCreated++;
    }

    // Step 8: Audit log
    await supabase.from("audit_log").insert({
      action: "global_signal_ingestion",
      resource_type: "global_signals",
      severity: "info",
      metadata: {
        articles_fetched: allArticles.length,
        unique_after_dedup: newArticles.length,
        signals_created: inserted?.length || 0,
        signals_updated: updatedSignals.length,
        decisions_routed: decisionsCreated,
        classification_time_ms: classificationTimeMs,
        model: "gemini-3-flash-preview",
        sources: { newsapi: allArticles.filter(a => a._ingestionSource === "newsapi").length, gdelt: gdeltArticles.length },
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      new_signals: inserted?.length || 0,
      updated_signals: updatedSignals.length,
      high_impact_routed: decisionsCreated,
      classification_time_ms: classificationTimeMs,
      sources: { newsapi: allArticles.length - gdeltArticles.length, gdelt: gdeltArticles.length },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Ingestion error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
