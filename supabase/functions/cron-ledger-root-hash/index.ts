import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const guard = await requireAdminOrCron(req, corsHeaders);
  if (guard.response) return guard.response;

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { data: entries, error: entriesError } = await supabaseClient
      .from("ledger_entries")
      .select("hash")
      .eq("verified", true)
      .order("block_number", { ascending: true });

    if (entriesError) throw entriesError;

    if (!entries || entries.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No verified entries to hash"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allHashes = entries.map((entry) => entry.hash).join("");
    const rootHashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(allHashes)
    );
    const rootHash = Array.from(new Uint8Array(rootHashBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const { data: rootRecord, error: rootError } = await supabaseClient
      .from("ledger_root_hashes")
      .insert({
        root_hash: rootHash,
        block_count: entries.length,
        verified: true,
        metadata: {
          computation_date: new Date().toISOString(),
          entries_count: entries.length,
          input_scope: "verified_ledger_entries"
        }
      })
      .select("id")
      .single();

    if (rootError) throw rootError;

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-ledger-root-hash",
      status: "success",
      message: `Root hash computed: ${rootHash.substring(0, 16)}... (${entries.length} verified entries)`,
      executed_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({
      success: true,
      root_hash: rootHash,
      block_count: entries.length,
      record_id: rootRecord.id
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in cron-ledger-root-hash:", error);

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-ledger-root-hash",
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
      executed_at: new Date().toISOString()
    });

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
