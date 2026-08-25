import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle, Lock, Globe, TrendingUp, FileCheck, type LucideIcon } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface TrustMetric {
  id: string;
  metric_type: string;
  metric_value: number | string;
  metric_unit: string | null;
  computed_at: string;
  signature: string | null;
  metadata: Record<string, unknown> | null;
}

interface TransparencyReport {
  published_at: string;
  total_users: number | null;
  total_decisions: number | null;
  gdpr_requests_count: number | null;
  data_breaches_count: number | null;
  signed_hash: string | null;
}

interface MetricPresentation {
  label: string;
  description: string;
  icon: LucideIcon;
}

const SUPPORTED_METRICS = [
  "ai_recorded_confidence",
  "ledger_root_generated_24h",
  "active_consent_ratio",
  "sdg_progress_index",
  "automation_success_rate_24h",
] as const;

const metricPresentation: Record<string, MetricPresentation> = {
  ai_recorded_confidence: {
    label: "Recorded AI Confidence",
    description: "Mean confidence recorded on recent AI decision logs; not an accuracy or trust certification.",
    icon: Shield,
  },
  ledger_root_generated_24h: {
    label: "Ledger Root Generated (24h)",
    description: "Operational presence check for a recent ledger root; not proof that every ledger entry is valid.",
    icon: CheckCircle,
  },
  active_consent_ratio: {
    label: "Active Consent Record Ratio",
    description: "Share of stored consent records that are not revoked; not a GDPR compliance score.",
    icon: Lock,
  },
  sdg_progress_index: {
    label: "Recorded SDG Progress Mean",
    description: "Mean of SDG progress percentages currently recorded by AICIS.",
    icon: Globe,
  },
  automation_success_rate_24h: {
    label: "Automation Success Rate (24h)",
    description: "Share of completed automation logs marked successful in the last 24 hours; not infrastructure uptime.",
    icon: TrendingUp,
  },
};

function metricColor(value: number): string {
  if (value >= 95) return "text-success";
  if (value >= 85) return "text-warning";
  return "text-destructive";
}

function metricGlow(value: number): string {
  if (value >= 95) return "bg-success/10";
  if (value >= 85) return "bg-warning/10";
  return "bg-destructive/10";
}

function metadataText(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

export const TrustPortal = () => {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ["trust-metrics"],
    queryFn: async (): Promise<Record<string, TrustMetric>> => {
      const { data, error } = await supabase
        .from("trust_metrics")
        .select("id, metric_type, metric_value, metric_unit, computed_at, signature, metadata")
        .in("metric_type", [...SUPPORTED_METRICS])
        .order("computed_at", { ascending: false })
        .limit(50);
      if (error) throw error;

      const latest: Record<string, TrustMetric> = {};
      for (const row of (data ?? []) as TrustMetric[]) {
        if (!latest[row.metric_type]) latest[row.metric_type] = row;
      }
      return latest;
    },
  });

  const { data: latestReport } = useQuery({
    queryKey: ["transparency-reports"],
    queryFn: async (): Promise<TransparencyReport | null> => {
      const { data, error } = await supabase
        .from("transparency_reports")
        .select("published_at, total_users, total_decisions, gdpr_requests_count, data_breaches_count, signed_hash")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as TransparencyReport | null;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="h-8 w-8 text-primary" />
          Public Trust & Evidence Portal
        </h2>
        <p className="text-muted-foreground mt-1">
          Operational evidence with explicit measurement boundaries. These indicators are not legal, security, or certification attestations.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full text-center py-8">Loading measured trust indicators...</div>
        ) : Object.keys(metrics ?? {}).length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="p-8 text-center text-muted-foreground">
              No current measured trust indicators are available yet.
            </CardContent>
          </Card>
        ) : (
          Object.entries(metrics ?? {}).map(([type, metric]) => {
            const presentation = metricPresentation[type] ?? {
              label: type,
              description: "Measured operational indicator.",
              icon: FileCheck,
            };
            const Icon = presentation.icon;
            const value = Math.max(0, Math.min(100, Number(metric.metric_value)));
            const sampleSize = metadataText(metric.metadata, "sample_size");

            return (
              <Card key={type} className="relative overflow-hidden">
                <div className={`absolute top-0 right-0 w-32 h-32 ${metricGlow(value)} rounded-full blur-3xl -mr-16 -mt-16`} />
                <CardHeader className="relative">
                  <CardTitle className="flex items-center justify-between text-sm font-medium">
                    <span>{presentation.label}</span>
                    <Icon className={`h-4 w-4 ${metricColor(value)}`} />
                  </CardTitle>
                  <CardDescription>{presentation.description}</CardDescription>
                </CardHeader>
                <CardContent className="relative">
                  <div className="space-y-2">
                    <div className={`text-3xl font-bold ${metricColor(value)}`}>{value.toFixed(1)}%</div>
                    <Progress value={value} className="h-2" />
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>Updated {new Date(metric.computed_at).toLocaleString()}</span>
                      {metric.signature && (
                        <Badge variant="outline" className="text-[10px]">
                          <Lock className="h-2 w-2 mr-1" /> SHA-256 digest
                        </Badge>
                      )}
                    </div>
                    {sampleSize && <div className="text-xs text-muted-foreground">Sample size: {sampleSize}</div>}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Governance Controls & Measurement Boundaries
          </CardTitle>
          <CardDescription>
            What AICIS currently records and what those records do—and do not—prove.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Observed controls</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Consent records include revocation state.</li>
                <li>• DPIA and data-use-agreement records are supported.</li>
                <li>• Ledger roots and operational automation results are recorded.</li>
                <li>• Published transparency reports are stored separately from live metrics.</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Important boundaries</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• A database control does not by itself establish GDPR or AI Act compliance.</li>
                <li>• A ledger root does not by itself prove full ledger integrity.</li>
                <li>• A SHA-256 digest is an integrity marker, not proof of signer identity.</li>
                <li>• Certification claims require external evidence and are not inferred from these metrics.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {latestReport && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" /> Latest Published Transparency Report
            </CardTitle>
            <CardDescription>Published {new Date(latestReport.published_at).toLocaleDateString()}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4 mb-4">
              <div>
                <div className="text-sm text-muted-foreground">Total Users</div>
                <div className="text-2xl font-bold">{latestReport.total_users ?? 0}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">AI Decisions</div>
                <div className="text-2xl font-bold">{latestReport.total_decisions ?? 0}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Recorded GDPR Requests</div>
                <div className="text-2xl font-bold">{latestReport.gdpr_requests_count ?? 0}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Recorded Data Breaches</div>
                <div className={`text-2xl font-bold ${(latestReport.data_breaches_count ?? 0) === 0 ? "text-success" : "text-destructive"}`}>
                  {latestReport.data_breaches_count ?? 0}
                </div>
              </div>
            </div>
            {latestReport.signed_hash && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                <span>Stored report hash: {latestReport.signed_hash.substring(0, 32)}...</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="text-center text-sm text-muted-foreground border-t pt-6">
        <p className="font-semibold">Transparency requires evidence and boundaries.</p>
        <p>AICIS reports what its systems can demonstrate and leaves external certification to qualified independent assessment.</p>
      </div>
    </div>
  );
};
