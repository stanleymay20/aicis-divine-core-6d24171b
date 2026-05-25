import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Book, Key, Terminal, Webhook } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, functionErrorMessage, EVENTS } from "@/components/developer-portal/constants";
import { PortalHeader } from "@/components/developer-portal/PortalHeader";
import { ApiDocsTab, SdkTab, UsageTab } from "@/components/developer-portal/DocsUsageSdkTabs";
import { KeysTab, WebhooksTab } from "@/components/developer-portal/KeysWebhooksTabs";

export default function DeveloperPortal() {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read"]);
  const [newKeyExpiry, setNewKeyExpiry] = useState<string>("365");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [workspaceName, setWorkspaceName] = useState("AICIS Developer Workspace");
  const [revealedKey, setRevealedKey] = useState<{ key: string; name: string } | null>(null);

  const copyToClipboard = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast.success(label); }
      catch { toast.error("Copy failed — select and copy manually"); }
      document.body.removeChild(ta);
    }
  };

  const toggleScope = (s: string) => {
    setNewKeyScopes((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const { data: org, isLoading: orgLoading } = useQuery({
    queryKey: ["user-org-dev"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase.functions.invoke("create-organization", {
        body: { name: workspaceName.trim() || "AICIS Developer Workspace" },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Unable to load developer access"));
      return data?.organization ?? null;
    },
  });

  const { data: apiKeys } = useQuery({
    queryKey: ["api-keys-dev", org?.id],
    enabled: !!org?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("api_keys")
        .select("id, name, key_prefix, created_at, last_used_at, revoked, rate_limit_per_minute, scopes, expires_at")
        .eq("org_id", org!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: webhooks } = useQuery({
    queryKey: ["webhooks-dev", org?.id],
    enabled: !!org?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("webhook_subscriptions")
        .select("*")
        .eq("org_id", org!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: usage } = useQuery({
    queryKey: ["api-usage", org?.id],
    enabled: !!org?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("api_request_audit")
        .select("endpoint, method, response_status, latency_ms, created_at")
        .eq("org_id", org!.id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      const rows = data || [];
      const day = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
      const last24h = rows.filter(r => new Date(r.created_at!).getTime() >= day);
      const errors24h = last24h.filter(r => r.response_status >= 400).length;
      const lats = last24h.map(r => r.latency_ms || 0).filter(n => n > 0).sort((a, b) => a - b);
      const p = (q: number) => lats.length ? lats[Math.min(lats.length - 1, Math.floor(lats.length * q))] : 0;
      const endpointCounts: Record<string, number> = {};
      last24h.forEach(r => {
        const k = `${r.method} ${r.endpoint}`;
        endpointCounts[k] = (endpointCounts[k] || 0) + 1;
      });
      const top = Object.entries(endpointCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return {
        total7d: rows.length,
        total24h: last24h.length,
        errors24h,
        errorRate: last24h.length ? (errors24h / last24h.length) * 100 : 0,
        p50: p(0.5),
        p95: p(0.95),
        topEndpoints: top,
      };
    },
  });

  const issueKey = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.functions.invoke("issue-api-key", {
        body: {
          org_id: org!.id,
          name,
          scopes: newKeyScopes,
          ...(newKeyExpiry ? { expires_in_days: Number(newKeyExpiry) } : {}),
        },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Unable to create API key"));
      return data;
    },
    onSuccess: (data) => {
      const fullKey = data.api_key as string;
      setRevealedKey({ key: fullKey, name: newKeyName.trim() });
      copyToClipboard(fullKey, "API key copied to clipboard");
      toast.success("API Key Created", { description: "Copy and store it now — it will not be shown again.", duration: 12000 });
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["api-keys-dev"] });
    },
    onError: (e: any) => toast.error(errorMessage(e, "Unable to create API key")),
  });

  const createWorkspace = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("create-organization", {
        body: { name: workspaceName.trim() || "AICIS Developer Workspace" },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Unable to enable developer access"));
      return data;
    },
    onSuccess: (data) => {
      toast.success("Developer access enabled");
      queryClient.setQueryData(["user-org-dev"], data?.organization ?? null);
      queryClient.invalidateQueries({ queryKey: ["user-org-dev"] });
    },
    onError: (e: any) => toast.error(errorMessage(e, "Unable to enable developer access")),
  });

  const revokeKey = useMutation({
    mutationFn: async (keyId: string) => {
      const { data, error } = await supabase.functions.invoke("revoke-api-key", {
        body: { org_id: org!.id, key_id: keyId },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Unable to revoke key"));
      return data;
    },
    onSuccess: () => {
      toast.success("API key revoked");
      queryClient.invalidateQueries({ queryKey: ["api-keys-dev"] });
    },
    onError: (e: any) => toast.error(errorMessage(e, "Unable to revoke key")),
  });

  const createWebhook = useMutation({
    mutationFn: async (url: string) => {
      const { data, error } = await supabase.functions.invoke("create-webhook-subscription", {
        body: { org_id: org!.id, url, events: EVENTS.map((e) => e.type) },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Unable to create webhook"));
      return data.signing_secret as string;
    },
    onSuccess: (secret) => {
      toast.success("Webhook created", { description: `Signing secret: ${secret} — save it now.`, duration: 15000 });
      navigator.clipboard.writeText(secret);
      setNewWebhookUrl("");
      queryClient.invalidateQueries({ queryKey: ["webhooks-dev"] });
    },
    onError: (e: any) => toast.error(errorMessage(e, "Unable to create webhook")),
  });

  const deleteWebhook = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("webhook_subscriptions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Webhook deleted");
      queryClient.invalidateQueries({ queryKey: ["webhooks-dev"] });
    },
  });

  const activeKeysCount = (apiKeys?.filter((k) => !k.revoked) || []).length;

  return (
    <AICISLayout>
      <div className="max-w-5xl mx-auto space-y-6 p-4 md:p-6">
        <PortalHeader
          activeKeysCount={activeKeysCount}
          webhooksCount={(webhooks || []).length}
          usage={usage}
          showStats={!!org}
        />

        <Tabs defaultValue="api-docs" className="space-y-4">
          <TabsList className="grid w-full grid-cols-5 h-9">
            <TabsTrigger value="api-docs" className="text-xs"><Book className="h-3 w-3 mr-1" />API Docs</TabsTrigger>
            <TabsTrigger value="keys" className="text-xs"><Key className="h-3 w-3 mr-1" />Keys</TabsTrigger>
            <TabsTrigger value="webhooks" className="text-xs"><Webhook className="h-3 w-3 mr-1" />Webhooks</TabsTrigger>
            <TabsTrigger value="usage" className="text-xs"><BarChart3 className="h-3 w-3 mr-1" />Usage</TabsTrigger>
            <TabsTrigger value="sdk" className="text-xs"><Terminal className="h-3 w-3 mr-1" />SDK</TabsTrigger>
          </TabsList>

          <TabsContent value="api-docs" className="space-y-4"><ApiDocsTab /></TabsContent>
          <TabsContent value="keys" className="space-y-4">
            <KeysTab
              org={org}
              orgLoading={orgLoading}
              apiKeys={apiKeys}
              workspaceName={workspaceName}
              setWorkspaceName={setWorkspaceName}
              createWorkspace={createWorkspace}
              issueKey={issueKey}
              revokeKey={revokeKey}
              revealedKey={revealedKey}
              setRevealedKey={setRevealedKey}
              newKeyName={newKeyName}
              setNewKeyName={setNewKeyName}
              newKeyScopes={newKeyScopes}
              toggleScope={toggleScope}
              newKeyExpiry={newKeyExpiry}
              setNewKeyExpiry={setNewKeyExpiry}
              copyToClipboard={copyToClipboard}
            />
          </TabsContent>
          <TabsContent value="webhooks" className="space-y-4">
            <WebhooksTab
              org={org}
              orgLoading={orgLoading}
              webhooks={webhooks}
              newWebhookUrl={newWebhookUrl}
              setNewWebhookUrl={setNewWebhookUrl}
              createWorkspace={createWorkspace}
              createWebhook={createWebhook}
              deleteWebhook={deleteWebhook}
            />
          </TabsContent>
          <TabsContent value="usage" className="space-y-4"><UsageTab usage={usage} /></TabsContent>
          <TabsContent value="sdk" className="space-y-4"><SdkTab /></TabsContent>
        </Tabs>
      </div>
    </AICISLayout>
  );
}
