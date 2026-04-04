import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GlobalSignal = {
  id: string;
  title: string;
  summary: string;
  normalized_summary: string | null;
  category: string;
  subcategory: string | null;
  status: string;
  confidence_score: number;
  impact_score: number;
  urgency_score: number;
  source_count: number;
  primary_source: string | null;
  source_references: any[];
  first_detected_at: string;
  latest_update_at: string;
  occurred_at: string | null;
  affected_regions: string[];
  affected_countries: string[];
  affected_sectors: string[];
  affected_stakeholders: string[];
  strategic_implications: string | null;
  likely_consequences: string | null;
  uncertainty_notes: string | null;
  misinformation_risk: number;
  recommended_actions: Record<string, string>;
  audience_framing: Record<string, string>;
  impact_reasoning: string | null;
  evidence_hash: string | null;
  model_version: string | null;
  ingestion_source: string | null;
  source_trust_tier: string | null;
  multi_source_confirmed: boolean;
  related_signal_ids: string[];
  created_at: string;
  // Phase 16.2 fields
  official_source: boolean;
  canonical_source_name: string | null;
  source_rank_score: number;
  event_cluster_id: string | null;
  enrichment_status: string;
  enrichment_attempts: number;
  enrichment_error: string | null;
  ingested_at: string | null;
  enriched_at: string | null;
  routed_at: string | null;
  official_source_present: boolean;
  merged_source_count: number;
  routing_score: number;
  routing_suppressed_reason: string | null;
};

export type FreshnessLevel = "fresh" | "recent" | "aging" | "stale";

export function getSignalFreshness(dateStr: string): FreshnessLevel {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 2) return "fresh";
  if (hours < 12) return "recent";
  if (hours < 24) return "aging";
  return "stale";
}

export function freshnessColor(level: FreshnessLevel): string {
  switch (level) {
    case "fresh": return "text-emerald-400";
    case "recent": return "text-yellow-400";
    case "aging": return "text-orange-400";
    case "stale": return "text-red-400";
  }
}

export function trustTierLabel(tier: string | null): string {
  switch (tier) {
    case "tier_1": return "Tier 1";
    case "tier_2": return "Tier 2";
    case "tier_3": return "Tier 3";
    default: return "Unrated";
  }
}

export function trustTierColor(tier: string | null): string {
  switch (tier) {
    case "tier_1": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "tier_2": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "tier_3": return "bg-red-500/20 text-red-400 border-red-500/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export function enrichmentStatusLabel(status: string): string {
  switch (status) {
    case "pending_enrichment": return "Pending";
    case "enriching": return "Processing…";
    case "enriched": return "Enriched";
    case "failed": return "Failed";
    default: return status;
  }
}

export function enrichmentStatusColor(status: string): string {
  switch (status) {
    case "pending_enrichment": return "text-amber-400";
    case "enriching": return "text-blue-400";
    case "enriched": return "text-emerald-400";
    case "failed": return "text-red-400";
    default: return "text-muted-foreground";
  }
}

export function useGlobalSignals(options?: {
  category?: string;
  limit?: number;
  minImpact?: number;
}) {
  return useQuery({
    queryKey: ["global-signals", options],
    queryFn: async () => {
      let query = supabase
        .from("global_signals")
        .select("*")
        .order("first_detected_at", { ascending: false })
        .limit(options?.limit || 50);

      if (options?.category) {
        query = query.eq("category", options.category as any);
      }
      if (options?.minImpact) {
        query = query.gte("impact_score", options.minImpact);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as GlobalSignal[];
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useTopSignals(limit = 5) {
  return useQuery({
    queryKey: ["top-signals", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_signals")
        .select("*")
        .eq("enrichment_status", "enriched")
        .gte("impact_score", 50)
        .order("impact_score", { ascending: false })
        .order("urgency_score", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []) as GlobalSignal[];
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });
}
