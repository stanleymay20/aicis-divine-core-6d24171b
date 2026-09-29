import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MFA_ASSURANCE_QUERY_KEY } from "@/hooks/useMfaAssurance";
import {
  deriveMfaState,
  isValidTotpCode,
  safeMfaNext,
  staleUnverifiedFactorIds,
  type MfaState,
} from "@/lib/mfa-state.mjs";

type Factor = { id: string; status: string; factor_type: string; friendly_name?: string | null };
type Enrollment = { factorId: string; qrCode: string; secret: string };

/**
 * Two-step sign-in (TOTP) setup and verification.
 * The TOTP secret lives only in Supabase Auth and in this component's memory
 * while the QR is on screen; codes are never persisted.
 */
const AccountSecurity = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const next = params.get("next") ? safeMfaNext(params.get("next")) : null;

  const [state, setState] = useState<MfaState>("loading");
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [{ data: aal, error: aalError }, { data: list, error: listError }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (aalError || listError) {
      setError((aalError ?? listError)!.message);
      return;
    }
    const all = ((list?.all ?? []) as Factor[]).filter((f) => f.factor_type === "totp");
    setFactors(all);
    setState(deriveMfaState({ currentLevel: aal?.currentLevel, nextLevel: aal?.nextLevel, factors: all }));
    void queryClient.invalidateQueries({ queryKey: [MFA_ASSURANCE_QUERY_KEY] });
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const id of staleUnverifiedFactorIds(factors)) {
        await supabase.auth.mfa.unenroll({ factorId: id });
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `AICIS authenticator ${new Date().toISOString().slice(0, 10)}`,
      });
      if (enrollError) throw enrollError;
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start setup.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidTotpCode(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    const factorId = enrollment?.factorId ?? factors.find((f) => f.status === "verified")?.id;
    if (!factorId) {
      setError("No authenticator is set up yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (verifyError) throw verifyError;
      setEnrollment(null);
      setCode("");
      await refresh();
      if (next) navigate(next, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code was not accepted.");
    } finally {
      setBusy(false);
    }
  };

  const removeFactor = async (factorId: string) => {
    setBusy(true);
    setError(null);
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
    if (unenrollError) setError(unenrollError.message);
    await supabase.auth.refreshSession();
    await refresh();
    setBusy(false);
  };

  const codeForm = (
    <form onSubmit={verify} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label htmlFor="totp-code" className="mb-1 block text-sm text-muted-foreground">6-digit code</label>
        <Input
          id="totp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="123456"
          className="font-mono tracking-widest"
        />
      </div>
      <Button type="submit" disabled={busy || code.length !== 6}>Verify</Button>
    </form>
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Account security</h1>
        <p className="text-sm text-muted-foreground">Two-step sign-in protects administrator actions.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {state === "verified" ? <ShieldCheck className="h-5 w-5 text-primary" /> : <ShieldAlert className="h-5 w-5 text-muted-foreground" />}
            Two-step sign-in
            <Badge variant={state === "verified" ? "default" : "secondary"} data-testid="mfa-status">
              {state === "loading" && "Checking…"}
              {state === "not_enrolled" && "Not set up"}
              {state === "challenge_required" && "Set up — verify this session"}
              {state === "verified" && "Verified this session"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Uses an authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          {state === "not_enrolled" && !enrollment && (
            <Button onClick={startEnrollment} disabled={busy}>
              <KeyRound className="mr-2 h-4 w-4" /> Set up authenticator
            </Button>
          )}

          {enrollment && (
            <div className="space-y-4">
              <p className="text-sm">1. Scan this QR code with your authenticator app.</p>
              <div className="inline-block rounded-md bg-card p-3 ring-1 ring-border">
                <img src={enrollment.qrCode} alt="Authenticator QR code" className="h-44 w-44" />
              </div>
              <p className="text-xs text-muted-foreground">
                Can't scan? Enter this key manually: <code className="break-all font-mono">{enrollment.secret}</code>
              </p>
              <p className="text-sm">2. Enter the 6-digit code it shows.</p>
              {codeForm}
            </div>
          )}

          {state === "challenge_required" && !enrollment && (
            <div className="space-y-3">
              <p className="text-sm">Enter the code from your authenticator app to verify this session.</p>
              {codeForm}
            </div>
          )}

          {state === "verified" && next && (
            <Button onClick={() => navigate(next, { replace: true })}>Continue</Button>
          )}

          {factors.some((f) => f.status === "verified") && state === "verified" && (
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-sm text-muted-foreground">Registered authenticators</p>
              {factors.filter((f) => f.status === "verified").map((f) => (
                <div key={f.id} className="flex items-center justify-between py-1 text-sm">
                  <span>{f.friendly_name || "Authenticator"}</span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => removeFactor(f.id)}>Remove</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AccountSecurity;
