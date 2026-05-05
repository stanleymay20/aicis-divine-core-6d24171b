// coverage-equity-enforcer
// Phase 3 — Coverage Equity.
//
// Daily job:
//   - Counts canonical signals per ISO3 over the last 7 days.
//   - Identifies bottom-50 + every UN-recognized country below the floor (3/wk).
//   - For each country below floor, generates a small set of targeted
//     local-language search queries and upserts them into web_search_sweep_queries
//     (auto_generated=true, expires_at=now+3d) so the existing web-search-sweep
//     job picks them up on its next run.
//   - Logs gap rows into coverage_equity_log.
//
// Idempotent — uses (query, language, country_iso3) as the dedup tuple.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FLOOR_PER_WEEK = 3;
const BOTTOM_N = 50;

// Light language hint per ISO3 — enough to seed targeted local queries without
// hard-coding 211 mappings. Defaults to English when unknown (most countries
// publish at least some English wire content).
const LANG_HINT: Record<string, string[]> = {
  ARG: ["es"], BOL: ["es"], CHL: ["es"], COL: ["es"], CRI: ["es"], CUB: ["es"], DOM: ["es"], ECU: ["es"], SLV: ["es"], GTM: ["es"], HND: ["es"], MEX: ["es"], NIC: ["es"], PAN: ["es"], PRY: ["es"], PER: ["es"], URY: ["es"], VEN: ["es"], ESP: ["es"],
  BRA: ["pt"], PRT: ["pt"], AGO: ["pt"], MOZ: ["pt"], CPV: ["pt"], GNB: ["pt"], STP: ["pt"], TLS: ["pt"],
  FRA: ["fr"], BEL: ["fr"], LUX: ["fr"], MCO: ["fr"], CHE: ["fr", "de", "it"], CIV: ["fr"], SEN: ["fr"], MLI: ["fr"], BFA: ["fr"], NER: ["fr"], TCD: ["fr"], CMR: ["fr"], GAB: ["fr"], COG: ["fr"], COD: ["fr"], MDG: ["fr"], BEN: ["fr"], TGO: ["fr"], DJI: ["fr"], BDI: ["fr"], RWA: ["fr"], GIN: ["fr"], CAF: ["fr"], HTI: ["fr"],
  DEU: ["de"], AUT: ["de"],
  ITA: ["it"], SMR: ["it"],
  RUS: ["ru"], BLR: ["ru"], KAZ: ["ru"], KGZ: ["ru"], TJK: ["ru"], UZB: ["ru"], TKM: ["ru"], ARM: ["ru"], AZE: ["ru"],
  CHN: ["zh"], TWN: ["zh"], HKG: ["zh"], SGP: ["zh"],
  JPN: ["ja"],
  KOR: ["ko"], PRK: ["ko"],
  IDN: ["id"], MYS: ["id"],
  THA: ["th"],
  VNM: ["vi"],
  IND: ["hi"], NPL: ["hi"],
  PAK: ["ur"], BGD: ["bn"], LKA: ["ta"],
  IRN: ["fa"], AFG: ["fa"],
  SAU: ["ar"], EGY: ["ar"], DZA: ["ar"], MAR: ["ar"], TUN: ["ar"], LBY: ["ar"], SDN: ["ar"], YEM: ["ar"], SYR: ["ar"], IRQ: ["ar"], JOR: ["ar"], LBN: ["ar"], OMN: ["ar"], QAT: ["ar"], KWT: ["ar"], BHR: ["ar"], ARE: ["ar"], PSE: ["ar"], MRT: ["ar"], SOM: ["ar"], COM: ["ar"], ISR: ["he"],
  TUR: ["tr"],
  TZA: ["sw"], KEN: ["sw"], UGA: ["sw"],
  ETH: ["en"], NGA: ["en"], GHA: ["en"], ZAF: ["en"], ZWE: ["en"], ZMB: ["en"], MWI: ["en"], NAM: ["en"], BWA: ["en"], LSO: ["en"], SWZ: ["en"], SLE: ["en"], LBR: ["en"], GMB: ["en"],
};

const QUERY_TEMPLATES_EN = [
  "{country} breaking news",
  "{country} protest OR violence OR election",
  "{country} flood OR drought OR earthquake OR fire",
  "{country} economy OR inflation OR shortage",
];
const QUERY_TEMPLATES_LANG: Record<string, string[]> = {
  es: ["últimas noticias {country}", "{country} crisis OR protesta OR elecciones"],
  pt: ["últimas notícias {country}", "{country} crise OR protesto OR eleições"],
  fr: ["dernières nouvelles {country}", "{country} crise OR manifestation OR élections"],
  de: ["aktuelle Nachrichten {country}", "{country} Krise OR Protest OR Wahlen"],
  it: ["ultime notizie {country}", "{country} crisi OR protesta OR elezioni"],
  ru: ["последние новости {country}", "{country} кризис OR протесты OR выборы"],
  zh: ["{country} 最新新闻", "{country} 抗议 OR 危机 OR 选举"],
  ja: ["{country} 最新ニュース", "{country} 抗議 OR 危機 OR 選挙"],
  ko: ["{country} 최신 뉴스", "{country} 시위 OR 위기 OR 선거"],
  id: ["berita terbaru {country}", "{country} krisis OR demonstrasi OR pemilu"],
  th: ["ข่าวล่าสุด {country}", "{country} วิกฤต OR ประท้วง OR เลือกตั้ง"],
  vi: ["tin tức mới nhất {country}", "{country} khủng hoảng OR biểu tình OR bầu cử"],
  hi: ["{country} ताजा खबर", "{country} संकट OR विरोध OR चुनाव"],
  ar: ["آخر أخبار {country}", "{country} أزمة OR احتجاج OR انتخابات"],
  he: ["חדשות אחרונות {country}", "{country} משבר OR מחאה OR בחירות"],
  fa: ["آخرین اخبار {country}", "{country} بحران OR اعتراض OR انتخابات"],
  tr: ["{country} son dakika haberleri", "{country} kriz OR protesto OR seçim"],
  sw: ["habari za hivi punde {country}", "{country} mgogoro OR maandamano OR uchaguzi"],
  ur: ["{country} تازہ خبریں", "{country} بحران OR احتجاج OR انتخابات"],
  bn: ["{country} সর্বশেষ খবর", "{country} সংকট OR প্রতিবাদ OR নির্বাচন"],
  ta: ["{country} சமீபத்திய செய்திகள்", "{country} நெருக்கடி OR போராட்டம் OR தேர்தல்"],
};

function buildQueries(country: string, iso3: string): { query: string; language: string }[] {
  const langs = LANG_HINT[iso3] || ["en"];
  const out: { query: string; language: string }[] = [];
  // always include 1 English query for cross-source coverage
  out.push({ query: `${country} breaking news`, language: "en" });
  for (const lang of langs) {
    const tpls = lang === "en" ? QUERY_TEMPLATES_EN.slice(0, 2) : (QUERY_TEMPLATES_LANG[lang] || []);
    for (const t of tpls) out.push({ query: t.replaceAll("{country}", country), language: lang });
  }
  // dedup
  const seen = new Set<string>();
  return out.filter(q => {
    const k = `${q.language}::${q.query}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    // 1. Per-country signal counts last 7d
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: rows, error } = await supa
      .from("global_signals")
      .select("affected_countries")
      .gte("first_detected_at", since)
      .eq("canonical_event_status", "canonical")
      .limit(50000);
    if (error) throw error;

    const counts = new Map<string, number>();
    for (const r of rows || []) {
      for (const iso of (r.affected_countries || []) as string[]) {
        counts.set(iso, (counts.get(iso) || 0) + 1);
      }
    }

    // 2. Pull canonical country list (UN-recognized) — use admin_regions admin_level=0
    const { data: admin0, error: a0Err } = await supa
      .from("admin_regions")
      .select("country_iso3,name")
      .eq("admin_level", 0)
      .limit(500);
    if (a0Err) throw a0Err;

    const countryList = (admin0 || [])
      .filter((r: any) => r.country_iso3)
      .map((r: any) => ({ iso3: r.country_iso3 as string, name: (r.name as string) || (r.country_iso3 as string) }));

    // 3. Identify gaps
    const gaps = countryList
      .map(c => ({ ...c, count: counts.get(c.iso3) || 0 }))
      .filter(c => c.count < FLOOR_PER_WEEK)
      .sort((a, b) => a.count - b.count)
      .slice(0, BOTTOM_N);

    // 4. Generate + upsert sweep queries; log
    let totalQueries = 0;
    const expiresAt = new Date(Date.now() + 3 * 86400_000).toISOString();
    const logRows: any[] = [];

    for (const g of gaps) {
      const qs = buildQueries(g.name, g.iso3);
      for (const q of qs) {
        // Idempotent insert: check existing active auto query for same tuple
        const { data: existing } = await supa
          .from("web_search_sweep_queries")
          .select("id")
          .eq("query", q.query)
          .eq("language", q.language)
          .eq("country_iso3", g.iso3)
          .eq("auto_generated", true)
          .limit(1);

        if (existing && existing.length > 0) {
          await supa.from("web_search_sweep_queries")
            .update({ enabled: true, expires_at: expiresAt })
            .eq("id", (existing[0] as any).id);
        } else {
          await supa.from("web_search_sweep_queries").insert({
            query: q.query,
            category: "geopolitical",
            language: q.language,
            country_iso3: g.iso3,
            auto_generated: true,
            enabled: true,
            priority: 5,
            time_filter: "qdr:d",
            result_limit: 6,
            expires_at: expiresAt,
          });
          totalQueries++;
        }
      }
      logRows.push({
        country_iso3: g.iso3,
        country_name: g.name,
        signals_7d: g.count,
        floor: FLOOR_PER_WEEK,
        gap: FLOOR_PER_WEEK - g.count,
        language_codes: LANG_HINT[g.iso3] || ["en"],
        queries_generated: qs.length,
        status: "sweep_triggered",
      });
    }

    if (logRows.length > 0) {
      const { error: logErr } = await supa.from("coverage_equity_log").insert(logRows);
      if (logErr) throw logErr;
    }

    await supa.from("automation_logs").insert({
      job_name: "coverage-equity-enforcer",
      status: "success",
      message: `gaps=${gaps.length} new_queries=${totalQueries} countries_total=${countryList.length} in ${Date.now() - startedAt}ms`,
    });

    return new Response(JSON.stringify({
      countries_evaluated: countryList.length,
      gaps: gaps.length,
      new_queries: totalQueries,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("coverage-equity-enforcer error:", msg);
    await supa.from("automation_logs").insert({
      job_name: "coverage-equity-enforcer", status: "error", message: msg.slice(0, 500),
    });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
