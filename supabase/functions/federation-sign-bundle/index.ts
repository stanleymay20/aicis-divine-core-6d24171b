// Privileged federation signer. New signatures use a deterministic payload hash
// contract and are self-verified against the registered public key before they
// are recorded as verified.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const SIGNATURE_SCHEME = "ed25519_sha256_aicis_canonical_json_v1";

function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Payload contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  throw new Error(`Unsupported payload value type: ${typeof value}`);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const privateKeyB64 = Deno.env.get("FEDERATION_ED25519_PRIVATE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) return json({ error: "Supabase service configuration is incomplete" }, 503);
    if (!privateKeyB64) {
      return json({
        error: "FEDERATION_ED25519_PRIVATE_KEY is not configured",
        action: "Initialize/rotate the federation key through the privileged key-management flow, then store the private key as a secret.",
      }, 503);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: activeKey, error: keyError } = await supabase
      .from("federation_active_key")
      .select("key_id, public_key, algorithm")
      .maybeSingle();
    if (keyError) throw keyError;
    if (!activeKey) return json({ error: "No active federation signing key is registered" }, 503);
    if (activeKey.algorithm !== "Ed25519") {
      return json({ error: `Unsupported active federation algorithm: ${activeKey.algorithm}` }, 503);
    }

    const parsed = await req.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "Request body must be a JSON object" }, 400);
    }
    const body = parsed as Record<string, unknown>;
    const hasPayload = Object.prototype.hasOwnProperty.call(body, "payload");
    const suppliedHash = typeof body.bundle_hash === "string" ? body.bundle_hash.trim().toLowerCase() : "";

    let bundleHash: string;
    let payloadSizeBytes: number;
    if (hasPayload) {
      const canonical = canonicalize(body.payload);
      const canonicalBytes = new TextEncoder().encode(canonical);
      bundleHash = await sha256Hex(canonicalBytes);
      payloadSizeBytes = canonicalBytes.byteLength;
    } else if (/^[a-f0-9]{64}$/.test(suppliedHash)) {
      bundleHash = suppliedHash;
      payloadSizeBytes = 0;
    } else {
      return json({ error: "Provide { payload } or a 64-character hexadecimal { bundle_hash }" }, 400);
    }

    // The detached signature is always over the lowercase SHA-256 bundle hash.
    // This removes the old split contract where payload calls signed JSON bytes
    // while bundle_hash calls signed the hash text.
    const signingBytes = new TextEncoder().encode(bundleHash);
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      fromB64(privateKeyB64),
      "Ed25519",
      false,
      ["sign"],
    );
    const signatureBytes = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, signingBytes));
    const signature = toB64(signatureBytes);

    // Prove the configured private secret actually matches the active public key
    // before asserting verified=true in the database.
    const publicKey = await crypto.subtle.importKey(
      "raw",
      fromB64(activeKey.public_key),
      "Ed25519",
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify("Ed25519", publicKey, signatureBytes, signingBytes);
    if (!verified) {
      return json({
        error: "Configured federation private key does not match the active registered public key",
        key_id: activeKey.key_id,
      }, 409);
    }

    const verifiedAt = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabase
      .from("federation_signed_bundles")
      .insert({
        bundle_hash: bundleHash,
        key_id: activeKey.key_id,
        signature,
        algorithm: "Ed25519",
        payload_size_bytes: payloadSizeBytes,
        verified: true,
        verified_at: verifiedAt,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    return json({
      ok: true,
      bundle_hash: bundleHash,
      key_id: activeKey.key_id,
      algorithm: "Ed25519",
      signature,
      signature_scheme: SIGNATURE_SCHEME,
      verified_against_registered_public_key: true,
      verified_at: verifiedAt,
      record_id: inserted.id,
      authenticated_via: auth.via,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
