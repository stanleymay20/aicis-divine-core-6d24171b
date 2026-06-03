import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SovereignStats {
  ledgerEntries: number;
  citationsActive: number;
  authoritySources: number;
  residencyResources: number;
  activeKeys: number;
  lastSignedAt: string | null;
  ledgerChainOk: boolean;
}

async function fetchSovereignStats(): Promise<SovereignStats> {
  const [ledger, citations, authorities, residency, keys, signed] = await Promise.all([
    supabase.from("ledger_entries").select("*", { count: "exact", head: true }),
    supabase.from("intelligence_citations").select("*", { count: "exact", head: true }),
    supabase.from("source_authority_registry").select("*", { count: "exact", head: true }),
    supabase.from("data_residency_manifest").select("*", { count: "exact", head: true }),
    supabase.from("federation_signing_keys").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("federation_signed_bundles").select("signed_at").order("signed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    ledgerEntries: ledger.count ?? 0,
    citationsActive: citations.count ?? 0,
    authoritySources: authorities.count ?? 0,
    residencyResources: residency.count ?? 0,
    activeKeys: keys.count ?? 0,
    lastSignedAt: (signed.data as any)?.signed_at ?? null,
    ledgerChainOk: (ledger.count ?? 0) > 0,
  };
}

export function useSovereignStats() {
  return useQuery({
    queryKey: ["sovereign-stats"],
    queryFn: fetchSovereignStats,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
