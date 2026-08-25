import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-aicis-node-key, x-cron-secret",
};

const EntrySchema = z.object({
  entryType: z.string().trim().min(1).max(80),
  payload: z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 100_000, "payload too large"),
  signature: z.string().max(8000).optional().nullable(),
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

async function sha256Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const raw = await req.json().catch(() => ({}));
  const parsed = EntrySchema.safeParse(raw);
  if (!parsed.success) return json({ error: "Invalid input", issues: parsed.error.flatten() }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const nodeKey = req.headers.get("x-aicis-node-key");
  let nodeId: string | null = null;
  let callerType: "node" | "admin" | "cron" = "admin";

  try {
    if (nodeKey) {
      const keyHash = await sha256Hex(nodeKey);
      const { data: node, error: nodeError } = await supabase
        .from("accountability_nodes")
        .select("id,verified")
        .eq("api_key_hash", keyHash)
        .maybeSingle();
      if (nodeError) throw nodeError;
      if (!node || !node.verified) return json({ error: "Invalid or unverified node key" }, 401);
      nodeId = node.id;
      callerType = "node";
    } else {
      const auth = await requireAdminOrCron(req, corsHeaders);
      if (auth.response) return auth.response;
      callerType = auth.via === "cron" ? "cron" : "admin";
    }

    const { entryType, payload, signature } = parsed.data;
    const { data: lastEntry, error: lastError } = await supabase
      .from("ledger_entries")
      .select("hash")
      .order("block_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw lastError;

    const previousHash = lastEntry?.hash ?? "genesis";
    const timestamp = new Date().toISOString();
    const entryData = { entry_type: entryType, payload, previous_hash: previousHash, timestamp };
    const hash = await sha256Hex(JSON.stringify(entryData));

    const { data: entry, error: entryError } = await supabase
      .from("ledger_entries")
      .insert({
        entry_type: entryType,
        node_id: nodeId,
        hash,
        payload,
        signature: signature ?? null,
        previous_hash: previousHash,
        // A supplied signature is evidence material, not proof. Verification must
        // be performed cryptographically by a dedicated verifier before this flag
        // can become true.
        verified: false,
      })
      .select("id,hash,block_number,verified")
      .single();
    if (entryError) throw entryError;

    if (nodeId) {
      const { error: auditError } = await supabase.from("node_audit_trail").insert({
        node_id: nodeId,
        action: "ledger_entry_added",
        status: "success",
        metadata: { entry_id: entry.id, entry_type: entryType, hash, signature_supplied: Boolean(signature) },
      });
      if (auditError) console.error("ledger node audit failed", auditError.message);
    }

    return json({
      success: true,
      caller_type: callerType,
      entry,
      signature_status: signature ? "stored_unverified" : "absent",
    });
  } catch (error) {
    console.error("ledger-add-entry error", error instanceof Error ? error.message : String(error));
    return json({ error: "Failed to add entry" }, 500);
  }
});
