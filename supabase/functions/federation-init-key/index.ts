// Generates a new Ed25519 keypair for federation signing.
// Registers the public key in federation_signing_keys (becomes active).
// Returns the base64-encoded private seed ONCE — the operator must store it
// as the FEDERATION_ED25519_PRIVATE_KEY secret. Never logged, never persisted.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Auth: require service role caller via Authorization header
    const auth = req.headers.get("Authorization") || "";
    if (!auth.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___")) {
      // Allow only authenticated admins via JWT — soft check; reject anon
      const { data: { user } } = await createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: auth } } },
      ).auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const keyPair = await crypto.subtle.generateKey(
      { name: "Ed25519" } as any,
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;

    const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    // pkcs8 contains the private seed; we'll base64 it for the operator to store as secret
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));

    const publicKeyB64 = toBase64(rawPub);
    const privateKeyB64 = toBase64(pkcs8);
    const keyId = `fed-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;

    // Rotate via SQL function (deactivates old, inserts new active)
    const { error } = await supabase.rpc("rotate_federation_key", {
      p_new_key_id: keyId,
      p_new_public_key: publicKeyB64,
      p_rotation_days: 180,
    });
    if (error) throw error;

    return new Response(JSON.stringify({
      ok: true,
      key_id: keyId,
      public_key: publicKeyB64,
      private_key_pkcs8_base64: privateKeyB64,
      instructions: "Save private_key_pkcs8_base64 as secret FEDERATION_ED25519_PRIVATE_KEY. Save key_id as FEDERATION_KEY_ID. Then redeploy federation-sign-bundle. The private key will NOT be retrievable again.",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
