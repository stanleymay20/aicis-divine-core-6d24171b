import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RoutingPrecisionStats = {
  total: number;
  confirmed: number;
  rejected: number;
  unclear: number;
  confirmRate: number;
  rejectRate: number;
  unclearRate: number;
  byCategory: Record<string, { confirmed: number; rejected: number; total: number; rate: number }>;
  byTier: Record<string, { confirmed: number; rejected: number; total: number; rate: number }>;
};

export function useRoutingPrecision() {
  return useQuery({
    queryKey: ["routing-precision"],
    queryFn: async () => {
      const { data: feedback, error } = await supabase
        .from("signal_routing_feedback")
        .select("signal_id, feedback, reviewer_notes, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!feedback || feedback.length === 0) {
        return {
          total: 0, confirmed: 0, rejected: 0, unclear: 0,
          confirmRate: 0, rejectRate: 0, unclearRate: 0,
          byCategory: {}, byTier: {},
        } as RoutingPrecisionStats;
      }

      // Get signal details for category/tier breakdown
      const signalIds = [...new Set(feedback.map(f => f.signal_id).filter(Boolean))];
      const { data: signals } = await supabase
        .from("global_signals")
        .select("id, category, source_trust_tier")
        .in("id", signalIds.slice(0, 100));

      const signalMap = new Map<string, { category: string; tier: string }>();
      for (const s of (signals || [])) {
        signalMap.set(s.id, { category: s.category, tier: s.source_trust_tier || "unknown" });
      }

      const total = feedback.length;
      const confirmed = feedback.filter(f => f.feedback === "confirmed").length;
      const rejected = feedback.filter(f => f.feedback === "rejected").length;
      const unclear = feedback.filter(f => f.feedback === "unclear").length;

      const byCategory: Record<string, { confirmed: number; rejected: number; total: number; rate: number }> = {};
      const byTier: Record<string, { confirmed: number; rejected: number; total: number; rate: number }> = {};

      for (const f of feedback) {
        const sig = signalMap.get(f.signal_id);
        const cat = sig?.category || "unknown";
        const tier = sig?.tier || "unknown";

        if (!byCategory[cat]) byCategory[cat] = { confirmed: 0, rejected: 0, total: 0, rate: 0 };
        byCategory[cat].total++;
        if (f.feedback === "confirmed") byCategory[cat].confirmed++;
        if (f.feedback === "rejected") byCategory[cat].rejected++;

        if (!byTier[tier]) byTier[tier] = { confirmed: 0, rejected: 0, total: 0, rate: 0 };
        byTier[tier].total++;
        if (f.feedback === "confirmed") byTier[tier].confirmed++;
        if (f.feedback === "rejected") byTier[tier].rejected++;
      }

      for (const v of Object.values(byCategory)) v.rate = v.total > 0 ? Math.round(v.confirmed / v.total * 100) : 0;
      for (const v of Object.values(byTier)) v.rate = v.total > 0 ? Math.round(v.confirmed / v.total * 100) : 0;

      return {
        total, confirmed, rejected, unclear,
        confirmRate: total > 0 ? Math.round(confirmed / total * 100) : 0,
        rejectRate: total > 0 ? Math.round(rejected / total * 100) : 0,
        unclearRate: total > 0 ? Math.round(unclear / total * 100) : 0,
        byCategory, byTier,
      } as RoutingPrecisionStats;
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });
}

export function useConnectorHealth() {
  return useQuery({
    queryKey: ["connector-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("source_connector_runs")
        .select("*")
        .order("run_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      return data || [];
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useEnrichmentQueue() {
  return useQuery({
    queryKey: ["enrichment-queue"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("global_signals")
        .select("id", { count: "exact", head: true })
        .eq("enrichment_status", "pending_enrichment");
      if (error) throw error;
      return count || 0;
    },
    staleTime: 15000,
    refetchInterval: 30000,
  });
}
