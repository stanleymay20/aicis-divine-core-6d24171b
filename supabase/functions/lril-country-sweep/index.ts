/**
 * lril-country-sweep — fills planetary coverage gaps.
 *
 * Strategy:
 *   - Identify countries with < N events in the last 14 days
 *   - For each, run a GDELT query targeted at LOCATION (not source country)
 *     using country-name + broad-incident terms
 *   - Cycles through 20 countries per run; full sweep covers all ~190 in <24h
 *
 * GDELT's `sourcelang` and `sourcecountry` only reflect the publisher.
 * To find news ABOUT a country, we use the country name in the query body
 * combined with incident keywords. This catches small countries that
 * publisher-country queries miss entirely.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FN = "lril-country-sweep";
const COUNTRIES_PER_RUN = 20;
const BATCH_SIZE = 4;

// ISO3 → list of search-name variants (handles common naming, e.g. DRC vs Congo)
const COUNTRY_NAMES: Record<string, string[]> = {
  AFG: ["Afghanistan"], ALB: ["Albania"], DZA: ["Algeria"], AND: ["Andorra"],
  AGO: ["Angola"], ATG: ["Antigua"], ARG: ["Argentina"], ARM: ["Armenia"],
  AUS: ["Australia"], AUT: ["Austria"], AZE: ["Azerbaijan"], BHS: ["Bahamas"],
  BHR: ["Bahrain"], BGD: ["Bangladesh"], BRB: ["Barbados"], BLR: ["Belarus"],
  BEL: ["Belgium"], BLZ: ["Belize"], BEN: ["Benin"], BTN: ["Bhutan"],
  BOL: ["Bolivia"], BIH: ["Bosnia"], BWA: ["Botswana"], BRA: ["Brazil"],
  BRN: ["Brunei"], BGR: ["Bulgaria"], BFA: ["Burkina Faso"], BDI: ["Burundi"],
  KHM: ["Cambodia"], CMR: ["Cameroon"], CAN: ["Canada"], CPV: ["Cape Verde", "Cabo Verde"],
  CAF: ["Central African Republic", "CAR"], TCD: ["Chad"], CHL: ["Chile"],
  CHN: ["China"], COL: ["Colombia"], COM: ["Comoros"],
  COD: ["DR Congo", "Democratic Republic of Congo", "DRC"], COG: ["Republic of Congo", "Congo-Brazzaville"],
  CRI: ["Costa Rica"], CIV: ["Ivory Coast", "Cote d'Ivoire"], HRV: ["Croatia"],
  CUB: ["Cuba"], CYP: ["Cyprus"], CZE: ["Czech Republic", "Czechia"], DNK: ["Denmark"],
  DJI: ["Djibouti"], DMA: ["Dominica"], DOM: ["Dominican Republic"], ECU: ["Ecuador"],
  EGY: ["Egypt"], SLV: ["El Salvador"], GNQ: ["Equatorial Guinea"], ERI: ["Eritrea"],
  EST: ["Estonia"], SWZ: ["Eswatini", "Swaziland"], ETH: ["Ethiopia"], FJI: ["Fiji"],
  FIN: ["Finland"], FRA: ["France"], GAB: ["Gabon"], GMB: ["Gambia"],
  GEO: ["Georgia (country)"], DEU: ["Germany"], GHA: ["Ghana"], GRC: ["Greece"],
  GRD: ["Grenada"], GTM: ["Guatemala"], GIN: ["Guinea"], GNB: ["Guinea-Bissau"],
  GUY: ["Guyana"], HTI: ["Haiti"], HND: ["Honduras"], HUN: ["Hungary"],
  ISL: ["Iceland"], IND: ["India"], IDN: ["Indonesia"], IRN: ["Iran"],
  IRQ: ["Iraq"], IRL: ["Ireland"], ISR: ["Israel"], ITA: ["Italy"],
  JAM: ["Jamaica"], JPN: ["Japan"], JOR: ["Jordan"], KAZ: ["Kazakhstan"],
  KEN: ["Kenya"], KIR: ["Kiribati"], PRK: ["North Korea"], KOR: ["South Korea"],
  KWT: ["Kuwait"], KGZ: ["Kyrgyzstan"], LAO: ["Laos"], LVA: ["Latvia"],
  LBN: ["Lebanon"], LSO: ["Lesotho"], LBR: ["Liberia"], LBY: ["Libya"],
  LIE: ["Liechtenstein"], LTU: ["Lithuania"], LUX: ["Luxembourg"], MDG: ["Madagascar"],
  MWI: ["Malawi"], MYS: ["Malaysia"], MDV: ["Maldives"], MLI: ["Mali"],
  MLT: ["Malta"], MHL: ["Marshall Islands"], MRT: ["Mauritania"], MUS: ["Mauritius"],
  MEX: ["Mexico"], FSM: ["Micronesia"], MDA: ["Moldova"], MCO: ["Monaco"],
  MNG: ["Mongolia"], MNE: ["Montenegro"], MAR: ["Morocco"], MOZ: ["Mozambique"],
  MMR: ["Myanmar", "Burma"], NAM: ["Namibia"], NRU: ["Nauru"], NPL: ["Nepal"],
  NLD: ["Netherlands"], NZL: ["New Zealand"], NIC: ["Nicaragua"], NER: ["Niger"],
  NGA: ["Nigeria"], MKD: ["North Macedonia"], NOR: ["Norway"], OMN: ["Oman"],
  PAK: ["Pakistan"], PLW: ["Palau"], PSE: ["Palestine"], PAN: ["Panama"],
  PNG: ["Papua New Guinea"], PRY: ["Paraguay"], PER: ["Peru"], PHL: ["Philippines"],
  POL: ["Poland"], PRT: ["Portugal"], QAT: ["Qatar"], ROU: ["Romania"],
  RUS: ["Russia"], RWA: ["Rwanda"], KNA: ["Saint Kitts"], LCA: ["Saint Lucia"],
  VCT: ["Saint Vincent"], WSM: ["Samoa"], SMR: ["San Marino"], STP: ["Sao Tome"],
  SAU: ["Saudi Arabia"], SEN: ["Senegal"], SRB: ["Serbia"], SYC: ["Seychelles"],
  SLE: ["Sierra Leone"], SGP: ["Singapore"], SVK: ["Slovakia"], SVN: ["Slovenia"],
  SLB: ["Solomon Islands"], SOM: ["Somalia"], ZAF: ["South Africa"], SSD: ["South Sudan"],
  ESP: ["Spain"], LKA: ["Sri Lanka"], SDN: ["Sudan"], SUR: ["Suriname"],
  SWE: ["Sweden"], CHE: ["Switzerland"], SYR: ["Syria"], TWN: ["Taiwan"],
  TJK: ["Tajikistan"], TZA: ["Tanzania"], THA: ["Thailand"], TLS: ["Timor-Leste", "East Timor"],
  TGO: ["Togo"], TON: ["Tonga"], TTO: ["Trinidad"], TUN: ["Tunisia"],
  TUR: ["Turkey", "Turkiye"], TKM: ["Turkmenistan"], TUV: ["Tuvalu"], UGA: ["Uganda"],
  UKR: ["Ukraine"], ARE: ["UAE", "United Arab Emirates"], GBR: ["United Kingdom", "Britain"],
  USA: ["United States", "America"], URY: ["Uruguay"], UZB: ["Uzbekistan"],
  VUT: ["Vanuatu"], VEN: ["Venezuela"], VNM: ["Vietnam"], YEM: ["Yemen"],
  ZMB: ["Zambia"], ZWE: ["Zimbabwe"], XKX: ["Kosovo"], HKG: ["Hong Kong"],
  MAC: ["Macau"], GRL: ["Greenland"], BMU: ["Bermuda"], FRO: ["Faroe Islands"],
};

// Broad incident terms — single query catches most categories per country
const INCIDENT_TERMS = '(killed OR dead OR injured OR attack OR explosion OR clash OR protest OR riot OR flood OR fire OR earthquake OR outbreak OR shutdown OR collapse OR strike OR coup OR shooting OR kidnapped OR shortage OR blackout OR crisis OR emergency)';

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

function parseGDELTDate(s: string): string | null {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

async function pullCountryQuery(iso3: string, name: string): Promise<any[]> {
  const q = `"${name}" ${INCIDENT_TERMS}`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=25&format=json&sort=DateDesc&timespan=48h`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const text = await r.text();
    if (!text.trim().startsWith("{")) return [];
    const j = JSON.parse(text);
    const articles = (j.articles || []) as any[];
    return articles.map((a) => ({
      source_type: "aggregator",
      source_name: a.domain || "gdelt",
      source_reliability: 0.6,
      raw_text: a.title || "",
      raw_payload: { ...a, _swept_for: iso3, _swept_name: name },
      language: (a.language || "en").toLowerCase().slice(0, 2),
      url: a.url || null,
      published_at: a.seendate ? parseGDELTDate(a.seendate) : null,
      // Override publisher country with the one we swept for — this article
      // is *about* that country (we searched for its name)
      country_hint: iso3,
      region_hint: name,
      dedup_key: `gdelt_sweep_${iso3}_${hash(a.url || a.title || crypto.randomUUID())}`,
    }));
  } catch (_) {
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();

  // Pick countries with fewest recent events (covers underrepresented first)
  const { data: counts } = await supabase
    .from("aicis_local_events")
    .select("iso3_normalized")
    .gte("start_time", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString());

  const eventCount = new Map<string, number>();
  for (const r of (counts || [])) {
    const k = (r as any).iso3_normalized;
    if (k) eventCount.set(k, (eventCount.get(k) || 0) + 1);
  }

  // Score each ISO3: lower count = higher priority. Random tie-break.
  const allIso3 = Object.keys(COUNTRY_NAMES);
  const ranked = allIso3
    .map(iso => ({ iso, count: eventCount.get(iso) || 0, jitter: Math.random() }))
    .sort((a, b) => (a.count - b.count) || (a.jitter - b.jitter))
    .slice(0, COUNTRIES_PER_RUN);

  const all: any[] = [];
  const targets: string[] = [];

  // Run in parallel batches
  for (let i = 0; i < ranked.length; i += BATCH_SIZE) {
    const batch = ranked.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ iso }) => {
        const names = COUNTRY_NAMES[iso] || [];
        const out: any[] = [];
        for (const n of names) {
          const r = await pullCountryQuery(iso, n);
          out.push(...r);
          if (r.length > 0) break; // first variant that returns is enough
        }
        targets.push(`${iso}:${out.length}`);
        return out;
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
    }
    await new Promise(r => setTimeout(r, 600));
  }

  let inserted = 0;
  if (all.length > 0) {
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500);
      const { data, error } = await supabase
        .from("aicis_raw_local_signals")
        .upsert(chunk, { onConflict: "dedup_key", ignoreDuplicates: true })
        .select("id");
      if (error) { console.error("insert", error.message); break; }
      inserted += data?.length || 0;
    }
  }

  await supabase.from("automation_logs").insert({
    job_name: FN,
    status: "success",
    message: `Swept ${ranked.length} countries, ${all.length} signals, ${inserted} new. Targets: ${targets.join(",")} (${Date.now() - start}ms)`,
  });

  return new Response(JSON.stringify({
    ok: true,
    countries_swept: ranked.length,
    sourced: all.length,
    inserted,
    targets,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
