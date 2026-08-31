// Public detached-signature verifier. Federation public keys are intentionally
// public-readable under RLS, so this function uses the anon client rather than
// service-role. New signatures verify over a deterministic SHA-256 bundle hash;
// legacy payload-byte signatures remain verifiable during transition.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CURRENT_SCHEME = "ed25519_sha256_aicis_canonical_json_v1";
const LEGACY_SCHEME = "ed25519_raw_json_legacy";

function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", asArrayBuffer(data)));
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !anonKey) return json({ error: "Public verification configuration is incomplete" }, 503);

    const parsed = await req.json().catch(() => null);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "Request body must be a JSON object" }, 400);
    }
    const body = parsed as Record<string, unknown>;
    const keyId = typeof body.key_id === "string" ? body.key_id.trim() : "";
    const signatureB64 = typeof body.signature === "string" ? body.signature.trim() : "";
    if (!keyId || !signatureB64) {
      return json({ error: "Provide { key_id, signature, payload | bundle_hash }" }, 400);
    }

    const supabase = createClient(supabaseUrl, anonKey);
    const { data: keyRow, error: keyError } = await supabase
      .from("federation_signing_keys")
      .select("public_key, key_status, is_active, revoked_at, algorithm")
      .eq("key_id", keyId)
      .maybeSingle();
    if (keyError) throw keyError;
    if (!keyRow) return json({ valid: false, reason: "key_not_found", key_id: keyId }, 404);
    if (keyRow.algorithm !== "Ed25519") {
      return json({ valid: false, reason: "unsupported_algorithm", key_id: keyId, algorithm: keyRow.algorithm });
    }
    if (keyRow.key_status === "compromised" || keyRow.key_status === "revoked" || keyRow.revoked_at) {
      return json({ valid: false, reason: `key_${keyRow.key_status}`, key_id: keyId });
    }

    const hasPayload = Object.prototype.hasOwnProperty.call(body, "payload");
    const suppliedHash = typeof body.bundle_hash === "string" ? body.bundle_hash.trim().toLowerCase() : "";
    let bundleHash = suppliedHash;
    let currentBytes: Uint8Array;
    let legacyPayloadBytes: Uint8Array | null = null;

    if (hasPayload) {
      const canonicalBytes = new TextEncoder().encode(canonicalize(body.payload));
      bundleHash = await sha256Hex(canonicalBytes);
      currentBytes = new TextEncoder().encode(bundleHash);
      // Before the deterministic-hash protocol, payload calls signed the parsed
      // payload's JSON.stringify bytes. Keep a verification fallback for those
      // already-issued signatures without creating new legacy signatures.
      const legacyJson = JSON.stringify(body.payload);
      legacyPayloadBytes = new TextEncoder().encode(legacyJson);
    } else if (/^[a-f0-9]{64}$/.test(bundleHash)) {
      currentBytes = new TextEncoder().encode(bundleHash);
    } else {
      return json({ error: "Provide payload or a 64-character hexadecimal bundle_hash" }, 400);
    }

    const publicKey = await crypto.subtle.importKey(
      "raw",
      asArrayBuffer(fromB64(keyRow.public_key)),
      "Ed25519",
      false,
      ["verify"],
    );
    const signatureBytes = fromB64(signatureB64);
    let valid = await crypto.subtle.verify("Ed25519", publicKey, asArrayBuffer(signatureBytes), asArrayBuffer(currentBytes));
    let signatureScheme = CURRENT_SCHEME;

    if (!valid && legacyPayloadBytes) {
      valid = await crypto.subtle.verify("Ed25519", publicKey, asArrayBuffer(signatureBytes), asArrayBuffer(legacyPayloadBytes));
      if (valid) signatureScheme = LEGACY_SCHEME;
    }

    return json({
      valid,
      key_id: keyId,
      key_status: keyRow.key_status,
      is_active: keyRow.is_active,
      bundle_hash: bundleHash,
      algorithm: "Ed25519",
      signature_scheme: valid ? signatureScheme : null,
      verification_uses_public_rls_data_only: true,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
