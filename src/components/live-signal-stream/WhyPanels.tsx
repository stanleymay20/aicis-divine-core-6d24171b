import { useState } from "react";
import { Row } from "./atoms";
import { TIER_LABELS } from "./helpers";
import { type Signal } from "./types";

export function WhyRelevantPanel({ signal }: { signal: Signal }) {
  const exp = (signal.relevance_reason || {}) as Record<string, any>;
  const components = exp.components || {};
  const matches = exp.matches || {};
  return (
    <div className="mt-2 pt-2 border-t border-border/50 text-[11px] space-y-1.5">
      <div className="font-semibold text-foreground/80">Why relevant</div>
      <Row label="Visibility tier" value={`${signal.relevance_tier ?? "unknown"}${typeof signal.relevance_score === "number" ? ` · ${signal.relevance_score}/100` : ""}`} />
      {exp.explanation && <Row label="Reason" value={String(exp.explanation)} />}
      {signal.relevance_is_fallback && <Row label="Scoring mode" value="Fallback until personalized scorer catches up" />}
      {Object.keys(matches).some((k) => Array.isArray(matches[k]) && matches[k].length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(matches).map(([k, v]) => Array.isArray(v) && v.length > 0 ? (
            <Row key={k} label={k.replace(/_/g, " ")} value={v.slice(0, 4).join(", ")} />
          ) : null)}
        </div>
      )}
      <div className="mt-1 p-2 bg-muted/20 rounded font-mono text-[10px] text-muted-foreground grid grid-cols-2 sm:grid-cols-4 gap-1">
        {Object.entries(components).slice(0, 8).map(([k, v]) => (
          <span key={k}>{k}: {String(v)}</span>
        ))}
      </div>
    </div>
  );
}

export function WhyTrustPanel({ signal }: { signal: Signal }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const exp = (signal.confidence_explanation || {}) as Record<string, any>;
  const isDupe = exp.role === "duplicate";
  const distinct = Number(exp.distinct_sources ?? signal.corroboration_count ?? 1);
  const tier = String(exp.source_tier ?? signal.source_trust_tier ?? "tier_4");
  const tierLabel = TIER_LABELS[tier] || tier;
  const credibility = Number(exp.source_credibility ?? signal.source_credibility_score ?? 0);
  const propaganda = Number(exp.propaganda_risk ?? signal.propaganda_risk_score ?? 0);
  const official = Boolean(exp.official_source);
  const recency = exp.recency_factor != null ? Number(exp.recency_factor) : null;

  return (
    <div className="mt-2 pt-2 border-t border-border/50 text-[11px] space-y-1.5">
      <div className="font-semibold text-foreground/80">Why AICIS trusts this</div>
      {isDupe ? (
        <Row label="Role" value={`Duplicate of an earlier report${exp.similarity ? ` (similarity ${Math.round(Number(exp.similarity) * 100)}%)` : ""}`} />
      ) : (
        <Row label="Confirmed by" value={`${distinct} source${distinct === 1 ? "" : "s"}`} />
      )}
      <Row label="Source tier" value={tierLabel} />
      <Row label="Source credibility" value={`${credibility}/100`} />
      {official && <Row label="Official source" value="Yes" />}
      <Row label="Propaganda risk" value={`${propaganda}/100`} />
      {recency != null && <Row label="Recency factor" value={`${Math.round(recency * 100)}%`} />}

      <button
        onClick={() => setShowAdvanced(v => !v)}
        className="text-primary hover:underline text-[10px] mt-1"
      >
        {showAdvanced ? "Hide formula" : "Show scoring formula"}
      </button>
      {showAdvanced && (
        <div className="mt-1 p-2 bg-muted/20 rounded font-mono text-[10px] text-muted-foreground space-y-1">
          {exp.formula && <div>{String(exp.formula)}</div>}
          {exp.corroboration_boost != null && <div>corroboration_boost: +{exp.corroboration_boost}</div>}
          {exp.official_boost != null && <div>official_boost: +{exp.official_boost}</div>}
          {exp.propaganda_penalty != null && <div>propaganda_penalty: −{exp.propaganda_penalty}</div>}
        </div>
      )}
    </div>
  );
}
