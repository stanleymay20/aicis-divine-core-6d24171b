import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FederationPeer {
  id: string;
  peer_name: string;
  base_url: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function safePeerHealthUrl(baseUrl: string): URL | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      host === "localhost" || host === "::1" || host === "0.0.0.0" ||
      host.endsWith(".local") || host.endsWith(".localhost") ||
      /^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) ||
      /^192\.168\./.test(host) || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
    ) return null;

    url.pathname = `${url.pathname.replace(/\/$/, "")}/health`;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminUser(req, corsHeaders);
  if (auth.response) return auth.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({})) as { peer_id?: unknown };
    const peerId = typeof body.peer_id === "string" ? body.peer_id : "";
    if (!peerId) return json({ error: "peer_id required" }, 400);

    const { data: peerRaw, error: peerError } = await supabase
      .from("federation_peers")
      .select("id,peer_name,base_url")
      .eq("id", peerId)
      .maybeSingle();
    if (peerError) throw peerError;
    if (!peerRaw) return json({ error: "Peer not found" }, 404);
    const peer = peerRaw as FederationPeer;

    const healthUrl = safePeerHealthUrl(peer.base_url);
    if (!healthUrl) return json({ error: "Peer URL is not permitted for outbound health checks" }, 400);

    try {
      const response = await fetch(healthUrl, { method: "GET", redirect: "error", signal: AbortSignal.timeout(5000) });
      const reachable = response.ok;
      const message = reachable ? "Peer reachable" : `HTTP ${response.status}`;
      const { error: logError } = await supabase.from("system_logs").insert({
        action: "fed_test_peer",
        result: message,
        log_level: reachable ? "info" : "warn",
        division: "system",
        metadata: { peer: peer.peer_name, reachable, tested_by: auth.user?.id ?? null },
      });
      if (logError) console.error("fed-admin-test-peer audit log failed", logError.message);
      return json({ ok: true, reachable, message });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase.from("system_logs").insert({
        action: "fed_test_peer",
        result: `Connection failed: ${message}`,
        log_level: "error",
        division: "system",
        metadata: { peer: peer.peer_name, tested_by: auth.user?.id ?? null },
      });
      return json({ ok: false, reachable: false, message });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("fed-admin-test-peer error", message);
    return json({ error: message }, 500);
  }
});
