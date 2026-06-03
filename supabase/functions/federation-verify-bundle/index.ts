// Verifies an Ed25519 signature against a registered federation key.
// Body: { key_id: string, signature: string (base64), bundle_hash?: string, payload?: any }
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
async function sha256Hex(data: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(h).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({}));
    const { key_id, signature, bundle_hash, payload } = body;
    if (!key_id || !signature) {
      return new Response(JSON.stringify({ error: "Provide { key_id, signature, payload | bundle_hash }" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: keyRow, error: keyErr } = await supabase
      .from("federation_signing_keys")
      .select("public_key, key_status, is_active, revoked_at")
      .eq("key_id", key_id).maybeSingle();
    if (keyErr || !keyRow) {
      return new Response(JSON.stringify({ valid: false, reason: "key_not_found", key_id }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (keyRow.key_status === "compromised" || keyRow.key_status === "revoked") {
      return new Response(JSON.stringify({ valid: false, reason: `key_${keyRow.key_status}`, key_id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let bytes: Uint8Array;
    let computedHash = bundle_hash || "";
    if (payload != null) {
      bytes = new TextEncoder().encode(JSON.stringify(payload));
      computedHash = await sha256Hex(bytes);
    } else if (bundle_hash) {
      bytes = new TextEncoder().encode(bundle_hash);
    } else {
      return new Response(JSON.stringify({ error: "Provide payload or bundle_hash" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const pubKey = await crypto.subtle.importKey(
      "raw", fromB64(keyRow.public_key), { name: "Ed25519" } as any, false, ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" } as any, pubKey, fromB64(signature), bytes,
    );

    return new Response(JSON.stringify({
      valid, key_id, key_status: keyRow.key_status,
      is_active: keyRow.is_active, bundle_hash: computedHash, algorithm: "Ed25519",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
