import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, ShieldCheck, Hash, ArrowRight } from "lucide-react";

interface MLAudit {
  id: string;
  prediction_id: string;
  feature_hash: string;
  model_version: string;
  weights_hash: string;
  combined_hash: string;
  previous_audit_hash: string | null;
  generated_at: string;
}

interface ApiAudit {
  id: string;
  api_key_id: string | null;
  endpoint: string;
  method: string;
  response_status: number;
  latency_ms: number | null;
  request_hash: string;
  response_hash: string | null;
  chain_hash: string;
  previous_chain_hash: string | null;
  created_at: string;
}

export default function ApiAuditPage() {
  const ml = useQuery({
    queryKey: ["ml-inference-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ml_inference_audit")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as MLAudit[];
    },
    staleTime: 60_000,
  });

  const api = useQuery({
    queryKey: ["api-request-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_request_audit")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as ApiAudit[];
    },
    staleTime: 60_000,
  });

  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1400px] mx-auto overflow-y-auto h-full space-y-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Audit Hash-Chain Explorer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cryptographic audit trail. Every ML inference and API request is SHA-256 chained to the prior record — tampering breaks the chain.
          </p>
        </div>

        <Tabs defaultValue="ml">
          <TabsList>
            <TabsTrigger value="ml" className="gap-2"><Hash className="h-3.5 w-3.5" /> ML inference chain</TabsTrigger>
            <TabsTrigger value="api" className="gap-2"><Hash className="h-3.5 w-3.5" /> API request chain</TabsTrigger>
          </TabsList>

          <TabsContent value="ml">
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-sm">ml_inference_audit (last 100)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {ml.isLoading ? (
                  <Loading />
                ) : (ml.data ?? []).length === 0 ? (
                  <Empty msg="No ML inference audits yet. Run inference on /predictions to populate." />
                ) : (
                  <div className="divide-y divide-border">
                    {(ml.data ?? []).map(r => (
                      <div key={r.id} className="px-4 py-2.5 text-[11px] font-mono">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">{r.model_version}</Badge>
                          <span className="text-muted-foreground">{new Date(r.generated_at).toLocaleString()}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-muted-foreground flex-wrap">
                          <span title={r.previous_audit_hash ?? "(genesis)"}>
                            prev {r.previous_audit_hash ? r.previous_audit_hash.slice(0, 12) : "GENESIS"}…
                          </span>
                          <ArrowRight className="h-3 w-3 shrink-0" />
                          <span className="text-foreground" title={r.combined_hash}>{r.combined_hash.slice(0, 16)}…</span>
                          <span className="ml-2">feature {r.feature_hash.slice(0, 8)}…</span>
                          <span>weights {r.weights_hash.slice(0, 8)}…</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="api">
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-sm">api_request_audit (last 100)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {api.isLoading ? (
                  <Loading />
                ) : (api.data ?? []).length === 0 ? (
                  <Empty msg="No API request audits yet. Public API v1 with HMAC signing populates this chain." />
                ) : (
                  <div className="divide-y divide-border">
                    {(api.data ?? []).map(r => (
                      <div key={r.id} className="px-4 py-2.5 text-[11px] font-mono">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="bg-muted/40">{r.method}</Badge>
                          <span className="text-foreground">{r.endpoint}</span>
                          <Badge variant="outline" className={r.response_status < 400 ? "bg-primary/10 text-primary border-primary/20" : "bg-destructive/10 text-destructive border-destructive/20"}>
                            {r.response_status}
                          </Badge>
                          <span className="text-muted-foreground">{r.latency_ms ?? "—"}ms</span>
                          <span className="text-muted-foreground ml-auto">{new Date(r.created_at).toLocaleString()}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-muted-foreground flex-wrap">
                          <span>prev {r.previous_chain_hash ? r.previous_chain_hash.slice(0, 12) : "GENESIS"}…</span>
                          <ArrowRight className="h-3 w-3 shrink-0" />
                          <span className="text-foreground" title={r.chain_hash}>{r.chain_hash.slice(0, 16)}…</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AICISLayout>
  );
}

const Loading = () => <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
const Empty = ({ msg }: { msg: string }) => <p className="text-sm text-muted-foreground py-8 text-center">{msg}</p>;
