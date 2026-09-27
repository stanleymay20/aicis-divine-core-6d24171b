import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  ECB_DAILY_FX_URL,
  ECB_REFERENCE_FX_VERSION,
  parseEcbReferenceXml,
} from "../_shared/ecb-reference-fx-v1.mjs";

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

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const response = await fetch(ECB_DAILY_FX_URL, {
      method: "GET",
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
        "User-Agent": "AICIS/1.0 reference-fx-research",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return json({
        ok: false,
        code: "ecb_reference_fetch_failed",
        message: "ECB reference FX fetch failed with HTTP " + response.status,
        rates: [],
      }, 502);
    }

    const xml = await response.text();
    const retrievedAt = new Date().toISOString();
    const digest = await sha256(xml);
    const evidenceRefs = [{
      source_id: "ecb:eurofxref-daily",
      source_type: "official_central_bank_reference",
      source_url: ECB_DAILY_FX_URL,
      observed_at: retrievedAt,
      sha256: digest,
    }];

    const parsed = parseEcbReferenceXml(xml, {
      retrieved_at: retrievedAt,
      evidence_refs: evidenceRefs,
    });

    if (!parsed.ok) {
      return json({
        ok: false,
        code: parsed.error,
        message: "ECB response did not contain a valid dated reference-rate set.",
        rates: [],
      }, 502);
    }

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "fetch_reference_fx",
      result: "ecb_reference_rates_returned",
      log_level: "info",
      metadata: {
        version: ECB_REFERENCE_FX_VERSION,
        provider: "European Central Bank",
        effective_date: parsed.effective_date,
        retrieved_at: retrievedAt,
        rate_count: parsed.rates.length,
        execution_eligible_rate_count: 0,
        payload_sha256: digest,
      },
    });

    return json({
      ok: true,
      version: ECB_REFERENCE_FX_VERSION,
      provider: "European Central Bank",
      effective_date: parsed.effective_date,
      retrieved_at: retrievedAt,
      rates: parsed.rates,
      evidence_refs: evidenceRefs,
      usage: {
        research_comparison_allowed: true,
        execution_ready: false,
        notice: "ECB reference rates are informational reference data, not executable FX quotes. AICIS keeps execution readiness false for any path that depends on them.",
      },
    });
  } catch (error) {
    console.error("fetch-reference-fx failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "ECB reference FX fetch failed",
      rates: [],
    }, 500);
  }
});
