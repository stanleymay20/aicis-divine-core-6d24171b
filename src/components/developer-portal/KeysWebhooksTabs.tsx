import { useState } from "react";
import { type UseMutationResult } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Copy, Key, Loader2, Terminal, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "./constants";

interface RevealedKey { key: string; name: string }
interface TestResult { ok: boolean; status: number; ms: number; body: string }

interface Props {
  org: any;
  orgLoading: boolean;
  apiKeys: any[] | undefined;
  workspaceName: string;
  setWorkspaceName: (v: string) => void;
  createWorkspace: UseMutationResult<any, any, void>;
  issueKey: UseMutationResult<any, any, string>;
  revokeKey: UseMutationResult<any, any, string>;
  revealedKey: RevealedKey | null;
  setRevealedKey: (v: RevealedKey | null) => void;
  newKeyName: string;
  setNewKeyName: (v: string) => void;
  newKeyScopes: string[];
  toggleScope: (s: string) => void;
  newKeyExpiry: string;
  setNewKeyExpiry: (v: string) => void;
  copyToClipboard: (text: string, label?: string) => void;
}

export function KeysTab(p: Props) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const testApiKey = async (key: string) => {
    setTesting(true);
    setTestResult(null);
    const t0 = performance.now();
    try {
      const res = await fetch(`${API_BASE}/health`, { headers: { "x-api-key": key } });
      const text = await res.text();
      setTestResult({ ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0), body: text.slice(0, 240) });
      if (res.ok) toast.success(`Key works · ${res.status} · ${Math.round(performance.now() - t0)}ms`);
      else toast.error(`Key failed · ${res.status}`);
    } catch (e: any) {
      setTestResult({ ok: false, status: 0, ms: Math.round(performance.now() - t0), body: e?.message || "Network error" });
      toast.error("Network error reaching API");
    } finally {
      setTesting(false);
    }
  };

  const handleRevoke = (keyId: string, keyName: string) => {
    if (!window.confirm(`Revoke API key "${keyName}"?\n\nThis is immediate and irreversible. Any service using this key will start receiving 403 errors.`)) return;
    p.revokeKey.mutate(keyId);
  };

  const activeKeys = p.apiKeys?.filter((k) => !k.revoked) || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2"><Key className="h-4 w-4 text-primary" /> API Keys</CardTitle>
        <CardDescription>Manage API keys for programmatic access. Keys are shown once at creation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {p.orgLoading ? (
          <p className="text-sm text-muted-foreground">Loading developer access...</p>
        ) : !p.org ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Enable developer access</p>
              <p className="text-xs text-muted-foreground mt-1">Create a workspace here, then generate API keys immediately.</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Input value={p.workspaceName} onChange={(e) => p.setWorkspaceName(e.target.value)} className="max-w-sm text-sm h-8" placeholder="Workspace name" />
              <Button size="sm" onClick={() => p.createWorkspace.mutate()} disabled={p.createWorkspace.isPending}>
                {p.createWorkspace.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Enable Access
              </Button>
            </div>
          </div>
        ) : (
          <>
            {p.revealedKey && (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      Your new API key — "{p.revealedKey.name}"
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Save it now. For security, this is the only time it will be shown in full.</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { p.setRevealedKey(null); setTestResult(null); }}>Dismiss</Button>
                </div>
                <div className="flex items-stretch gap-2">
                  <code className="flex-1 min-w-0 bg-background border border-border rounded px-3 py-2 text-xs font-mono break-all select-all">{p.revealedKey.key}</code>
                  <Button size="sm" onClick={() => p.copyToClipboard(p.revealedKey!.key, "API key copied")} className="shrink-0">
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button size="sm" variant="outline" disabled={testing} onClick={() => testApiKey(p.revealedKey!.key)}>
                    {testing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}Test this key live
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => p.copyToClipboard(`curl -H "x-api-key: ${p.revealedKey!.key}" ${API_BASE}/health`, "cURL copied")}>
                    <Terminal className="h-3.5 w-3.5 mr-1.5" /> Copy cURL
                  </Button>
                  {testResult && (
                    <Badge variant={testResult.ok ? "default" : "destructive"} className="text-[10px]">
                      {testResult.ok ? "✓" : "✗"} {testResult.status} · {testResult.ms}ms
                    </Badge>
                  )}
                </div>
                {testResult && (
                  <pre className="bg-muted/60 rounded p-2 text-[10px] font-mono overflow-x-auto max-h-32">{testResult.body}</pre>
                )}
              </div>
            )}

            <div className="space-y-3 border border-border/60 rounded-lg p-3 bg-muted/20">
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Key name</label>
                  <Input placeholder="production-backend" value={p.newKeyName} onChange={(e) => p.setNewKeyName(e.target.value)} className="text-sm h-8" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Expiry (days)</label>
                  <Input type="number" min={1} max={3650} placeholder="never" value={p.newKeyExpiry} onChange={(e) => p.setNewKeyExpiry(e.target.value)} className="text-sm h-8 w-24" />
                </div>
                <Button size="sm" disabled={!p.newKeyName.trim() || p.newKeyScopes.length === 0 || p.issueKey.isPending} onClick={() => p.issueKey.mutate(p.newKeyName.trim())} className="h-8">
                  {p.issueKey.isPending ? "Creating..." : "Create Key"}
                </Button>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Scopes:</span>
                {(["read", "write", "admin"] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={p.newKeyScopes.includes(s)} onChange={() => p.toggleScope(s)} />
                    <code className="font-mono">{s}</code>
                  </label>
                ))}
                <span className="text-[10px] text-muted-foreground ml-auto">Least-privilege: prefer <code className="font-mono">read</code> only.</span>
              </div>
            </div>

            <div className="space-y-2">
              {activeKeys.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No active API keys. Create one to get started.</p>
              ) : (
                activeKeys.map((key: any) => {
                  const expired = key.expires_at && new Date(key.expires_at).getTime() < Date.now();
                  const expiringSoon = key.expires_at && !expired && new Date(key.expires_at).getTime() - Date.now() < 7 * 86_400_000;
                  return (
                    <div key={key.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2 gap-3">
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{key.name}</span>
                          <code className="text-[10px] text-muted-foreground font-mono">{key.key_prefix}•••</code>
                          {(key.scopes || ["read"]).map((s: string) => (
                            <Badge key={s} variant="outline" className="text-[9px] h-4 px-1 font-mono">{s}</Badge>
                          ))}
                          {expired && <Badge variant="destructive" className="text-[9px] h-4 px-1">expired</Badge>}
                          {expiringSoon && <Badge variant="outline" className="text-[9px] h-4 px-1 border-amber-500/50 text-amber-400">expires soon</Badge>}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Created {new Date(key.created_at!).toLocaleDateString()}
                          {key.last_used_at && ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                          {` · ${key.rate_limit_per_minute}/min`}
                          {key.expires_at && ` · Expires ${new Date(key.expires_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive text-xs h-8" disabled={p.revokeKey.isPending && p.revokeKey.variables === key.id} onClick={() => handleRevoke(key.id, key.name)}>
                        {p.revokeKey.isPending && p.revokeKey.variables === key.id
                          ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Revoking…</>
                          : <><Trash2 className="h-3 w-3 mr-1" /> Revoke</>}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface WebhookProps {
  org: any;
  orgLoading: boolean;
  webhooks: any[] | undefined;
  newWebhookUrl: string;
  setNewWebhookUrl: (v: string) => void;
  createWorkspace: UseMutationResult<any, any, void>;
  createWebhook: UseMutationResult<any, any, string>;
  deleteWebhook: UseMutationResult<any, any, string>;
}

export function WebhooksTab(p: WebhookProps) {
  const { Webhook } = require("lucide-react");
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2"><Webhook className="h-4 w-4 text-primary" /> Webhook Subscriptions</CardTitle>
        <CardDescription>Receive real-time event notifications when signals, decisions, or outcomes change.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {p.orgLoading ? (
          <p className="text-sm text-muted-foreground">Loading developer access...</p>
        ) : !p.org ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Enable developer access</p>
              <p className="text-xs text-muted-foreground mt-1">Create a workspace here, then add secure webhook endpoints.</p>
            </div>
            <Button size="sm" onClick={() => p.createWorkspace.mutate()} disabled={p.createWorkspace.isPending}>
              {p.createWorkspace.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}Enable Access
            </Button>
          </div>
        ) : (
          <WebhooksContent {...p} />
        )}
      </CardContent>
    </Card>
  );
}

function WebhooksContent({ webhooks, newWebhookUrl, setNewWebhookUrl, createWebhook, deleteWebhook }: WebhookProps) {
  const { EVENTS } = require("./constants");
  return (
    <>
      <div className="flex gap-2">
        <Input placeholder="https://your-app.com/webhooks/aicis" value={newWebhookUrl} onChange={(e) => setNewWebhookUrl(e.target.value)} className="max-w-md text-sm" />
        <Button size="sm" disabled={!newWebhookUrl.trim() || createWebhook.isPending} onClick={() => createWebhook.mutate(newWebhookUrl.trim())}>
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
                  <Badge variant={wh.active ? "default" : "secondary"} className="text-[10px] h-4">{wh.active ? "Active" : "Paused"}</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {(wh.events || []).length} events
                    {wh.failure_count > 0 && ` · ${wh.failure_count} failures`}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteWebhook.mutate(wh.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="border border-border rounded-lg p-3 mt-2">
        <p className="text-xs font-medium mb-2">Available Events</p>
        <div className="grid grid-cols-1 gap-1.5">
          {EVENTS.map((ev: any) => (
            <div key={ev.type} className="flex items-center gap-2 text-xs">
              <code className="font-mono text-primary bg-primary/5 px-1.5 py-0.5 rounded">{ev.type}</code>
              <span className="text-muted-foreground">{ev.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
