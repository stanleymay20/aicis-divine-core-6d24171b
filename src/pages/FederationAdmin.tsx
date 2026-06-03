import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShieldCheck, ShieldAlert, KeyRound, Copy, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

type StepStatus = "idle" | "running" | "pass" | "fail";

interface ActiveKey {
  key_id: string;
  public_key: string;
  created_at?: string;
  expires_at?: string;
}

interface SignResult {
  bundle_hash: string;
  key_id: string;
  signature: string;
  algorithm: string;
}

export default function FederationAdmin() {
  const [activeKey, setActiveKey] = useState<ActiveKey | null>(null);
  const [loadingKey, setLoadingKey] = useState(true);
  const [issuedPrivateKey, setIssuedPrivateKey] = useState<string | null>(null);
  const [issuedKeyId, setIssuedKeyId] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const [signStatus, setSignStatus] = useState<StepStatus>("idle");
  const [verifyStatus, setVerifyStatus] = useState<StepStatus>("idle");
  const [signResult, setSignResult] = useState<SignResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [rotating, setRotating] = useState(false);

  const testPayload = {
    test: "aicis-federation-self-test",
    issued_at: new Date().toISOString().slice(0, 10),
    nonce: "phase-a-verification",
  };

  const loadActiveKey = async () => {
    setLoadingKey(true);
    const { data } = await supabase
      .from("federation_active_key" as any)
      .select("*")
      .maybeSingle();
    setActiveKey((data as any) ?? null);
    setLoadingKey(false);
  };

  useEffect(() => {
    loadActiveKey();
  }, []);

  const handleInit = async () => {
    if (activeKey && !rotating) {
      const ok = confirm(
        "An active federation key already exists. Generating a new one will ROTATE it (old becomes inactive). Continue?",
      );
      if (!ok) return;
    }
    setRotating(true);
    setIssuedPrivateKey(null);
    setIssuedKeyId(null);
    setAcknowledged(false);
    try {
      const { data, error } = await supabase.functions.invoke("federation-init-key", { body: {} });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Init failed");
      setIssuedPrivateKey(data.private_key_pkcs8_base64);
      setIssuedKeyId(data.key_id);
      toast.success(`Key ${data.key_id} generated. Save the private key now.`);
      await loadActiveKey();
    } catch (e: any) {
      toast.error(e.message || "Failed to initialize key");
    } finally {
      setRotating(false);
    }
  };

  const handleSign = async () => {
    setSignStatus("running");
    setSignResult(null);
    setVerifyStatus("idle");
    setVerifyResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("federation-sign-bundle", {
        body: { payload: testPayload },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSignResult(data);
      setSignStatus("pass");
      toast.success("Signature generated");
    } catch (e: any) {
      setSignStatus("fail");
      toast.error(e.message || "Sign failed");
    }
  };

  const handleVerify = async () => {
    if (!signResult) return;
    setVerifyStatus("running");
    try {
      const { data, error } = await supabase.functions.invoke("federation-verify-bundle", {
        body: {
          key_id: signResult.key_id,
          signature: signResult.signature,
          payload: testPayload,
        },
      });
      if (error) throw error;
      setVerifyResult(data);
      setVerifyStatus(data?.valid ? "pass" : "fail");
      if (data?.valid) toast.success("Signature verified ✓");
      else toast.error(`Verification failed: ${data?.reason ?? "invalid"}`);
    } catch (e: any) {
      setVerifyStatus("fail");
      toast.error(e.message || "Verify failed");
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const StatusBadge = ({ s }: { s: StepStatus }) => {
    if (s === "pass") return <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="h-3 w-3 mr-1" />PASS</Badge>;
    if (s === "fail") return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />FAIL</Badge>;
    if (s === "running") return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />RUNNING</Badge>;
    return <Badge variant="outline">IDLE</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Federation Signing — Phase A Verification
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Initialise the Ed25519 federation key, then run the end-to-end Sign → Verify cycle.
            </p>
          </div>
          <Badge variant="outline" className="font-mono text-xs">UNCLASSIFIED // FOUO</Badge>
        </div>

        {/* Step 1: Active key state */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5" /> Step 1 — Active Federation Key
                </CardTitle>
                <CardDescription>Registered Ed25519 public key currently used to sign bundles.</CardDescription>
              </div>
              <Button onClick={handleInit} disabled={rotating} variant={activeKey ? "outline" : "default"}>
                {rotating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {activeKey ? "Rotate Key" : "Initialize Key"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingKey ? (
              <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…</div>
            ) : activeKey ? (
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Key ID</div>
                  <div className="font-mono break-all">{activeKey.key_id}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Algorithm</div>
                  <div className="font-mono">Ed25519</div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-xs text-muted-foreground">Public Key (base64)</div>
                  <div className="font-mono text-xs break-all bg-muted p-2 rounded">{activeKey.public_key}</div>
                </div>
              </div>
            ) : (
              <Alert>
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>No active key registered</AlertTitle>
                <AlertDescription>Generate one to enable federation signing.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Step 1b: One-time private key reveal */}
        {issuedPrivateKey && (
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" /> One-Time Private Key Reveal
              </CardTitle>
              <CardDescription>
                Copy these values <strong>now</strong> and store as backend secrets. They will not be shown again.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert variant="destructive">
                <AlertTitle>Operator action required</AlertTitle>
                <AlertDescription className="space-y-2 mt-2">
                  <p>Add the following backend secrets via Project Settings → Secrets:</p>
                  <ol className="list-decimal pl-5 text-sm space-y-1">
                    <li><code className="font-mono">FEDERATION_ED25519_PRIVATE_KEY</code> = value below</li>
                    <li><code className="font-mono">FEDERATION_KEY_ID</code> = <span className="font-mono">{issuedKeyId}</span></li>
                  </ol>
                </AlertDescription>
              </Alert>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">FEDERATION_KEY_ID</span>
                  <Button size="sm" variant="ghost" onClick={() => copy(issuedKeyId!, "Key ID")}><Copy className="h-3 w-3 mr-1" />Copy</Button>
                </div>
                <Textarea readOnly value={issuedKeyId ?? ""} className="font-mono text-xs h-10" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">FEDERATION_ED25519_PRIVATE_KEY (pkcs8 base64)</span>
                  <Button size="sm" variant="ghost" onClick={() => copy(issuedPrivateKey, "Private key")}><Copy className="h-3 w-3 mr-1" />Copy</Button>
                </div>
                <Textarea readOnly value={issuedPrivateKey} className="font-mono text-xs h-32" />
              </div>

              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-1"
                />
                <span>I have copied both values and stored them as backend secrets. Hide the private key from view.</span>
              </label>

              {acknowledged && (
                <Button
                  variant="outline"
                  onClick={() => { setIssuedPrivateKey(null); setIssuedKeyId(null); setAcknowledged(false); }}
                >
                  Clear from screen
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 2: Sign */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle>Step 2 — Sign Test Bundle</CardTitle>
                <CardDescription>Calls <code className="font-mono text-xs">federation-sign-bundle</code> with a canonical test payload.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge s={signStatus} />
                <Button onClick={handleSign} disabled={!activeKey || signStatus === "running"}>Sign</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground mb-1">Test payload</div>
            <pre className="bg-muted p-2 rounded text-xs overflow-auto">{JSON.stringify(testPayload, null, 2)}</pre>
            {signResult && (
              <div className="mt-3 space-y-2 text-xs">
                <div><span className="text-muted-foreground">bundle_hash:</span> <span className="font-mono break-all">{signResult.bundle_hash}</span></div>
                <div><span className="text-muted-foreground">key_id:</span> <span className="font-mono">{signResult.key_id}</span></div>
                <div><span className="text-muted-foreground">signature:</span> <span className="font-mono break-all">{signResult.signature}</span></div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 3: Verify */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle>Step 3 — Verify Signature</CardTitle>
                <CardDescription>Calls <code className="font-mono text-xs">federation-verify-bundle</code> against the registered public key.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge s={verifyStatus} />
                <Button onClick={handleVerify} disabled={!signResult || verifyStatus === "running"}>Verify</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {verifyResult ? (
              <pre className="bg-muted p-2 rounded text-xs overflow-auto">{JSON.stringify(verifyResult, null, 2)}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">Run Sign first, then Verify.</p>
            )}
          </CardContent>
        </Card>

        {/* Summary */}
        <Card className={signStatus === "pass" && verifyStatus === "pass" ? "border-emerald-600" : ""}>
          <CardHeader>
            <CardTitle>Phase A — Federation Signing Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-4 gap-3 text-sm">
              <div className="flex items-center justify-between p-2 rounded border">
                <span>Active Key</span>
                {activeKey ? <Badge className="bg-emerald-600 hover:bg-emerald-600">YES</Badge> : <Badge variant="outline">NO</Badge>}
              </div>
              <div className="flex items-center justify-between p-2 rounded border">
                <span>Sign</span>
                <StatusBadge s={signStatus} />
              </div>
              <div className="flex items-center justify-between p-2 rounded border">
                <span>Verify</span>
                <StatusBadge s={verifyStatus} />
              </div>
              <div className="flex items-center justify-between p-2 rounded border">
                <span>Overall</span>
                {signStatus === "pass" && verifyStatus === "pass" ? (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">PASS</Badge>
                ) : (
                  <Badge variant="outline">PENDING</Badge>
                )}
              </div>
            </div>
            {signStatus === "pass" && verifyStatus === "pass" && (
              <Alert className="mt-4 border-emerald-600/50">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle>Federation signing is operational</AlertTitle>
                <AlertDescription>
                  You may now proceed to Phase B (Authority Ingestion + Citation Backfill + Knowledge Graph Population + Historical Ledger Back-Chaining).
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
