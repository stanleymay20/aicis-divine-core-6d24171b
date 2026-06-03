// Vocabulary conversion: technical → minister-grade phrasing.
// Used in executive view; admin/analyst view keeps technical labels.

const EXECUTIVE_MAP: Record<string, string> = {
  "ml inference": "Intelligence Assessment",
  "ml prediction": "Intelligence Assessment",
  "ml predictions": "Intelligence Assessments",
  "z-score": "Confidence Deviation",
  "z score": "Confidence Deviation",
  "prediction engine": "Forecast Engine",
  "prediction": "Forecast",
  "predictions": "Forecasts",
  "anomaly detector": "Emerging Signal Detection",
  "anomaly detection": "Emerging Signal Detection",
  "model confidence": "Assessment Confidence",
  "risk_ml_predictions": "Forecast Engine Output",
  "risk_ranking_predictions": "Ranked Risk Outlook",
  "risk_action_recommendations": "Recommended Actions",
  "aicis_early_warnings": "Early Warnings",
  "simulation_runs": "Scenario Runs",
  "ledger_entries": "Audit Ledger",
  "intelligence_citations": "Source Citations",
  "federation_signed_bundles": "Signed Federation Bundles",
};

export function humanize(text: string, mode: "executive" | "analyst" = "executive"): string {
  if (mode === "analyst") return text;
  let out = text;
  for (const [from, to] of Object.entries(EXECUTIVE_MAP)) {
    const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, to);
  }
  return out;
}

export function confidenceLabel(c: number): "HIGH" | "MEDIUM" | "LOW" {
  if (c >= 0.75) return "HIGH";
  if (c >= 0.5) return "MEDIUM";
  return "LOW";
}
