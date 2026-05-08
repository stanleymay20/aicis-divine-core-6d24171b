import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  Shield, Users, Activity, Database, Settings, 
  AlertTriangle, CheckCircle, Clock,
  RefreshCw, TrendingUp, Lock, Globe, FileText,
  Server, Brain, Zap, Download, Code2, LayoutGrid, ChevronDown, ChevronUp
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AICISLayout } from "@/components/aicis/AICISLayout";

const AdminDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState("settings");
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  // Fetch system health
  const { data: systemHealth, refetch: refetchHealth } = useQuery({
    queryKey: ["admin-system-health"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_divisions")
        .select("*")
        .order("division_key");
      if (error) throw error;
      return data;
    },
  });

  // Fetch recent audit logs
  const { data: auditLogs } = useQuery({
    queryKey: ["admin-audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Fetch user roles
  const { data: userRoles } = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch organizations
  const { data: organizations } = useQuery({
    queryKey: ["admin-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch predictions count
  const { data: predictionsCount } = useQuery({
    queryKey: ["admin-predictions-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("predictions")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  // Fetch alerts count
  const { data: alertsCount } = useQuery({
    queryKey: ["admin-alerts-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .eq("acknowledged", false);
      if (error) throw error;
      return count || 0;
    },
  });

  // Trigger predictions
  const triggerPredictions = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-predictions");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Predictions Generated",
        description: `Successfully generated ${data.predictions_generated} predictions`,
      });
      queryClient.invalidateQueries({ queryKey: ["admin-predictions-count"] });
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Trigger data sync
  const triggerDataSync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("seed-live-data");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Data Sync Complete",
        description: "Live data has been refreshed from global sources",
      });
      refetchHealth();
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Run vulnerability scan
  const runVulnerabilityScan = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("calculate-vulnerability");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Vulnerability Scan Complete",
        description: "All regions have been analyzed",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Scan Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const activeDivisions = systemHealth?.filter(d => d.status === "active").length || 0;
  const totalDivisions = systemHealth?.length || 0;

  return (
    <AICISLayout>
      <div className="p-6 container mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Settings className="h-6 w-6 text-primary" />
              <div>
                <h1 className="text-xl font-semibold">Settings</h1>
                <p className="text-xs text-muted-foreground">Account, export, developer, and system access.</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => navigate("/data-export")}> 
              <Download className="h-4 w-4" /> Data Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/developers")}>
              <Code2 className="h-4 w-4" /> Developer & API
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/advanced")}>
              <LayoutGrid className="h-4 w-4" /> Advanced
            </Button>
          </div>
        </div>


        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <TabsList className="justify-start overflow-x-auto flex-nowrap">
              <TabsTrigger value="settings">
                <Settings className="w-4 h-4 mr-2" />
                Account
              </TabsTrigger>
              <TabsTrigger value="overview">
                <Activity className="w-4 h-4 mr-2" />
                Status
              </TabsTrigger>
              {showAdvancedTools && (
                <>
                  <TabsTrigger value="divisions"><Brain className="w-4 h-4 mr-2" />Divisions</TabsTrigger>
                  <TabsTrigger value="users"><Users className="w-4 h-4 mr-2" />Users</TabsTrigger>
                  <TabsTrigger value="audit"><FileText className="w-4 h-4 mr-2" />Audit</TabsTrigger>
                  <TabsTrigger value="actions"><Zap className="w-4 h-4 mr-2" />Actions</TabsTrigger>
                </>
              )}
            </TabsList>
            <Button variant="ghost" size="sm" onClick={() => setShowAdvancedTools(v => !v)}>
              {showAdvancedTools ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showAdvancedTools ? "Hide admin tools" : "Admin tools"}
            </Button>
          </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Active Divisions</p>
                      <p className="text-3xl font-bold text-primary">{activeDivisions}/{totalDivisions}</p>
                    </div>
                    <Brain className="h-8 w-8 text-primary/50" />
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Active Alerts</p>
                      <p className="text-3xl font-bold text-destructive">{alertsCount}</p>
                    </div>
                    <AlertTriangle className="h-8 w-8 text-destructive/50" />
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Predictions</p>
                      <p className="text-3xl font-bold text-primary">{predictionsCount}</p>
                    </div>
                    <TrendingUp className="h-8 w-8 text-primary/50" />
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Organizations</p>
                      <p className="text-3xl font-bold text-primary">{organizations?.length || 0}</p>
                    </div>
                    <Globe className="h-8 w-8 text-primary/50" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>System maintenance and data operations</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button 
                  onClick={() => triggerDataSync.mutate()}
                  disabled={triggerDataSync.isPending}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${triggerDataSync.isPending ? 'animate-spin' : ''}`} />
                  Sync Live Data
                </Button>
                <Button 
                  onClick={() => triggerPredictions.mutate()}
                  disabled={triggerPredictions.isPending}
                  variant="secondary"
                >
                  <Brain className={`w-4 h-4 mr-2 ${triggerPredictions.isPending ? 'animate-pulse' : ''}`} />
                  Generate Predictions
                </Button>
                <Button 
                  onClick={() => runVulnerabilityScan.mutate()}
                  disabled={runVulnerabilityScan.isPending}
                  variant="outline"
                >
                  <Shield className={`w-4 h-4 mr-2 ${runVulnerabilityScan.isPending ? 'animate-pulse' : ''}`} />
                  Run Vulnerability Scan
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Divisions Tab */}
          <TabsContent value="divisions" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">AI Divisions Status</h2>
              <Button variant="outline" size="sm" onClick={() => refetchHealth()}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {systemHealth?.map((division) => (
                <Card key={division.id} className={`${division.status === 'active' ? 'border-success/30' : 'border-destructive/30'}`}>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold capitalize">{division.division_key}</h3>
                      <Badge variant={division.status === 'active' ? 'default' : 'destructive'}>
                        {division.status}
                      </Badge>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Performance</span>
                        <span className="font-medium">{division.performance_score?.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Uptime</span>
                        <span className="font-medium">{division.uptime_percentage?.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Check</span>
                        <span className="font-mono text-xs">
                          {new Date(division.last_check).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>User Roles</CardTitle>
                <CardDescription>Manage user permissions and access levels</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {userRoles?.length === 0 && (
                      <p className="text-muted-foreground text-center py-8">No user roles configured</p>
                    )}
                    {userRoles?.map((role: any) => (
                      <div key={role.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="font-medium">{role.user_id}</p>
                          <p className="text-sm text-muted-foreground">
                            Created: {new Date(role.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge>{role.role}</Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit Log Tab */}
          <TabsContent value="audit" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Audit Trail</CardTitle>
                <CardDescription>Complete log of system actions and events</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {auditLogs?.length === 0 && (
                      <p className="text-muted-foreground text-center py-8">No audit logs available</p>
                    )}
                    {auditLogs?.map((log: any) => (
                      <div key={log.id} className="flex items-start gap-3 p-3 border rounded-lg">
                        <div className={`p-2 rounded-full ${
                          log.severity === 'error' ? 'bg-destructive/20' : 
                          log.severity === 'warn' ? 'bg-warning/20' : 'bg-primary/20'
                        }`}>
                          {log.severity === 'error' ? (
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                          ) : (
                            <CheckCircle className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <p className="font-medium">{log.action}</p>
                            <span className="text-xs text-muted-foreground font-mono">
                              {new Date(log.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {log.resource_type}: {log.resource_id}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Actions Tab */}
          <TabsContent value="actions" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Data Operations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button 
                    className="w-full justify-start" 
                    variant="outline"
                    onClick={() => triggerDataSync.mutate()}
                  >
                    <Database className="w-4 h-4 mr-2" />
                    Sync All Global Data Sources
                  </Button>
                  <Button 
                    className="w-full justify-start" 
                    variant="outline"
                    onClick={() => triggerPredictions.mutate()}
                  >
                    <TrendingUp className="w-4 h-4 mr-2" />
                    Generate AI Predictions
                  </Button>
                  <Button 
                    className="w-full justify-start" 
                    variant="outline"
                    onClick={() => runVulnerabilityScan.mutate()}
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Calculate Vulnerability Scores
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>System Operations</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button 
                    className="w-full justify-start" 
                    variant="outline"
                    onClick={async () => {
                      const { error } = await supabase.functions.invoke("aicis-self-heal");
                      if (!error) toast({ title: "Self-heal initiated" });
                    }}
                  >
                    <Server className="w-4 h-4 mr-2" />
                    Run Self-Healing Diagnostics
                  </Button>
                  <Button 
                    className="w-full justify-start" 
                    variant="outline"
                    onClick={async () => {
                      const { error } = await supabase.functions.invoke("cron-daily-learn");
                      if (!error) toast({ title: "Learning cycle initiated" });
                    }}
                  >
                    <Brain className="w-4 h-4 mr-2" />
                    Trigger Learning Cycle
                  </Button>
                  <Button 
                    className="w-full justify-start" 
                    variant="outline"
                    onClick={async () => {
                      const { error } = await supabase.functions.invoke("compute-trust-metrics");
                      if (!error) toast({ title: "Trust metrics computed" });
                    }}
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    Compute Trust Metrics
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>System Configuration</CardTitle>
                <CardDescription>Configure AICIS platform settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>Platform Mode</Label>
                    <div className="flex gap-2">
                      <Badge variant="default">Production</Badge>
                      <Badge variant="outline">Enterprise</Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Data Retention</Label>
                    <p className="text-sm text-muted-foreground">90 days for operational data, 7 years for compliance</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Federation Status</Label>
                    <Badge variant="secondary">Enabled</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AICISLayout>
  );
};

export default AdminDashboard;
