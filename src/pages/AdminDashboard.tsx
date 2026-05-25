import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, Brain, Code2, Download, FileText, LayoutGrid, Settings,
  Users, Zap, ChevronDown, ChevronUp,
} from "lucide-react";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { OverviewTab } from "@/components/admin-dashboard/OverviewTab";
import { DivisionsTab } from "@/components/admin-dashboard/DivisionsTab";
import { ActionsTab } from "@/components/admin-dashboard/ActionsTab";
import {
  AuditTab,
  SettingsTab,
  UsersTab,
} from "@/components/admin-dashboard/UsersAuditSettingsTabs";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState("settings");
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  const { data: systemHealth, refetch: refetchHealth } = useQuery({
    queryKey: ["admin-system-health"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ai_divisions").select("*").order("division_key");
      if (error) throw error;
      return data;
    },
  });

  const { data: auditLogs } = useQuery({
    queryKey: ["admin-audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: organizations } = useQuery({
    queryKey: ["admin-organizations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: predictionsCount } = useQuery({
    queryKey: ["admin-predictions-count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("predictions").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: alertsCount } = useQuery({
    queryKey: ["admin-alerts-count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("alerts").select("*", { count: "exact", head: true }).eq("acknowledged", false);
      if (error) throw error;
      return count || 0;
    },
  });

  const triggerPredictions = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-predictions");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Predictions Generated", description: `Successfully generated ${data.predictions_generated} predictions` });
      queryClient.invalidateQueries({ queryKey: ["admin-predictions-count"] });
    },
    onError: (error: any) => toast({ title: "Generation Failed", description: error.message, variant: "destructive" }),
  });

  const triggerDataSync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("seed-live-data");
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast({ title: "Data Sync Complete", description: "Live data has been refreshed from global sources" });
      refetchHealth();
    },
    onError: (error: any) => toast({ title: "Sync Failed", description: error.message, variant: "destructive" }),
  });

  const runVulnerabilityScan = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("calculate-vulnerability");
      if (error) throw error;
      return data;
    },
    onSuccess: () => toast({ title: "Vulnerability Scan Complete", description: "All regions have been analyzed" }),
    onError: (error: any) => toast({ title: "Scan Failed", description: error.message, variant: "destructive" }),
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
            <Button variant="outline" size="sm" onClick={() => navigate("/data-export")}><Download className="h-4 w-4" /> Data Export</Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/developers")}><Code2 className="h-4 w-4" /> Developer & API</Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/advanced")}><LayoutGrid className="h-4 w-4" /> Advanced</Button>
          </div>
        </div>

        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
            <TabsList className="justify-start overflow-x-auto flex-nowrap">
              <TabsTrigger value="settings"><Settings className="w-4 h-4 mr-2" />Account</TabsTrigger>
              <TabsTrigger value="overview"><Activity className="w-4 h-4 mr-2" />Status</TabsTrigger>
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

          <TabsContent value="overview">
            <OverviewTab
              activeDivisions={activeDivisions}
              totalDivisions={totalDivisions}
              alertsCount={alertsCount}
              predictionsCount={predictionsCount}
              organizationsCount={organizations?.length || 0}
              onSyncData={() => triggerDataSync.mutate()}
              onGeneratePredictions={() => triggerPredictions.mutate()}
              onRunVulnScan={() => runVulnerabilityScan.mutate()}
              isSyncing={triggerDataSync.isPending}
              isGenerating={triggerPredictions.isPending}
              isScanning={runVulnerabilityScan.isPending}
            />
          </TabsContent>
          <TabsContent value="divisions"><DivisionsTab systemHealth={systemHealth} onRefetch={refetchHealth} /></TabsContent>
          <TabsContent value="users"><UsersTab userRoles={userRoles} /></TabsContent>
          <TabsContent value="audit"><AuditTab auditLogs={auditLogs} /></TabsContent>
          <TabsContent value="actions">
            <ActionsTab
              onSyncData={() => triggerDataSync.mutate()}
              onGeneratePredictions={() => triggerPredictions.mutate()}
              onRunVulnScan={() => runVulnerabilityScan.mutate()}
            />
          </TabsContent>
          <TabsContent value="settings"><SettingsTab /></TabsContent>
        </Tabs>
      </div>
    </AICISLayout>
  );
};

export default AdminDashboard;
