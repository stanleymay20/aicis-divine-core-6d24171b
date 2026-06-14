import { useLocation, useNavigate } from "react-router-dom";
import { Shield, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Upgrade() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as {
    requiredTier?: string;
    currentTier?: string;
    from?: string;
    message?: string;
  };

  const required = state.requiredTier ?? "sovereign";
  const current = state.currentTier ?? "free";
  const message =
    state.message ??
    `This intelligence surface requires ${
      required === "enterprise" ? "Enterprise" : "Sovereign"
    } access.`;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
            <Lock className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Upgrade required</h1>
            <p className="text-sm text-muted-foreground">
              Current tier:{" "}
              <span className="font-mono uppercase">{current}</span> · Required:{" "}
              <span className="font-mono uppercase">{required}</span>
            </p>
          </div>
        </div>

        <p className="text-base mb-6">{message}</p>

        <div className="rounded-lg border border-border bg-muted/30 p-4 mb-6 text-sm space-y-2">
          <div className="flex items-start gap-2">
            <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <span>
              <strong>Sovereign</strong> — All 181 countries, 90-day history,
              cross-border + cross-domain analysis.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <span>
              <strong>Enterprise</strong> — Full API access, webhooks, custom
              domains.
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => navigate(state.from ?? "/app", { replace: true })}
            variant="outline"
            className="flex-1"
          >
            Back
          </Button>
          <Button
            onClick={() => navigate("/developers")}
            className="flex-1"
          >
            Contact sales
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
