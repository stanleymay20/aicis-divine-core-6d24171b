import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Book, Shield, Terminal, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_BASE, CURL_EXAMPLE, ENDPOINTS, SDK_EXAMPLE } from "./constants";

export function ApiDocsTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> REST API Reference</CardTitle>
          <CardDescription>Base URL: <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{API_BASE}</code></CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="grid grid-cols-[70px_180px_1fr_1fr] gap-2 text-xs font-medium text-muted-foreground border-b border-border pb-2 mb-2">
              <span>Method</span><span>Endpoint</span><span>Description</span><span>Parameters</span>
            </div>
            {ENDPOINTS.map((ep) => (
              <div key={ep.path + ep.method} className="grid grid-cols-[70px_180px_1fr_1fr] gap-2 text-xs py-1.5 border-b border-border/50 last:border-0">
                <Badge variant={ep.method === "POST" ? "default" : "secondary"} className="text-[10px] h-5 w-fit">{ep.method}</Badge>
                <code className="font-mono text-foreground">{ep.path}</code>
                <span className="text-muted-foreground">{ep.desc}</span>
                <span className="text-muted-foreground font-mono">{ep.params}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Authentication</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-2">
          <p>All requests require an <code className="bg-muted px-1 py-0.5 rounded">x-api-key</code> header:</p>
          <pre className="bg-muted p-3 rounded-lg overflow-x-auto font-mono text-[11px]">{`curl -H "x-api-key: sk_your_key_here" \\
  ${API_BASE}/signals`}</pre>
          <div className="flex items-start gap-2 bg-primary/5 border border-primary/10 rounded-lg p-3 mt-3">
            <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-foreground">Rate Limiting</p>
              <p className="text-muted-foreground mt-0.5">Requests are rate-limited per API key. Starter: 60/min, Pro: 300/min, Enterprise: 1000/min.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">cURL Examples</CardTitle></CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-[11px] font-mono leading-relaxed">{CURL_EXAMPLE}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

export function UsageTab({ usage }: { usage: any }) {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> API Usage · last 7 days</CardTitle>
        <CardDescription>Per-organization request volume, error rate, and latency. Each request is hash-chained in the audit log.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Requests · 7d</p><p className="text-lg font-semibold mt-0.5">{(usage?.total7d ?? 0).toLocaleString()}</p></div>
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Errors · 24h</p><p className="text-lg font-semibold mt-0.5">{usage?.errors24h ?? 0}</p></div>
          <div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Latency p95</p><p className="text-lg font-semibold mt-0.5">{usage?.p95 ?? 0} ms</p></div>
        </div>

        <div>
          <p className="text-xs font-medium mb-2">Top endpoints · 24h</p>
          {(usage?.topEndpoints || []).length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">No requests in the last 24 hours.</p>
          ) : (
            <div className="space-y-1">
              {usage!.topEndpoints.map(([k, n]: [string, number]) => (
                <div key={k} className="flex items-center justify-between bg-muted/40 rounded-md px-3 py-1.5">
                  <code className="text-xs font-mono">{k}</code>
                  <span className="text-xs text-muted-foreground tabular-nums">{n.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 bg-primary/5 border border-primary/10 rounded-lg p-3">
          <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-xs">
            <p className="font-medium text-foreground">Tamper-evident audit chain</p>
            <p className="text-muted-foreground mt-0.5">
              Every request is recorded with SHA-256 chaining. Verify in the{" "}
              <button onClick={() => navigate("/api-audit")} className="text-primary underline underline-offset-2">Audit Chain explorer</button>.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SdkTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2"><Terminal className="h-4 w-4 text-primary" /> JavaScript SDK</CardTitle>
          <CardDescription>Drop-in SDK for Node.js and browser applications. Coming soon to npm.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-[11px] font-mono leading-relaxed">{SDK_EXAMPLE}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Quick Start</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-xs">
          {[
            ["Create an API key", "Go to the API Keys tab and generate a key for your application."],
            ["Make your first request", "Use curl or your language of choice with the x-api-key header."],
            ["Set up webhooks (optional)", "Subscribe to real-time events to react to new signals and decisions."],
            ["Build intelligence into your app", "Use priority decisions and outcomes to drive automated workflows."],
          ].map(([title, desc], i) => (
            <div key={title} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</div>
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
