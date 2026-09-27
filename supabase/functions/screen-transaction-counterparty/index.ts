import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  OFFICIAL_SANCTIONS_SCREEN_VERSION,
  parseOfacSdnEntities,
  parseUnConsolidatedEntities,
  screenEntityAgainstOfficialSnapshots,
} from "../_shared/official-sanctions-screen-v1.mjs";

const OFAC_SDN_XML = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const UN_CONSOLIDATED_XML = "https://scsanctions.un.org/resources/xml/en/name/consolidated.xml";
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SourceKey = "ofac_sdn" | "un_consolidated";
type EvidenceRef = {
  source_id: string;
  source_type: string;
  source_url: string;
  observed_at: string;
  sha256: string;
};

type Snapshot = {
  source: SourceKey;
  records: Array<Record<string, unknown>>;
  evidence_refs: EvidenceRef[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchXml(source: SourceKey, url: string): Promise<{
  ok: boolean;
  source: SourceKey;
  url: string;
  xml?: string;
  evidence_ref?: EvidenceRef;
  bytes?: number;
  error?: string;
}> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1",
        "User-Agent": "AICIS/1.0 official-sanctions-screen",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });

    if (!response.ok) {
      return { ok: false, source, url, error: "HTTP_" + response.status };
    }

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
      return { ok: false, source, url, error: "SOURCE_TOO_LARGE" };
    }

    const xml = await response.text();
    const bytes = new TextEncoder().encode(xml).byteLength;
    if (bytes > MAX_SOURCE_BYTES) {
      return { ok: false, source, url, error: "SOURCE_TOO_LARGE" };
    }

    const observedAt = new Date().toISOString();
    const digest = await sha256(xml);
    return {
      ok: true,
      source,
      url,
      xml,
      bytes,
      evidence_ref: {
        source_id: source + ":official-current",
        source_type: "official_sanctions_list",
        source_url: response.url || url,
        observed_at: observedAt,
        sha256: digest,
      },
    };
  } catch (error) {
    return {
      ok: false,
      source,
      url,
      error: error instanceof Error ? error.message : "fetch_failed",
    };
  }
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

  try {
    const body = asRecord(await req.json().catch(() => ({})));
    const legalName = typeof body.legal_name === "string" ? body.legal_name.trim() : "";
    const registrationId = typeof body.registration_id === "string" ? body.registration_id.trim() : null;
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, 20)
      : [];

    if (!legalName) {
      return json({ ok: false, error: "legal_name is required" }, 400);
    }

    const results = await Promise.all([
      fetchXml("ofac_sdn", OFAC_SDN_XML),
      fetchXml("un_consolidated", UN_CONSOLIDATED_XML),
    ]);

    const snapshots: Snapshot[] = [];
    const sources = [];

    for (const result of results) {
      if (!result.ok || !result.xml || !result.evidence_ref) {
        sources.push({
          source: result.source,
          ok: false,
          error: result.error ?? "unavailable",
          records: 0,
        });
        continue;
      }

      const records = result.source === "ofac_sdn"
        ? parseOfacSdnEntities(result.xml)
        : parseUnConsolidatedEntities(result.xml);

      snapshots.push({
        source: result.source,
        records: records as Array<Record<string, unknown>>,
        evidence_refs: [result.evidence_ref],
      });
      sources.push({
        source: result.source,
        ok: true,
        records: records.length,
        bytes: result.bytes ?? null,
        evidence_ref: result.evidence_ref,
      });
    }

    const screen = screenEntityAgainstOfficialSnapshots({
      legal_name: legalName,
      aliases,
      registration_id: registrationId,
      snapshots,
      required_sources: ["ofac_sdn", "un_consolidated", "eu_sanctions", "uk_sanctions"],
    });

    const coverage = {
      required_sources: ["ofac_sdn", "un_consolidated", "eu_sanctions", "uk_sanctions"],
      checked_sources: snapshots.map((snapshot) => snapshot.source),
      missing_sources: screen.missing_sources ?? [],
      complete: (screen.missing_sources ?? []).length === 0,
    };

    await sb.from("system_logs").insert({
      user_id: user.id,
      division: "finance",
      action: "screen_transaction_counterparty",
      result: screen.status,
      log_level: screen.matches?.length ? "warning" : "info",
      metadata: {
        screen_version: OFFICIAL_SANCTIONS_SCREEN_VERSION,
        legal_name: legalName,
        registration_id_supplied: Boolean(registrationId),
        aliases_supplied: aliases.length,
        potential_matches: screen.matches?.length ?? 0,
        checked_sources: coverage.checked_sources,
        missing_sources: coverage.missing_sources,
        transaction_eligible: false,
      },
    });

    return json({
      ok: true,
      screen_version: OFFICIAL_SANCTIONS_SCREEN_VERSION,
      legal_name: legalName,
      registration_id: registrationId,
      aliases,
      screen,
      coverage,
      sources,
      compliance_boundary: {
        automatic_legal_clearance: false,
        human_compliance_review_required: true,
        transaction_eligible: false,
        notice: "An official-list name or identifier match is a review trigger, not an automatic legal determination. A no-match is not a clearance while required official sources remain unchecked.",
      },
    });
  } catch (error) {
    console.error("screen-transaction-counterparty failed", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Official sanctions screening failed",
    }, 500);
  }
});
