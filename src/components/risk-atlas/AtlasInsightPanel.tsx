import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  X, TrendingUp, TrendingDown, Minus, AlertTriangle, ArrowRight,
  Bookmark, FileText, MapPin, Eye, Globe, Shield,
} from "lucide-react";
import { MapQuery } from "./queryParser";
import { SignalRow } from "./useAtlasData";

const DOMAIN_COLORS: Record<string, string> = {
  climate: "#06b6d4", education: "#8b5cf6", energy: "#f59e0b",
  finance: "#10b981", food: "#ef4444", governance: "#6366f1",
  health: "#ec4899", population: "#78716c", security: "#dc2626",
};

function riskColor(score: number): string {
  if (score >= 70) return "#ef4444";
  if (score >= 55) return "#f97316";
  if (score >= 40) return "#eab308";
  if (score >= 25) return "#facc15";
  return "#22c55e";
}

function riskLabel(score: number): string {
  if (score >= 70) return "Critical";
  if (score >= 55) return "High";
  if (score >= 40) return "Elevated";
  if (score >= 25) return "Moderate";
  return "Low";
}

interface CountryAgg {
  iso3: string;
  avgRisk: number;
  maxRisk: number;
  domains: number;
  direction: string;
  domainBreakdown: { domain: string; risk: number; direction: string }[];
}

interface Props {
  query: MapQuery;
  selectedCountry: string | null;
  countryData: CountryAgg | null;
  countryName: string | null;
  topCountries: CountryAgg[];
  signals: SignalRow[];
  onClose: () => void;
  onSelectCountry: (iso3: string) => void;
}

export function AtlasInsightPanel({
  query, selectedCountry, countryData, countryName,
  topCountries, signals, onClose, onSelectCountry,
}: Props) {
  const DirIcon = ({ dir }: { dir: string }) =>
    dir === "up" ? <TrendingUp className="w-3 h-3 text-destructive" />
    : dir === "down" ? <TrendingDown className="w-3 h-3 text-green-500" />
    : <Minus className="w-3 h-3 text-muted-foreground" />;

  return (
    <div className="w-80 lg:w-96 border-l border-border bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            {countryName ? countryName : "Insight Panel"}
          </span>
        </div>
        <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground" /></button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Query summary */}
          {query.raw && (
            <Card className="bg-muted/30 border-border">
              <CardContent className="p-3 space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Query</p>
                <p className="text-sm text-foreground">{query.raw}</p>
                <div className="flex gap-1 flex-wrap mt-1">
                  {query.domains.map(d => (
                    <Badge key={d} variant="outline" className="text-[10px] py-0">
                      <span className="w-1.5 h-1.5 rounded-full mr-1" style={{ background: DOMAIN_COLORS[d] }} />
                      {d}
                    </Badge>
                  ))}
                  {query.threshold && (
                    <Badge variant="destructive" className="text-[10px] py-0">≥{query.threshold}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Selected country detail */}
          {countryData && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: riskColor(countryData.avgRisk) + "20" }}>
                    <Globe className="w-4 h-4" style={{ color: riskColor(countryData.avgRisk) }} />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">{countryName}</p>
                    <p className="text-xs text-muted-foreground">{countryData.domains} domains</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold" style={{ color: riskColor(countryData.avgRisk) }}>
                    {countryData.avgRisk.toFixed(0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{riskLabel(countryData.avgRisk)}</p>
                </div>
              </div>

              {/* Domain breakdown */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Domain Breakdown</p>
                <div className="space-y-1.5">
                  {countryData.domainBreakdown.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DOMAIN_COLORS[d.domain] || "#666" }} />
                      <span className="text-xs text-foreground flex-1 capitalize">{d.domain}</span>
                      <DirIcon dir={d.direction} />
                      <span className="text-xs font-mono font-medium" style={{ color: riskColor(d.risk) }}>
                        {d.risk.toFixed(0)}
                      </span>
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(d.risk, 100)}%`, background: riskColor(d.risk) }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 text-xs gap-1">
                  <Bookmark className="w-3 h-3" /> Watch
                </Button>
                <Button variant="outline" size="sm" className="flex-1 text-xs gap-1">
                  <FileText className="w-3 h-3" /> Decision
                </Button>
              </div>
            </div>
          )}

          {/* Top affected countries */}
          {!selectedCountry && topCountries.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Highest Risk Markets
              </p>
              <div className="space-y-1">
                {topCountries.map((c, i) => (
                  <button
                    key={c.iso3}
                    onClick={() => onSelectCountry(c.iso3)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-left"
                  >
                    <span className="text-[10px] text-muted-foreground w-4">{i + 1}</span>
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: riskColor(c.avgRisk) }} />
                    <span className="text-xs text-foreground flex-1">{c.iso3}</span>
                    <DirIcon dir={c.direction} />
                    <span className="text-xs font-mono font-medium" style={{ color: riskColor(c.avgRisk) }}>
                      {c.avgRisk.toFixed(0)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Related Signals */}
          {signals.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Related Signals
              </p>
              <div className="space-y-2">
                {signals.slice(0, 5).map(s => (
                  <Card key={s.id} className="bg-muted/20 border-border">
                    <CardContent className="p-2.5 space-y-1">
                      <p className="text-xs font-medium text-foreground line-clamp-2">{s.title}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] py-0">{s.category}</Badge>
                        <span className="text-[10px] text-muted-foreground">
                          Impact: {s.impact_score}/100
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          Conf: {s.confidence_score}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Recommended actions when country selected */}
          {countryData && countryData.avgRisk >= 40 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Recommended Actions
              </p>
              <div className="space-y-1.5">
                {countryData.avgRisk >= 70 && (
                  <div className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="w-3 h-3 text-destructive shrink-0 mt-0.5" />
                    <span className="text-foreground">Immediate review of supply chain exposure in {countryName}</span>
                  </div>
                )}
                {countryData.avgRisk >= 55 && (
                  <div className="flex items-start gap-2 text-xs">
                    <Shield className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                    <span className="text-foreground">Activate contingency sourcing for affected corridors</span>
                  </div>
                )}
                <div className="flex items-start gap-2 text-xs">
                  <Eye className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                  <span className="text-foreground">Monitor trend direction — escalate if risk continues rising</span>
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!countryData && topCountries.length === 0 && (
            <div className="text-center py-8">
              <MapPin className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Type a query or click a country to see insights
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
