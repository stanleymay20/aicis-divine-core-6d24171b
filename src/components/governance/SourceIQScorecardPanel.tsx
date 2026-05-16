import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";

const DIMS = ["completeness", "accuracy", "consistency", "timeliness", "validity", "uniqueness"] as const;
type Dim = typeof DIMS[number];

const tone = (n: number) => {
  if (n >= 85) return "text-emerald-400";
  if (n >= 65) return "text-amber-400";
  return "text-rose-400";
};
const cellBg = (n: number) => {
  if (n >= 85) return "bg-emerald-500/15";
  if (n >= 65) return "bg-amber-500/15";
  return "bg-rose-500/15";
};

export function SourceIQScorecardPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["source-iq-scorecards"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("source_iq_scorecards" as any)
        .select("*")
        .order("measured_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      // dedupe — latest per source
      const map = new Map<string, any>();
      for (const r of (data ?? []) as any[]) if (!map.has(r.source_name)) map.set(r.source_name, r);
      return Array.from(map.values()).sort((a, b) => b.composite_score - a.composite_score);
    },
  });

  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-400" />
          Source Information Quality (TIQM 6-dimension)
        </CardTitle>
        <CardDescription className="text-xs">
          Composite of completeness, accuracy, consistency, timeliness, validity, uniqueness — per provider.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data?.length ? (
          <p className="text-xs text-muted-foreground">No scorecards yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border/40">
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 px-2 text-right">Composite</th>
                  {DIMS.map((d) => (
                    <th key={d} className="py-2 px-2 text-right capitalize">{d.slice(0, 4)}</th>
                  ))}
                  <th className="py-2 pl-2 text-right">Rows</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r: any) => (
                  <tr key={r.id} className="border-b border-border/20">
                    <td className="py-1.5 pr-3 font-medium">{r.source_name}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums font-semibold ${tone(r.composite_score)}`}>
                      {Number(r.composite_score).toFixed(1)}
                    </td>
                    {DIMS.map((d) => {
                      const v = Number(r[d as Dim]);
                      return (
                        <td key={d} className={`py-1.5 px-2 text-right tabular-nums ${cellBg(v)} ${tone(v)}`}>
                          {v.toFixed(0)}
                        </td>
                      );
                    })}
                    <td className="py-1.5 pl-2 text-right text-muted-foreground tabular-nums">
                      {Number(r.rows_assessed).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">≥85 Strong</Badge>
              <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/30">65–84 Watch</Badge>
              <Badge variant="outline" className="bg-rose-500/10 text-rose-300 border-rose-500/30">&lt;65 Remediate</Badge>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
