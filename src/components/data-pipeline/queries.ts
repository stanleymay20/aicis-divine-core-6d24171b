import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FreshnessRow, OrphanRow, RunHealthRow, ChainRow, SeedRow } from "./types";

export const useFreshness = (enabled: boolean) =>
  useQuery({
    queryKey: ["dq-village-layer-health"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dq_village_layer_health" as any)
        .select("*")
        .order("hours_since_last", { ascending: false, nullsFirst: true });
      if (error) throw error;
      return (data ?? []) as unknown as FreshnessRow[];
    },
  });

export const useOrphans = (enabled: boolean) =>
  useQuery({
    queryKey: ["dq-orphan-regions"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("dq_orphan_regions" as any).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as OrphanRow[];
    },
  });

export const useRunHealth = (enabled: boolean) =>
  useQuery({
    queryKey: ["dq-inference-run-health"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("dq_inference_run_health" as any).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as RunHealthRow[];
    },
  });

export const useSeedStatus = (enabled: boolean) =>
  useQuery({
    queryKey: ["dq-seed-retry-status"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dq_seed_retry_status" as any)
        .select("*")
        .order("next_retry_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as SeedRow[];
    },
  });

export const useChain = (enabled: boolean) =>
  useQuery({
    queryKey: ["v-local-to-national-freshness"],
    enabled,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_local_to_national_freshness" as any).select("*");
      if (error) throw error;
      return (data ?? []) as unknown as ChainRow[];
    },
  });
