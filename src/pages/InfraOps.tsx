import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Database, Activity, AlertTriangle, Server, Clock, BarChart3 } from "lucide-react";
import { PanelEmpty } from "@/components/ui/panel-empty";

const tierColors: Record<string, string> = {
  hot: "bg-destructive/10 text-destructive border-destructive/20",
  warm: "bg-warning/10 text-warning border-warning/20",
  cold: "bg-muted text-muted-foreground border-border",
  audit: "bg-primary/10 text-primary border-primary/20",
};

const statusColors: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  dormant: "secondary",
  reserved: "outline",
  deprecated: "destructive",
};

const critColors: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  critical: "destructive",
  important: "default",
  low: "outline",
  experimental: "secondary",
};

const InfraOps = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  const { data: registry, isLoading } = useQuery({
    queryKey: ["data-lifecycle-registry"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_lifecycle_registry")
        .select("*")
        .order("criticality", { ascending: true })
        .order("tier", { ascending: true })
        .order("table_name", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: pipelines } = useQuery({
    queryKey: ["pipeline-health"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pipeline_health")
        .select("*")
        .order("pipeline_name");
      return data || [];
    },
    enabled: !!user,
  });

  if (authLoading || !user) return null;

  const byTier = (tier: string) => registry?.filter((r: any) => r.tier === tier) || [];
  const byStatus = (status: string) => registry?.filter((r: any) => r.status === status) || [];

  return (
    <AICISLayout>
      <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-orbitron font-bold flex items-center gap-3">
            <Server className="h-7 w-7 text-primary" />
            Infrastructure Operations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Data lifecycle registry, pipeline health, and platform sustainability metrics
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xl font-orbitron font-bold">{registry?.length || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Tracked Tables</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xl font-orbitron font-bold text-destructive">{byTier("hot").length}</p>
                  <p className="text-[10px] text-muted-foreground">Hot (Live)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xl font-orbitron font-bold text-warning">{byTier("warm").length}</p>
                  <p className="text-[10px] text-muted-foreground">Warm (Analytics)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xl font-orbitron font-bold text-muted-foreground">{byTier("cold").length}</p>
                  <p className="text-[10px] text-muted-foreground">Cold (Archive)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xl font-orbitron font-bold text-primary">{byTier("audit").length}</p>
                  <p className="text-[10px] text-muted-foreground">Audit (Immutable)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-xl font-orbitron font-bold text-success">{byStatus("active").length}</p>
                  <p className="text-[10px] text-muted-foreground">Active</p>
                </CardContent>
              </Card>
            </div>

            {/* Status distribution */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {["active", "dormant", "reserved", "deprecated"].map(s => (
                <Card key={s}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <span className="text-xs capitalize">{s}</span>
                    <Badge variant={statusColors[s]} className="text-[10px]">{byStatus(s).length}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Data Lifecycle Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Data Lifecycle Registry
                </CardTitle>
                <CardDescription className="text-xs">
                  Every governed dataset with tier, status, criticality, and retention policy
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(!registry || registry.length === 0) ? (
                  <PanelEmpty
                    title="No datasets registered"
                    reason="The data_lifecycle_registry table is empty. Every governed dataset must be enrolled before it appears here."
                    nextStep="Run the lifecycle-registry seed migration or add entries via the admin migration toolkit."
                  />
                ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-medium text-muted-foreground">Table</th>
                        <th className="text-center py-2 font-medium text-muted-foreground">Tier</th>
                        <th className="text-center py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-center py-2 font-medium text-muted-foreground">Criticality</th>
                        <th className="text-left py-2 font-medium text-muted-foreground">Source</th>
                        <th className="text-center py-2 font-medium text-muted-foreground">Refresh</th>
                        <th className="text-center py-2 font-medium text-muted-foreground">Retention</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registry?.map((r: any) => (
                        <tr key={r.id} className="border-b border-border/20 hover:bg-muted/20">
                          <td className="py-2 font-mono text-[11px]">{r.table_name}</td>
                          <td className="py-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] border ${tierColors[r.tier] || ""}`}>
                              {r.tier}
                            </span>
                          </td>
                          <td className="py-2 text-center">
                            <Badge variant={statusColors[r.status] || "outline"} className="text-[10px]">{r.status}</Badge>
                          </td>
                          <td className="py-2 text-center">
                            <Badge variant={critColors[r.criticality] || "outline"} className="text-[10px]">{r.criticality}</Badge>
                          </td>
                          <td className="py-2 text-muted-foreground text-[10px] max-w-[120px] truncate">{r.source || "—"}</td>
                          <td className="py-2 text-center text-[10px] text-muted-foreground">{r.refresh_frequency || "—"}</td>
                          <td className="py-2 text-center text-[10px] text-muted-foreground">
                            {r.retention_days ? `${r.retention_days}d` : "∞"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Pipeline Health */}
            {pipelines && pipelines.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Pipeline Health
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pipelines.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between border-b border-border/20 py-2">
                        <span className="text-xs font-mono">{p.pipeline_name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={p.status === "healthy" ? "default" : p.status === "degraded" ? "secondary" : "destructive"} className="text-[10px]">
                            {p.status}
                          </Badge>
                          {p.consecutive_failures > 0 && (
                            <span className="text-[10px] text-destructive">{p.consecutive_failures} failures</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Ops principles */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
                <p className="font-bold text-foreground flex items-center gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5 text-primary" />
                  Infrastructure Governance Principles
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Hot:</strong> Live dashboards, current intelligence — indexed aggressively, queried frequently</li>
                  <li><strong>Warm:</strong> Analytics and validation — queryable but less performance-sensitive (3–12 months)</li>
                  <li><strong>Cold:</strong> Historical archive — compressed, not needed for live UX</li>
                  <li><strong>Audit:</strong> Immutable evidence — forecast archives, decision logs, methodology snapshots — append-only</li>
                  <li><strong>Rule:</strong> If a feed does not improve decisions, it should not enter production</li>
                </ul>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AICISLayout>
  );
};

export default InfraOps;
