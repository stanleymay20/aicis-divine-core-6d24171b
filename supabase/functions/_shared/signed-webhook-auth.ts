import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrTrustedWorker } from "./auth.ts";

const jsonHeaders = (extra: Record<string, string>) => ({
  ...extra,
  "Content-Type": "application/json",
});

function unauthorized(extra: Record<string, string>, reason: string, status = 401) {
  return new Response(JSON.stringify({ error: "Unauthorized", reason }), {
    status,
    headers: jsonHeaders(extra),
  });
}

function parseRequestTimestamp(value: string | null): Date | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function normalizeSignature(value: string): string {
  return value.toLowerCase().startsWith("sha256=") ? value.slice(7) : value;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function requireSignedWebhookOrTrustedWorker(
  req: Request,
  options: {
    provider: string;
    secretEnv: string;
    maxSkewSeconds?: number;
    nonceTtlSeconds?: number;
    extraHeaders?: Record<string, string>;
  },
): Promise<{
  via: "webhook" | "admin" | "cron" | "service_role" | null;
  response: Response | null;
}> {
  const extraHeaders = options.extraHeaders ?? {};
  const signatureHeader = req.headers.get("x-webhook-signature");
  const timestampHeader = req.headers.get("x-webhook-timestamp");
  const nonce = req.headers.get("x-webhook-id");
  const hasWebhookAttempt = Boolean(signatureHeader || timestampHeader || nonce);

  if (!hasWebhookAttempt) {
    const trusted = await requireAdminOrTrustedWorker(req, extraHeaders);
    return { via: trusted.via, response: trusted.response };
  }

  const secret = Deno.env.get(options.secretEnv);
  if (!secret) {
    return {
      via: null,
      response: unauthorized(extraHeaders, "webhook_secret_not_configured", 503),
    };
  }

  if (!signatureHeader || !timestampHeader || !nonce) {
    return {
      via: null,
      response: unauthorized(extraHeaders, "missing_webhook_signature_headers"),
    };
  }

  if (nonce.length < 8 || nonce.length > 256) {
    return {
      via: null,
      response: unauthorized(extraHeaders, "invalid_webhook_id"),
    };
  }

  const requestTimestamp = parseRequestTimestamp(timestampHeader);
  if (!requestTimestamp) {
    return {
      via: null,
      response: unauthorized(extraHeaders, "invalid_webhook_timestamp"),
    };
  }

  const maxSkewSeconds = options.maxSkewSeconds ?? 300;
  const skewMs = Math.abs(Date.now() - requestTimestamp.getTime());
  if (skewMs > maxSkewSeconds * 1000) {
    return {
      via: null,
      response: unauthorized(extraHeaders, "stale_webhook_timestamp"),
    };
  }

  const body = await req.clone().text();
  const signedPayload = `${timestampHeader}.${nonce}.${body}`;
  const expectedSignature = await hmacSha256Hex(secret, signedPayload);
  const providedSignature = normalizeSignature(signatureHeader.trim());

  if (!/^[a-f0-9]{64}$/i.test(providedSignature) || !constantTimeEqual(providedSignature, expectedSignature)) {
    return {
      via: null,
      response: unauthorized(extraHeaders, "invalid_webhook_signature"),
    };
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data: claimed, error } = await admin.rpc("claim_webhook_nonce", {
    _provider: options.provider,
    _nonce: nonce,
    _request_timestamp: requestTimestamp.toISOString(),
    _ttl_seconds: options.nonceTtlSeconds ?? 600,
  });

  if (error) {
    console.error(JSON.stringify({
      level: "error",
      function: "signed-webhook-auth",
      message: "webhook_nonce_claim_failed",
      provider: options.provider,
      error: error.message,
      timestamp: new Date().toISOString(),
    }));
    return {
      via: null,
      response: unauthorized(extraHeaders, "webhook_replay_guard_unavailable", 503),
    };
  }

  if (claimed !== true) {
    return {
      via: null,
      response: unauthorized(extraHeaders, "webhook_replay_detected", 409),
    };
  }

  return { via: "webhook", response: null };
}
