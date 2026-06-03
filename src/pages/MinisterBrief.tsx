import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { ConfidenceBadge } from "@/components/sovereign/ConfidenceBadge";
import { CitationChipList } from "@/components/sovereign/CitationChip";
import { useSovereignStats, formatRelativeTime } from "@/lib/sovereign/useSovereignStats";
import { humanize } from "@/lib/humanize-vocab";
import { t } from "@/lib/i18n";
import { Printer, FileDown, Share2, Shield } from "lucide-react";
import { useViewMode } from "@/contexts/ExecutiveModeContext";
import { ViewModeToggle } from "@/components/sovereign/ViewModeToggle";

interface BriefData {
  topWarnings: any[];
  emergingRisks: any[];
  recommendedActions: any[];
  citations: any[];
}

async function fetchBrief(): Promise<BriefData> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  const [warnings, risks, actions, cites] = await Promise.all([
    supabase.from("aicis_early_warnings")
      .select("id, country_iso3, domain, signal_type, severity, summary, detected_at")
      .gte("detected_at", since).order("severity", { ascending: false }).limit(5),
    supabase.from("risk_ranking_predictions")
      .select("country_iso3, domain, score, direction, prediction_horizon_days, created_at")
      .order("score", { ascending: false }).limit(5),
    supabase.from("risk_action_recommendations")
      .select("id, country_iso3, domain, intervention_type, urgency_window, roi_euro, rationale, status, created_at")
      .eq("status", "pending").order("created_at", { ascending: false }).limit(5),
    supabase.from("intelligence_citations")
      .select("source_name, source_url, confidence_weight, authority_tier")
      .order("created_at", { ascending: false }).limit(12),
  ]);

  return {
    topWarnings: warnings.data ?? [],
    emergingRisks: risks.data ?? [],
    recommendedActions: actions.data ?? [],
    citations: cites.data ?? [],
  };
}

export default function MinisterBrief() {
  const { mode } = useViewMode();
  const { data: stats } = useSovereignStats();
  const { data, isLoading } = useQuery({ queryKey: ["minister-brief"], queryFn: fetchBrief, staleTime: 60_000 });

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const handlePrint = () => window.print();
  const handleShare = async () => {
    const url = window.location.href;
    try { await navigator.clipboard.writeText(url); alert("Secure link copied to clipboard"); }
    catch { alert(url); }
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Minister Brief — AICIS" description="Daily executive intelligence briefing — top developments, emerging risks, recommended actions." path="/brief/today" />

      <div className="max-w-5xl mx-auto px-4 py-6 print:py-2 print:max-w-none">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4 print:mb-2">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-primary">{t("sovereign.classification")}</div>
            <h1 className="text-2xl font-bold mt-1">{t("brief.title")}</h1>
            <div className="text-sm text-muted-foreground">{today}</div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <ViewModeToggle />
            <Button size="sm" variant="outline" onClick={handlePrint}><Printer className="h-3.5 w-3.5 mr-1" /> {t("brief.print")}</Button>
            <Button size="sm" variant="outline" onClick={handlePrint}><FileDown className="h-3.5 w-3.5 mr-1" /> {t("brief.export_pdf")}</Button>
            <Button size="sm" variant="outline" onClick={handleShare}><Share2 className="h-3.5 w-3.5 mr-1" /> {t("brief.share_secure")}</Button>
          </div>
        </div>

        {/* Executive Summary */}
        <Card className="mb-4">
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("brief.executive_summary")}</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            {isLoading ? <div className="text-muted-foreground">Compiling brief…</div> : (
              <p>
                In the past 24 hours, AICIS detected <strong>{data?.topWarnings.length ?? 0}</strong> early warnings and
                surfaced <strong>{data?.recommendedActions.length ?? 0}</strong> recommended actions across tracked markets.
                Ranked risk outlook shows <strong>{data?.emergingRisks.length ?? 0}</strong> country-domain pairs in the top tier.
                Audit ledger holds <strong>{stats?.ledgerEntries ?? 0}</strong> hash-chained entries; last federation signature {formatRelativeTime(stats?.lastSignedAt ?? null)}.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Top Developments */}
        <Card className="mb-4">
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("brief.top_developments")}</CardTitle></CardHeader>
          <CardContent>
            {data?.topWarnings.length === 0 ? (
              <div className="text-sm text-muted-foreground">No new early warnings in the past 24 hours.</div>
            ) : (
              <ul className="space-y-3 text-sm">
                {data?.topWarnings.map((w) => (
                  <li key={w.id} className="border-l-2 border-primary pl-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{w.country_iso3}</span>
                      <span className="font-semibold">{humanize(w.domain, mode)}</span>
                      <span className="text-xs text-muted-foreground">· {humanize(w.signal_type, mode)}</span>
                      <ConfidenceBadge value={Math.min(1, (w.severity ?? 0) / 100)} label="Severity" />
                    </div>
                    {w.summary && <p className="text-muted-foreground mt-1">{w.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Emerging Risks */}
        <Card className="mb-4">
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("brief.emerging_risks")}</CardTitle></CardHeader>
          <CardContent>
            {data?.emergingRisks.length === 0 ? (
              <div className="text-sm text-muted-foreground">No ranked risks above threshold.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {data?.emergingRisks.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 border-b border-border/50 pb-2 last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted">{r.country_iso3}</span>
                      <span className="font-medium">{humanize(r.domain, mode)}</span>
                      <span className="text-xs text-muted-foreground">{r.direction} · {r.prediction_horizon_days}d horizon</span>
                    </div>
                    <ConfidenceBadge value={Math.min(1, Math.abs(r.score ?? 0))} label="Risk Score" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recommended Actions */}
        <Card className="mb-4">
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("brief.recommended_actions")}</CardTitle></CardHeader>
          <CardContent>
            {data?.recommendedActions.length === 0 ? (
              <div className="text-sm text-muted-foreground">No pending recommended actions.</div>
            ) : (
              <ol className="space-y-2 text-sm list-decimal list-inside">
                {data?.recommendedActions.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{humanize(a.intervention_type ?? "Action", mode)}</span>
                    <span className="text-muted-foreground"> · {a.country_iso3} · {a.urgency_window}</span>
                    {a.roi_euro != null && <span className="ml-2 font-mono text-xs text-emerald-600">€{Math.round(a.roi_euro).toLocaleString()}</span>}
                    {a.rationale && <p className="text-muted-foreground text-xs mt-0.5 ml-5">{a.rationale}</p>}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Source Appendix */}
        <Card className="mb-4">
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("brief.source_appendix")}</CardTitle></CardHeader>
          <CardContent>
            <CitationChipList citations={data?.citations ?? []} max={20} />
            <p className="text-[10px] font-mono text-muted-foreground mt-3">
              Citations linked to underlying signals via SHA-256 provenance hashing. Tier-1/2 = official statistical, central-bank, or sanctions authorities.
            </p>
          </CardContent>
        </Card>

        {/* Federation Signature */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base inline-flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" /> {t("brief.federation_signature")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs font-mono space-y-1">
            <div>Algorithm: <span className="text-foreground">Ed25519</span></div>
            <div>Active keys: <span className="text-foreground">{stats?.activeKeys ?? 0}</span></div>
            <div>Last signed: <span className="text-foreground">{formatRelativeTime(stats?.lastSignedAt ?? null)}</span></div>
            <div>Ledger entries: <span className="text-foreground">{stats?.ledgerEntries ?? 0}</span></div>
            <div className="pt-2 text-muted-foreground">
              This brief can be cryptographically signed by the federation key and verified by recipient nodes. Verification endpoint: <code>federation-verify-bundle</code>.
            </div>
          </CardContent>
        </Card>

        <div className="text-center mt-6 text-[10px] font-mono uppercase tracking-widest text-primary print:mt-2">
          {t("sovereign.classification")}
        </div>
      </div>

      <style>{`@media print { header, footer, nav, aside { display: none !important; } body { background: white !important; } }`}</style>
    </div>
  );
}
