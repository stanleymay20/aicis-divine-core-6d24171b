import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Settings2 } from "lucide-react";
import { MiniStat, type DomainPolicy, type DomainRow } from "./atoms";

export function MatchPolicyCoverage({ policies, domains, matchQuality }: {
  policies: DomainPolicy[]; domains: DomainRow[]; matchQuality: any;
}) {
  const activePolicies = policies.filter(p => p.is_active);
  const domainNames = domains.map(d => d.domain);
  const coveredDomains = domainNames.filter(d => activePolicies.some(p => p.domain === d));
  const fallbackDomains = domainNames.filter(d => !activePolicies.some(p => p.domain === d));
  const fallbackRate = domainNames.length > 0 ? Math.round((fallbackDomains.length / domainNames.length) * 100) : 0;
  const liveFallback = matchQuality?.fallback_rate_pct ?? fallbackRate;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Settings2 className="h-4 w-4" /> Match Policy Coverage
          <Badge variant="outline" className={`ml-auto text-[10px] ${fallbackRate > 30 ? "text-yellow-400" : "text-emerald-400"}`}>
            {fallbackRate === 0 ? "Full Coverage" : `${fallbackRate}% fallback`}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <MiniStat label="Active policies" value={activePolicies.length} />
          <MiniStat label="Domains with policy" value={coveredDomains.length} />
          <MiniStat label="Domains on fallback" value={fallbackDomains.length} warn={fallbackDomains.length > 0} />
          <MiniStat label="Fallback rate" value={`${liveFallback}%`} warn={liveFallback > 30} />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Domain</TableHead>
              <TableHead className="text-right text-xs">Window (days)</TableHead>
              <TableHead className="text-right text-xs">Threshold %</TableHead>
              <TableHead className="text-xs">Period</TableHead>
              <TableHead className="text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activePolicies.map((p) => (
              <TableRow key={p.domain}>
                <TableCell className="text-xs font-medium">{p.domain}</TableCell>
                <TableCell className="text-right text-xs">{p.match_window_days}</TableCell>
                <TableCell className="text-right text-xs">{p.direction_threshold_pct}%</TableCell>
                <TableCell className="text-xs">{p.preferred_period_type ?? "—"}</TableCell>
                <TableCell><Badge variant="default" className="text-[10px]">Active</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {fallbackDomains.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1 font-medium">Domains needing policy tuning</p>
            <div className="flex flex-wrap gap-1">
              {fallbackDomains.map(d => <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>)}
            </div>
          </div>
        )}

        {matchQuality?.suspicious_domains?.length > 0 && (
          <div>
            <p className="text-xs text-destructive mb-1 font-medium">Suspicious domains (high missing rate or delay)</p>
            <div className="space-y-1">
              {matchQuality.suspicious_domains.map((s: any, i: number) => (
                <div key={i} className="text-xs bg-destructive/10 text-destructive rounded px-2 py-1">
                  <span className="font-medium">{s.domain}</span> — {s.reason === "high_missing_actual" ? `${s.missing_rate}% missing` : `avg delay ${s.avg_delay}d`}
                </div>
              ))}
            </div>
          </div>
        )}

        {matchQuality && matchQuality.sample_size > 0 && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <MiniStat label="Policy-backed matches" value={matchQuality.policy_backed_matches ?? 0} />
            <MiniStat label="Fallback matches" value={matchQuality.fallback_matches ?? 0} warn={(matchQuality.fallback_matches ?? 0) > 0} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
