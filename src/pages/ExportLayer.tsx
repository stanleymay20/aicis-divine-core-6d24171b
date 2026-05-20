import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Play, Download, KeyRound, Webhook, Shield, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import SEO from "@/components/SEO";

type Profile = {
  id: string; name: string; destination_type: string; domains: string[]; countries: string[];
  min_relevance_score: number; min_confidence_score: number; min_urgency_score: number;
  max_records_per_run: number; prefer_clusters: boolean; enabled: boolean;
  frequency: string; schema_version: string; last_run_at: string | null;
};
type Run = {
  id: string; profile_id: string; status: string; format: string; records_exported: number;
  clusters_exported: number; payload_size_bytes: number | null; duration_ms: number | null;
  created_at: string; storage_path: string | null; error: string | null;
};
type Webhook = { id: string; endpoint_url: string; event_types: string[]; enabled: boolean; consecutive_failures: number; last_success_at: string | null };
type ApiKey = { id: string; name: string; key_prefix: string; scopes: string[]; rate_limit_per_min: number; last_used_at: string | null; revoked_at: string | null; created_at: string };

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/exports-api`;

export default function ExportLayer() {
  const [tab, setTab] = useState("profiles");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const [p, r, h, k] = await Promise.all([
      supabase.from("export_profiles").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("export_runs").select("*").order("created_at", { ascending: false }).limit(25),
      supabase.from("export_webhooks").select("*").order("created_at", { ascending: false }).limit(25),
      supabase.from("export_api_keys").select("*").order("created_at", { ascending: false }).limit(25),
    ]);
    setProfiles((p.data as any) ?? []);
    setRuns((r.data as any) ?? []);
    setHooks((h.data as any) ?? []);
    setKeys((k.data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const cloneQuantivis = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("clone_export_preset", { _preset_key: "quantivis_decision_intelligence", _name: null });
    setBusy(false);
    if (error) return toast.error(`Preset clone failed: ${error.message}`);
    toast.success("Quantivis profile created");
    refresh();
  };

  const runProfile = async (profileId: string, format: "json"|"csv"|"ndjson" = "json") => {
    const { data, error } = await supabase.functions.invoke("exports-api", {
      body: { profile_id: profileId, format },
      method: "POST",
      headers: {},
    } as any);
    // Fallback: call via fetch since path-based router
    const res = await fetch(`${FN_URL}/exports/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}` },
      body: JSON.stringify({ profile_id: profileId, format }),
    });
    const j = await res.json();
    if (!res.ok) return toast.error(j.error ?? "run_failed");
    toast.success(`Run enqueued: ${j.run.id.slice(0, 8)}`);
    setTimeout(refresh, 1500);
  };

  const downloadRun = async (runId: string) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
    const res = await fetch(`${FN_URL}/exports/runs/${runId}/download.json`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json();
    if (j.signed_url) window.open(j.signed_url, "_blank");
    else toast.error(j.error ?? "no_file");
  };

  const createApiKey = async () => {
    const name = prompt("Key name (e.g. 'Quantivis production')");
    if (!name) return;
    const random = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const prefix = `aicis_live_${random.slice(0, 8)}`;
    const fullKey = `${prefix}_${random.slice(8, 40)}`;
    const enc = new TextEncoder().encode(fullKey);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { error } = await supabase.from("export_api_keys").insert({
      name, key_prefix: prefix.slice(0, 16), key_hash: hash, scopes: ["exports.read"], rate_limit_per_min: 120,
    });
    if (error) return toast.error(error.message);
    toast.success("API key created — copy now, it will not be shown again", { duration: 30000, description: fullKey });
    refresh();
  };

  const revokeKey = async (id: string) => {
    await supabase.from("export_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    toast.success("Key revoked"); refresh();
  };

  const addWebhook = async () => {
    const url = prompt("Webhook URL (HTTPS)");
    if (!url) return;
    const secret = prompt("Shared secret (used for HMAC signature)") ?? crypto.randomUUID();
    const { error } = await supabase.from("export_webhooks").insert({
      endpoint_url: url, secret_hash: secret, event_types: ["export.completed"], min_relevance_score: 70, enabled: true,
    });
    if (error) return toast.error(error.message);
    toast.success("Webhook registered"); refresh();
  };

  const fmtBytes = (n: number | null) => n == null ? "—" : n < 1024 ? `${n}B` : n < 1e6 ? `${(n/1024).toFixed(1)}KB` : `${(n/1e6).toFixed(2)}MB`;

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
      <SEO title="Export Layer — AICIS" description="Decision-grade intelligence export to Quantivis and downstream platforms" />
      <header className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Export Layer</h1>
            <p className="text-muted-foreground text-sm">REST · Webhooks · CSV/JSON/NDJSON · SDK-ready · Incremental sync</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={cloneQuantivis} disabled={busy}>
              <Plus className="h-4 w-4 mr-2" /> Quantivis preset
            </Button>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full max-w-2xl mb-4">
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
        </TabsList>

        <TabsContent value="profiles">
          {loading ? <Loader2 className="animate-spin" /> : profiles.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">
              No profiles yet. Click <strong>Quantivis preset</strong> to create one.
            </CardContent></Card>
          ) : (
            <div className="grid gap-3">
              {profiles.map(p => (
                <Card key={p.id}>
                  <CardContent className="p-4 flex flex-wrap items-center gap-3 justify-between">
                    <div className="min-w-0">
                      <div className="font-semibold flex items-center gap-2">
                        {p.name}
                        <Badge variant={p.enabled ? "default" : "secondary"}>{p.enabled ? "enabled" : "disabled"}</Badge>
                        <Badge variant="outline">{p.destination_type}</Badge>
                        <Badge variant="outline">{p.frequency}</Badge>
                        <Badge variant="outline">{p.schema_version}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        rel≥{p.min_relevance_score} · conf≥{p.min_confidence_score} · urg≥{p.min_urgency_score} · max {p.max_records_per_run}
                        {p.prefer_clusters && " · clusters"}
                        {p.domains.length > 0 && ` · ${p.domains.length} domains`}
                        {p.countries.length > 0 && ` · ${p.countries.length} countries`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => runProfile(p.id, "json")}>
                        <Play className="h-3 w-3 mr-1" /> Run JSON
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => runProfile(p.id, "csv")}>CSV</Button>
                      <Button size="sm" variant="outline" onClick={() => runProfile(p.id, "ndjson")}>NDJSON</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs">
          {loading ? <Loader2 className="animate-spin" /> : runs.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No runs yet.</CardContent></Card>
          ) : (
            <div className="grid gap-2">
              {runs.map(r => (
                <Card key={r.id}>
                  <CardContent className="p-3 flex flex-wrap items-center gap-3 justify-between text-sm">
                    <div className="font-mono text-xs">{r.id.slice(0, 8)}</div>
                    <Badge variant={r.status === "success" ? "default" : r.status === "error" ? "destructive" : "secondary"}>{r.status}</Badge>
                    <span>{r.format}</span>
                    <span>{r.records_exported} records · {r.clusters_exported} clusters</span>
                    <span>{fmtBytes(r.payload_size_bytes)}</span>
                    <span>{r.duration_ms ?? "—"}ms</span>
                    <span className="text-muted-foreground text-xs">{new Date(r.created_at).toLocaleString()}</span>
                    {r.storage_path && (
                      <Button size="sm" variant="outline" onClick={() => downloadRun(r.id)}>
                        <Download className="h-3 w-3 mr-1" /> Download
                      </Button>
                    )}
                    {r.error && <span className="text-destructive text-xs">{r.error}</span>}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="webhooks">
          <div className="mb-3">
            <Button size="sm" onClick={addWebhook}><Webhook className="h-4 w-4 mr-2" /> Add webhook</Button>
          </div>
          {hooks.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No webhooks registered.</CardContent></Card>
          ) : (
            <div className="grid gap-2">
              {hooks.map(h => (
                <Card key={h.id}><CardContent className="p-3 flex items-center justify-between gap-3 text-sm flex-wrap">
                  <div className="font-mono text-xs truncate max-w-md">{h.endpoint_url}</div>
                  <div className="flex gap-2">
                    {h.event_types.map(e => <Badge key={e} variant="outline">{e}</Badge>)}
                    <Badge variant={h.enabled ? "default" : "secondary"}>{h.enabled ? "live" : "off"}</Badge>
                    {h.consecutive_failures > 0 && <Badge variant="destructive">{h.consecutive_failures} fails</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">last ok: {h.last_success_at ? new Date(h.last_success_at).toLocaleString() : "—"}</div>
                </CardContent></Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="keys">
          <div className="mb-3">
            <Button size="sm" onClick={createApiKey}><KeyRound className="h-4 w-4 mr-2" /> Create API key</Button>
          </div>
          {keys.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">No API keys.</CardContent></Card>
          ) : (
            <div className="grid gap-2">
              {keys.map(k => (
                <Card key={k.id}><CardContent className="p-3 flex items-center justify-between gap-3 text-sm flex-wrap">
                  <div>
                    <div className="font-semibold">{k.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{k.key_prefix}…</div>
                  </div>
                  <div className="flex gap-2">
                    {k.scopes.map(s => <Badge key={s} variant="outline">{s}</Badge>)}
                    <Badge variant="secondary">{k.rate_limit_per_min}/min</Badge>
                    {k.revoked_at && <Badge variant="destructive">revoked</Badge>}
                  </div>
                  {!k.revoked_at && <Button size="sm" variant="outline" onClick={() => revokeKey(k.id)}><Shield className="h-3 w-3 mr-1" />Revoke</Button>}
                </CardContent></Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-sm">API endpoints</CardTitle></CardHeader>
        <CardContent className="text-xs font-mono space-y-1 text-muted-foreground">
          <div>GET  {FN_URL}/exports/signals?profile_id=&amp;since=&amp;cursor=&amp;limit=</div>
          <div>GET  {FN_URL}/exports/clusters?profile_id=</div>
          <div>GET  {FN_URL}/exports/recommendations?country=&amp;domain=</div>
          <div>GET  {FN_URL}/exports/entities?country=</div>
          <div>GET  {FN_URL}/exports/risk-briefs?country=</div>
          <div>POST {FN_URL}/exports/profiles</div>
          <div>POST {FN_URL}/exports/run            body: {`{ profile_id, format }`}</div>
          <div>GET  {FN_URL}/exports/runs/:id</div>
          <div>GET  {FN_URL}/exports/runs/:id/download.csv|.json|.ndjson</div>
          <div className="pt-2">Auth: <code>X-AICIS-API-Key: aicis_live_…</code> or <code>Authorization: Bearer &lt;jwt&gt;</code></div>
        </CardContent>
      </Card>
    </div>
  );
}
