/**
 * Coverage Equity — shows the planetary signal floor, latest gap report,
 * and which countries are currently below the 3-signals/week threshold.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe2, AlertTriangle, Languages } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type GapRow = {
  id: string;
  run_at: string;
  country_iso3: string;
  country_name: string | null;
  signals_7d: number;
  floor: number;
  gap: number;
  language_codes: string[];
  queries_generated: number;
  status: string;
};

export default function CoverageEquity() {
  const { data, isLoading } = useQuery({
    queryKey: ["coverage-equity-latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("coverage_equity_log")
        .select("id,run_at,country_iso3,country_name,signals_7d,floor,gap,language_codes,queries_generated,status")
        .order("run_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data || []) as GapRow[];
    },
    staleTime: 60_000,
  });

  const { data: langTiers } = useQuery({
    queryKey: ["language-tier-breakdown"],
    queryFn: async () => {
      const cols = ["language_tier", "translation_status"] as const;
      const queries = await Promise.all([
        supabase.from("global_signals").select("id", { count: "exact", head: true }).eq("language_tier", "tier_1"),
        supabase.from("global_signals").select("id", { count: "exact", head: true }).eq("language_tier", "tier_2"),
        supabase.from("global_signals").select("id", { count: "exact", head: true }).eq("translation_status", "deferred_low_resource"),
        supabase.from("global_signals").select("id", { count: "exact", head: true }).eq("language_tier", "unknown"),
        supabase.from("global_signals").select("id", { count: "exact", head: true }).eq("translation_status", "pending"),
        supabase.from("global_signals").select("id", { count: "exact", head: true }).eq("translation_status", "translated"),
      ]);
      return {
        tier1: queries[0].count ?? 0, tier2: queries[1].count ?? 0,
        lowResource: queries[2].count ?? 0, unknown: queries[3].count ?? 0,
        pending: queries[4].count ?? 0, translated: queries[5].count ?? 0,
      };
    },
    staleTime: 60_000,
  });

  const latestRunAt = data?.[0]?.run_at;
  const latestRows = data?.filter(r => r.run_at === latestRunAt) || [];
  const totalGap = latestRows.reduce((acc, r) => acc + r.gap, 0);
  const totalQueries = latestRows.reduce((acc, r) => acc + r.queries_generated, 0);

  return (
    <div className="container mx-auto py-6 max-w-6xl space-y-5">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Globe2 className="h-7 w-7 text-primary" /> Coverage Equity
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Enforces a floor of 3 canonical signals per week per UN-recognized country.
          When a country falls below, targeted local-language sweeps are auto-generated.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Countries below floor" value={latestRows.length.toString()} accent="text-amber-300" icon={<AlertTriangle className="h-4 w-4" />} />
        <Stat label="Total signal gap" value={totalGap.toString()} accent="text-rose-300" icon={<AlertTriangle className="h-4 w-4" />} />
        <Stat label="Sweep queries seeded" value={totalQueries.toString()} accent="text-emerald-300" icon={<Languages className="h-4 w-4" />} />
        <Stat label="Last run" value={latestRunAt ? formatDistanceToNow(new Date(latestRunAt), { addSuffix: true }) : "—"} accent="text-sky-300" icon={<Globe2 className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Latest equity report</CardTitle>
          <CardDescription>
            {isLoading ? "Loading…" : latestRows.length === 0
              ? "No coverage gaps recorded yet. The daily enforcer runs at 04:15 UTC."
              : `${latestRows.length} countries flagged in the most recent run.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3">Country</th>
                  <th className="text-right py-2 px-3">7-day signals</th>
                  <th className="text-right py-2 px-3">Floor</th>
                  <th className="text-right py-2 px-3">Gap</th>
                  <th className="text-left py-2 px-3">Languages</th>
                  <th className="text-right py-2 pl-3">Queries seeded</th>
                </tr>
              </thead>
              <tbody>
                {latestRows.map(r => (
                  <tr key={r.id} className="border-b border-border/40 hover:bg-muted/10">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{r.country_name || r.country_iso3}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{r.country_iso3}</div>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{r.signals_7d}</td>
                    <td className="py-2 px-3 text-right font-mono text-muted-foreground">{r.floor}</td>
                    <td className="py-2 px-3 text-right font-mono text-amber-300">{r.gap}</td>
                    <td className="py-2 px-3">
                      <div className="flex gap-1 flex-wrap">
                        {(r.language_codes || []).map(l => (
                          <Badge key={l} variant="outline" className="text-[10px] uppercase">{l}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pl-3 text-right font-mono text-emerald-300">{r.queries_generated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent, icon }: { label: string; value: string; accent: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className={`flex items-center gap-2 text-xs ${accent}`}>{icon}<span>{label}</span></div>
        <div className="text-2xl font-bold mt-1 font-mono">{value}</div>
      </CardContent>
    </Card>
  );
}
