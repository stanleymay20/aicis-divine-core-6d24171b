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

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("Generating daily accountability report...");

    const { data: nodes } = await supabaseClient
      .from("accountability_nodes")
      .select("*")
      .eq("verified", true);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentEntries } = await supabaseClient
      .from("ledger_entries")
      .select("entry_type")
      .gte("timestamp", yesterday)
      .eq("verified", true);

    const { data: rootHash } = await supabaseClient
      .from("ledger_root_hashes")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    const entriesByType: Record<string, number> = {};
    recentEntries?.forEach((entry) => {
      entriesByType[entry.entry_type] = (entriesByType[entry.entry_type] || 0) + 1;
    });

    const nodeList = nodes ?? [];
    const jurisdictionCount = new Set(nodeList.map((node) => node.jurisdiction).filter(Boolean)).size;
    const rootHashPreview = rootHash?.root_hash ? `${rootHash.root_hash.substring(0, 16)}...` : "Unavailable";
    const integrityStatus = rootHash?.root_hash ? "Latest ledger root hash is present" : "No ledger root hash is currently available";

    const reportContent = `
# AICIS Global Accountability Report
**Generated:** ${new Date().toISOString()}

## Network Overview
- **Verified Nodes:** ${nodeList.length}
- **Jurisdictions:** ${jurisdictionCount}
- **Node Types:** Government (${nodeList.filter((node) => node.org_type === "government").length}), NGO (${nodeList.filter((node) => node.org_type === "ngo").length}), Agency (${nodeList.filter((node) => node.org_type === "agency").length}), Academic (${nodeList.filter((node) => node.org_type === "academic").length})

## Ledger Activity (Last 24 Hours)
- **Verified Entries:** ${recentEntries?.length || 0}
${Object.entries(entriesByType).map(([type, count]) => `- **${type}:** ${count}`).join("\n")}

## Integrity Evidence
- **Latest Root Hash:** ${rootHashPreview}
- **Total Blocks:** ${rootHash?.block_count ?? "Unavailable"}
- **Status:** ${integrityStatus}
- **Integrity Score:** Not reported unless a measured verification procedure supplies one

## Active Verified Nodes
${nodeList.map((node) => `- **${node.org_name}** (${node.country}) - ${node.org_type}`).join("\n") || "No verified nodes"}

---
*AICIS Federated Integrity Network — claims are limited to measured evidence.*
`;

    const { data: report, error: reportError } = await supabaseClient
      .from("ai_reports")
      .insert({
        title: `Global Accountability Report - ${new Date().toISOString().slice(0, 10)}`,
        division: "accountability",
        content: reportContent
      })
      .select()
      .single();

    if (reportError) throw reportError;

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-accountability-report",
      status: "success",
      message: `Report generated with ${recentEntries?.length || 0} verified ledger entries from ${nodeList.length} verified nodes`,
      executed_at: new Date().toISOString()
    });

    const { data: admins } = await supabaseClient
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (admins) {
      for (const admin of admins) {
        await supabaseClient.from("notifications").insert({
          user_id: admin.user_id,
          type: "info",
          title: "Daily Accountability Report Ready",
          message: `${recentEntries?.length || 0} verified ledger entries from ${nodeList.length} verified nodes`,
          division: "accountability",
          link: `/reports/${report.id}`
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      report_id: report.id,
      entries_count: recentEntries?.length || 0,
      nodes_count: nodeList.length,
      integrity_score: null,
      root_hash_available: Boolean(rootHash?.root_hash),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in cron-accountability-report:", error);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    await supabaseClient.from("automation_logs").insert({
      job_name: "cron-accountability-report",
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
