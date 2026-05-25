export const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-api`;

export const ENDPOINTS = [
  { method: "GET", path: "/signals", desc: "List enriched global signals", params: "limit, category, min_impact" },
  { method: "GET", path: "/decisions", desc: "List decisions with status", params: "limit, status" },
  { method: "POST", path: "/decisions", desc: "Create a new decision from signal", params: "signal_summary, domain, severity_score" },
  { method: "GET", path: "/outcomes", desc: "List measured outcomes with ROI", params: "limit" },
  { method: "GET", path: "/priority-decisions", desc: "Top 5 priority decisions ranked by urgency", params: "none" },
  { method: "GET", path: "/domains", desc: "List all tracked domains", params: "none" },
  { method: "GET", path: "/health", desc: "System health status", params: "none" },
];

export const EVENTS = [
  { type: "signal.new", desc: "New signal ingested and enriched" },
  { type: "signal.critical", desc: "Critical-urgency signal detected" },
  { type: "decision.created", desc: "New decision created" },
  { type: "decision.executed", desc: "Decision marked as executed" },
  { type: "outcome.recorded", desc: "Outcome with ROI recorded" },
];

export const SDK_EXAMPLE = `import { AICIS } from "aicis-sdk"

const aicis = new AICIS({ apiKey: "sk_your_key_here" })

// Get today's priority decisions
const priorities = await aicis.getPriorityDecisions()
console.log(priorities)
// → [{ title: "Energy supply risk in EUR region", urgency: "critical", ... }]

// Get latest signals filtered by category
const signals = await aicis.getSignals({ 
  category: "geopolitical", 
  minImpact: 70, 
  limit: 10 
})

// Create a decision from a signal
const decision = await aicis.createDecision({
  signalSummary: "Oil supply disruption in Middle East",
  domain: "energy",
  severityScore: 85,
})

// Get measured outcomes with ROI
const outcomes = await aicis.getOutcomes({ limit: 20 })`;

export const CURL_EXAMPLE = `# List priority decisions
curl -H "x-api-key: sk_your_key" \\
  ${API_BASE}/priority-decisions

# Get signals with filters
curl -H "x-api-key: sk_your_key" \\
  "${API_BASE}/signals?category=geopolitical&min_impact=70&limit=10"

# Create a decision
curl -X POST -H "x-api-key: sk_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"signal_summary":"Oil disruption","domain":"energy","severity_score":85}' \\
  ${API_BASE}/decisions

# Check system health
curl -H "x-api-key: sk_your_key" \\
  ${API_BASE}/health`;

export const errorMessage = (error: any, fallback: string) =>
  error?.context?.error || error?.message || fallback;

export const functionErrorMessage = async (error: any, fallback: string) => {
  try {
    const body = await error?.context?.clone?.().json?.();
    return body?.error || error?.message || fallback;
  } catch {
    return error?.message || fallback;
  }
};
