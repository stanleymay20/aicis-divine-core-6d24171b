import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, CheckCircle2, Code2, Download, Shield } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { API_BASE, ENDPOINTS } from "./constants";

interface Props {
  activeKeysCount: number;
  webhooksCount: number;
  usage: any;
  showStats: boolean;
}

export function PortalHeader({ activeKeysCount, webhooksCount, usage, showStats }: Props) {
  const navigate = useNavigate();

  const downloadOpenApi = () => {
    const spec = {
      openapi: "3.0.3",
      info: { title: "AICIS Public API", version: "1.2", description: "Signals, decisions, outcomes, ML predictions." },
      servers: [{ url: API_BASE }],
      components: { securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" } } },
      security: [{ ApiKeyAuth: [] }],
      paths: Object.fromEntries(ENDPOINTS.map(ep => [ep.path, {
        [ep.method.toLowerCase()]: { summary: ep.desc, parameters: [], responses: { "200": { description: "OK" }, "401": { description: "Missing key" }, "403": { description: "Invalid/expired/insufficient scope" }, "429": { description: "Rate limit" } } }
      }])),
    };
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aicis-openapi.json";
    a.click();
    toast.success("OpenAPI spec downloaded");
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Code2 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Developer Platform</h1>
            <Badge variant="outline" className="text-xs">v1.0</Badge>
            <Badge variant="outline" className="text-[10px] gap-1 border-emerald-700/50 text-emerald-300 bg-emerald-500/10">
              <CheckCircle2 className="h-2.5 w-2.5" /> SLA 99.9%
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Build on AICIS — signals, decisions, outcomes. HMAC webhooks · SHA-256 audit chain · per-key rate limits.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => navigate("/data-export")}><Download className="h-3.5 w-3.5 mr-1.5" /> Data Export</Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/api-audit")}><Shield className="h-3.5 w-3.5 mr-1.5" /> Audit Chain</Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/system-status")}><Activity className="h-3.5 w-3.5 mr-1.5" /> Status</Button>
          <Button size="sm" variant="outline" onClick={downloadOpenApi}><Download className="h-3.5 w-3.5 mr-1.5" /> OpenAPI</Button>
        </div>
      </div>

      {showStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Requests · 24h</p>
            <p className="text-xl font-semibold mt-0.5">{(usage?.total24h ?? 0).toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Error rate · 24h</p>
            <p className={`text-xl font-semibold mt-0.5 ${((usage?.errorRate ?? 0) > 5) ? "text-destructive" : ""}`}>
              {(usage?.errorRate ?? 0).toFixed(1)}%
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Latency p50 / p95</p>
            <p className="text-xl font-semibold mt-0.5">{usage?.p50 ?? 0} / {usage?.p95 ?? 0} <span className="text-xs text-muted-foreground font-normal">ms</span></p>
          </div>
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Active keys · Webhooks</p>
            <p className="text-xl font-semibold mt-0.5">{activeKeysCount} <span className="text-muted-foreground">·</span> {webhooksCount}</p>
          </div>
        </div>
      )}
    </>
  );
}
