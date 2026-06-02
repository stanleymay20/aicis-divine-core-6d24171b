import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";
import { MiniStat } from "./atoms";

export function MatchQualityAudit({ matchQuality }: { matchQuality: any }) {
  if (!matchQuality || !(matchQuality.sample_size > 0)) return null;
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Search className="h-4 w-4" /> Match Quality Audit
          <Badge variant="outline" className="ml-auto text-[10px]">Score: {matchQuality.quality_score ?? "—"}/100</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <MiniStat label="Matched ≤1d" value={matchQuality.matched_within_1d} />
          <MiniStat label="Matched ≤3d" value={matchQuality.matched_within_3d} />
          <MiniStat label="Matched ≤7d" value={matchQuality.matched_within_7d} />
          <MiniStat label="Avg delay (days)" value={matchQuality.average_match_delay_days} />
          <MiniStat label="Null actuals" value={matchQuality.rows_with_null_actuals} warn={matchQuality.rows_with_null_actuals > 0} />
          <MiniStat label="Missing ISO3" value={matchQuality.rows_with_missing_iso3} warn={matchQuality.rows_with_missing_iso3 > 0} />
        </div>

        {matchQuality.domain_delays?.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1 font-medium">Avg match delay by domain</p>
            <div className="flex flex-wrap gap-2">
              {matchQuality.domain_delays.map((dd: any) => (
                <div key={dd.domain} className={`bg-muted rounded px-2 py-1 text-xs ${dd.avg_delay > 5 ? "text-yellow-400" : ""}`}>
                  <span className="font-medium">{dd.domain}</span>: {dd.avg_delay}d ({dd.count})
                </div>
              ))}
            </div>
          </div>
        )}

        {matchQuality.samples?.length > 0 && (
          <Table>
            <TableHeader><TableRow>
              <TableHead className="text-xs">Domain</TableHead><TableHead className="text-xs">ISO3</TableHead>
              <TableHead className="text-xs">Due</TableHead><TableHead className="text-xs">Delay</TableHead>
              <TableHead className="text-xs">Policy</TableHead><TableHead className="text-xs">Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {matchQuality.samples.slice(0, 5).map((s: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{s.domain}</TableCell>
                  <TableCell className="text-xs">{s.iso3}</TableCell>
                  <TableCell className="text-xs">{s.realization_due_at?.slice(0, 10)}</TableCell>
                  <TableCell className="text-xs">{s.delay_days ?? "—"}d</TableCell>
                  <TableCell><Badge variant={s.policy_status === "domain_policy" ? "default" : "secondary"} className="text-[10px]">{s.policy_status ?? "—"}</Badge></TableCell>
                  <TableCell><Badge variant={s.status === "matched" ? "default" : "destructive"} className="text-[10px]">{s.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
