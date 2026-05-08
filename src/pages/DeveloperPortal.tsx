import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Copy, Key, Webhook, Book, Zap, Shield, Terminal, Code2, ExternalLink, Trash2, Download, Activity, BarChart3, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-api`;

const ENDPOINTS = [
  { method: "GET", path: "/signals", desc: "List enriched global signals", params: "limit, category, min_impact" },
  { method: "GET", path: "/decisions", desc: "List decisions with status", params: "limit, status" },
  { method: "POST", path: "/decisions", desc: "Create a new decision from signal", params: "signal_summary, domain, severity_score" },
  { method: "GET", path: "/outcomes", desc: "List measured outcomes with ROI", params: "limit" },
  { method: "GET", path: "/priority-decisions", desc: "Top 5 priority decisions ranked by urgency", params: "none" },
  { method: "GET", path: "/domains", desc: "List all tracked domains", params: "none" },
  { method: "GET", path: "/health", desc: "System health status", params: "none" },
];

const EVENTS = [
  { type: "signal.new", desc: "New signal ingested and enriched" },
  { type: "signal.critical", desc: "Critical-urgency signal detected" },
  { type: "decision.created", desc: "New decision created" },
  { type: "decision.executed", desc: "Decision marked as executed" },
  { type: "outcome.recorded", desc: "Outcome with ROI recorded" },
];

const SDK_EXAMPLE = `import { AICIS } from "aicis-sdk"

const aicis = new AICIS({ apiKey: "sk_your_key_here" })

// Get today's priority decisions
const priorities = await aicis.getPriorityDecisions()
console.log(priorities)
// → [{ title: "Energy supply risk in EUR region", urgency: "critical", ... }]

// Get latest signals filtered by category
const signals = await aicis.getSignals({ 
  category: "geopolitical", 
  minImpact: 70, 
  limit: 10 
})

// Create a decision from a signal
const decision = await aicis.createDecision({
  signalSummary: "Oil supply disruption in Middle East",
  domain: "energy",
  severityScore: 85,
})

// Get measured outcomes with ROI
const outcomes = await aicis.getOutcomes({ limit: 20 })`;

const CURL_EXAMPLE = `# List priority decisions
curl -H "x-api-key: sk_your_key" \\
  ${API_BASE}/priority-decisions

# Get signals with filters
curl -H "x-api-key: sk_your_key" \\
  "${API_BASE}/signals?category=geopolitical&min_impact=70&limit=10"

# Create a decision
curl -X POST -H "x-api-key: sk_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"signal_summary":"Oil disruption","domain":"energy","severity_score":85}' \\
  ${API_BASE}/decisions

# Check system health
curl -H "x-api-key: sk_your_key" \\
  ${API_BASE}/health`;

export default function DeveloperPortal() {
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [newWebhookUrl, setNewWebhookUrl] = useState("");

  // Fetch user's org
  const { data: org } = useQuery({
    queryKey: ["user-org-dev"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("organizations")
        .select("*")
        .eq("owner_id", user.id)
        .single();
      return data;
    },
  });

  // Fetch API keys
  const { data: apiKeys } = useQuery({
    queryKey: ["api-keys-dev", org?.id],
    enabled: !!org?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("api_keys")
        .select("id, name, key_prefix, created_at, last_used_at, revoked, rate_limit_per_minute")
        .eq("org_id", org!.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  // Fetch webhooks
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

  // Issue key mutation
  const issueKey = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.functions.invoke("issue-api-key", {
        body: { org_id: org!.id, name },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("API Key Created", {
        description: `Key: ${data.api_key?.substring(0, 20)}... — copy it now, it won't be shown again.`,
        duration: 15000,
      });
      navigator.clipboard.writeText(data.api_key);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["api-keys-dev"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Revoke key mutation
  const revokeKey = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase.functions.invoke("revoke-api-key", {
        body: { org_id: org!.id, key_id: keyId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("API key revoked");
      queryClient.invalidateQueries({ queryKey: ["api-keys-dev"] });
    },
  });

  // Create webhook mutation
  const createWebhook = useMutation({
    mutationFn: async (url: string) => {
      const secret = crypto.randomUUID();
      const { error } = await supabase
        .from("webhook_subscriptions")
        .insert({
          org_id: org!.id,
          url,
          events: EVENTS.map((e) => e.type),
          secret,
        });
      if (error) throw error;
      return secret;
    },
    onSuccess: (secret) => {
      toast.success("Webhook created", {
        description: `Signing secret: ${secret} — save it now.`,
        duration: 15000,
      });
      navigator.clipboard.writeText(secret);
      setNewWebhookUrl("");
      queryClient.invalidateQueries({ queryKey: ["webhooks-dev"] });
    },
    onError: (e: any) => toast.error(e.message),
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

  const activeKeys = apiKeys?.filter((k) => !k.revoked) || [];

  return (
    <AICISLayout>
      <div className="max-w-5xl mx-auto space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Code2 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Developer Platform</h1>
            <Badge variant="outline" className="text-xs">v1.0</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Build on AICIS — integrate signals, decisions, and outcomes into your applications.
          </p>
        </div>

        <Tabs defaultValue="api-docs" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 h-9">
            <TabsTrigger value="api-docs" className="text-xs"><Book className="h-3 w-3 mr-1" />API Docs</TabsTrigger>
            <TabsTrigger value="keys" className="text-xs"><Key className="h-3 w-3 mr-1" />API Keys</TabsTrigger>
            <TabsTrigger value="webhooks" className="text-xs"><Webhook className="h-3 w-3 mr-1" />Webhooks</TabsTrigger>
            <TabsTrigger value="sdk" className="text-xs"><Terminal className="h-3 w-3 mr-1" />SDK</TabsTrigger>
          </TabsList>

          {/* ── API Docs ─────────────────────────────── */}
          <TabsContent value="api-docs" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" /> REST API Reference
                </CardTitle>
                <CardDescription>
                  Base URL: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{API_BASE}</code>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <div className="grid grid-cols-[70px_180px_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground border-b border-border pb-2 mb-2">
                    <span>Method</span><span>Endpoint</span><span>Description</span><span>Parameters</span>
                  </div>
                  {ENDPOINTS.map((ep) => (
                    <div key={ep.path + ep.method} className="grid grid-cols-[70px_180px_1fr_1fr] gap-2 text-xs py-1.5 border-b border-border/50 last:border-0">
                      <Badge variant={ep.method === "POST" ? "default" : "secondary"} className="text-[10px] h-5 w-fit">
                        {ep.method}
                      </Badge>
                      <code className="font-mono text-foreground">{ep.path}</code>
                      <span className="text-muted-foreground">{ep.desc}</span>
                      <span className="text-muted-foreground font-mono">{ep.params}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Authentication</CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                <p>All requests require an <code className="bg-muted px-1 py-0.5 rounded">x-api-key</code> header:</p>
                <pre className="bg-muted p-3 rounded-lg overflow-x-auto font-mono text-[11px]">
{`curl -H "x-api-key: sk_your_key_here" \\
  ${API_BASE}/signals`}
                </pre>
                <div className="flex items-start gap-2 bg-primary/5 border border-primary/10 rounded-lg p-3 mt-3">
                  <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-foreground">Rate Limiting</p>
                    <p className="text-muted-foreground mt-0.5">
                      Requests are rate-limited per API key. Starter: 60/min, Pro: 300/min, Enterprise: 1000/min.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">cURL Examples</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-[11px] font-mono leading-relaxed">
                  {CURL_EXAMPLE}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── API Keys ─────────────────────────────── */}
          <TabsContent value="keys" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Key className="h-4 w-4 text-primary" /> API Keys
                </CardTitle>
                <CardDescription>Manage API keys for programmatic access. Keys are shown once at creation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!org ? (
                  <p className="text-sm text-muted-foreground">Create an organization first to manage API keys.</p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Key name (e.g. production-backend)"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        className="max-w-xs text-sm"
                      />
                      <Button
                        size="sm"
                        disabled={!newKeyName.trim() || issueKey.isPending}
                        onClick={() => issueKey.mutate(newKeyName.trim())}
                      >
                        {issueKey.isPending ? "Creating..." : "Create Key"}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {activeKeys.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">No active API keys. Create one to get started.</p>
                      ) : (
                        activeKeys.map((key) => (
                          <div key={key.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{key.name}</span>
                                <code className="text-[10px] text-muted-foreground font-mono">{key.key_prefix}•••</code>
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                Created {new Date(key.created_at!).toLocaleDateString()}
                                {key.last_used_at && ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                                {` · ${key.rate_limit_per_minute}/min`}
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive text-xs"
                              onClick={() => revokeKey.mutate(key.id)}
                            >
                              Revoke
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Webhooks ─────────────────────────────── */}
          <TabsContent value="webhooks" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Webhook className="h-4 w-4 text-primary" /> Webhook Subscriptions
                </CardTitle>
                <CardDescription>Receive real-time event notifications when signals, decisions, or outcomes change.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!org ? (
                  <p className="text-sm text-muted-foreground">Create an organization first to manage webhooks.</p>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Input
                        placeholder="https://your-app.com/webhooks/aicis"
                        value={newWebhookUrl}
                        onChange={(e) => setNewWebhookUrl(e.target.value)}
                        className="max-w-md text-sm"
                      />
                      <Button
                        size="sm"
                        disabled={!newWebhookUrl.trim() || createWebhook.isPending}
                        onClick={() => createWebhook.mutate(newWebhookUrl.trim())}
                      >
                        {createWebhook.isPending ? "Creating..." : "Add Webhook"}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {(webhooks || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">No webhooks configured.</p>
                      ) : (
                        (webhooks || []).map((wh: any) => (
                          <div key={wh.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                            <div className="space-y-0.5">
                              <code className="text-xs font-mono">{wh.url}</code>
                              <div className="flex items-center gap-1.5 mt-1">
                                <Badge variant={wh.active ? "default" : "secondary"} className="text-[10px] h-4">
                                  {wh.active ? "Active" : "Paused"}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {(wh.events || []).length} events
                                  {wh.failure_count > 0 && ` · ${wh.failure_count} failures`}
                                </span>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => deleteWebhook.mutate(wh.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="border border-border rounded-lg p-3 mt-2">
                      <p className="text-xs font-medium mb-2">Available Events</p>
                      <div className="grid grid-cols-1 gap-1.5">
                        {EVENTS.map((ev) => (
                          <div key={ev.type} className="flex items-center gap-2 text-xs">
                            <code className="font-mono text-primary bg-primary/5 px-1.5 py-0.5 rounded">{ev.type}</code>
                            <span className="text-muted-foreground">{ev.desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── SDK ─────────────────────────────── */}
          <TabsContent value="sdk" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-primary" /> JavaScript SDK
                </CardTitle>
                <CardDescription>
                  Drop-in SDK for Node.js and browser applications. Coming soon to npm.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-[11px] font-mono leading-relaxed">
                  {SDK_EXAMPLE}
                </pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Quick Start</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">1</div>
                  <div>
                    <p className="font-medium">Create an API key</p>
                    <p className="text-muted-foreground">Go to the API Keys tab and generate a key for your application.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">2</div>
                  <div>
                    <p className="font-medium">Make your first request</p>
                    <p className="text-muted-foreground">Use curl or your language of choice with the <code className="bg-muted px-1 rounded">x-api-key</code> header.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">3</div>
                  <div>
                    <p className="font-medium">Set up webhooks (optional)</p>
                    <p className="text-muted-foreground">Subscribe to real-time events to react to new signals and decisions.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">4</div>
                  <div>
                    <p className="font-medium">Build intelligence into your app</p>
                    <p className="text-muted-foreground">Use priority decisions and outcomes to drive automated workflows.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AICISLayout>
  );
}
