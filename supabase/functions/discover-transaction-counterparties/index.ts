import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  buildCounterpartyQueries,
  normalizeDiscoveryHits,
  attachPublicBusinessContacts,
  COUNTERPARTY_DISCOVERY_VERSION,
} from "../_shared/counterparty-discovery-v1.mjs";

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hitArray(payload: any): any[] {
  const data = payload?.data ?? payload ?? {};
  const web = Array.isArray(data?.web) ? data.web : Array.isArray(payload?.web) ? payload.web : [];
  const results = Array.isArray(data?.data) ? data.data : Array.isArray(payload?.data) ? payload.data : [];
  return [...web, ...results];
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function searchFirecrawl(apiKey: string, query: string, limit: number) {
  const response = await fetch(FIRECRAWL_V2 + "/search", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit,
      sources: [{ type: "web" }],
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error("Firecrawl search failed with HTTP " + response.status);
  }

  const payload = await response.json();
  return hitArray(payload).map((hit: any) => ({
    url: hit?.url || hit?.link || "",
    title: hit?.title || hit?.name || "",
    description: hit?.description || hit?.snippet || "",
    markdown: hit?.markdown || hit?.content || "",
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  const apiKey = Deno.env.get("FIRECRAWL_API_KEY")?.trim();
  if (!apiKey) {
    return json({
      ok: false,
      code: "firecrawl_not_configured",
      message: "Counterparty discovery requires FIRECRAWL_API_KEY. No companies or contacts were invented.",
      candidates: [],
    }, 503);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const productName = String(body.product_name || "").trim();
    const role = String(body.role || "").trim().toLowerCase();
    const countries = Array.isArray(body.countries)
      ? body.countries.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 6)
      : [];
    const originCountry = String(body.origin_country || "").trim();
    const destinationCountry = String(body.destination_country || "").trim();
    const perQueryLimit = Math.min(Math.max(Number(body.per_query_limit ?? 5), 1), 8);
    const maxCandidates = Math.min(Math.max(Number(body.max_candidates ?? 12), 1), 30);

    if (!productName) return json({ ok: false, error: "product_name is required" }, 400);
    if (!["supplier", "buyer", "logistics"].includes(role)) {
      return json({ ok: false, error: "role must be supplier, buyer, or logistics" }, 400);
    }
    if (role !== "logistics" && countries.length === 0) {
      return json({ ok: false, error: "At least one country is required for supplier or buyer discovery" }, 400);
    }

    const input = {
      product_name: productName,
      role,
      countries,
      origin_country: originCountry,
      destination_country: destinationCountry,
    };
    const queries = buildCounterpartyQueries(input);
    if (queries.length === 0) return json({ ok: false, error: "No valid discovery queries could be constructed" }, 400);

    const rawHits: any[] = [];
    const queryResults: Array<{ query: string; hits: number }> = [];

    for (const query of queries) {
      try {
        const hits = await searchFirecrawl(apiKey, query, perQueryLimit);
        queryResults.push({ query, hits: hits.length });
        for (const hit of hits) rawHits.push({ ...hit, discovery_query: query });
      } catch (error) {
        queryResults.push({ query, hits: 0 });
        console.warn("counterparty query failed", { query, error: String(error) });
      }
    }

    const normalized = normalizeDiscoveryHits(rawHits, input).slice(0, maxCandidates);
    const rawByDomain = new Map<string, any>();
    for (const hit of rawHits) {
      try {
        const domain = new URL(hit.url).hostname.toLowerCase().replace(/^www\./, "");
        const existing = rawByDomain.get(domain);
        if (!existing || String(hit.markdown || "").length > String(existing.markdown || "").length) {
          rawByDomain.set(domain, hit);
        }
      } catch {
        // Ignore malformed URLs.
      }
    }

    const observedAt = new Date().toISOString();
    const candidates = [];

    for (const candidate of normalized) {
      const raw = rawByDomain.get(candidate.domain) || {};
      const withContacts = attachPublicBusinessContacts(candidate, raw.markdown || "");
      const digest = await sha256(JSON.stringify({
        url: candidate.discovery_url,
        title: candidate.title,
        description: candidate.description,
        query: raw.discovery_query || null,
        observed_at: observedAt,
      }));

      candidates.push({
        ...withContacts,
        evidence_refs: [{
          source_id: "firecrawl:" + candidate.domain,
          source_type: "open_web_discovery",
          source_url: candidate.discovery_url,
          query: raw.discovery_query || null,
          observed_at: observedAt,
          sha256: digest,
        }],
        verification_requirements: [
          "verify_legal_company_identity",
          "verify_official_website_or_registry_record",
          "complete_sanctions_and_compliance_screen",
          "obtain_current_attributable_quote",
          "verify_capacity_and_payment_terms",
        ],
      });
    }

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "discover_transaction_counterparties",
      result: candidates.length ? "discovery_candidates_returned" : "no_candidates",
      log_level: "info",
      metadata: {
        discovery_version: COUNTERPARTY_DISCOVERY_VERSION,
        product_name: productName,
        role,
        countries,
        queries_run: queries.length,
        raw_hits: rawHits.length,
        candidates: candidates.length,
        transaction_eligible_candidates: 0,
      },
    });

    return json({
      ok: true,
      discovery_version: COUNTERPARTY_DISCOVERY_VERSION,
      product_name: productName,
      role,
      countries,
      queries: queryResults,
      candidates,
      discovery_notice: "Open-web results are discovery candidates only. They are not verified companies, quotes, suppliers, buyers, or execution-ready counterparties until the listed verification requirements are satisfied.",
      transaction_eligible_candidates: 0,
    });
  } catch (error) {
    console.error("discover-transaction-counterparties failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Counterparty discovery failed",
      candidates: [],
    }, 500);
  }
});
