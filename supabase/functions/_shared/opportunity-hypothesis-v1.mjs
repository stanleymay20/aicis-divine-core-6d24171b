export const OPPORTUNITY_HYPOTHESIS_VERSION = "aicis-opportunity-hypothesis-v1";

const PRODUCT_RULES = [
  { id: "cocoa-beans", name: "Cocoa beans", unit: "tonne", sectors: ["agriculture", "food"], keywords: ["cocoa"] },
  { id: "coffee", name: "Coffee", unit: "tonne", sectors: ["agriculture", "food"], keywords: ["coffee"] },
  { id: "wheat", name: "Wheat", unit: "tonne", sectors: ["agriculture", "food"], keywords: ["wheat"] },
  { id: "maize", name: "Maize / corn", unit: "tonne", sectors: ["agriculture", "food"], keywords: ["maize", "corn"] },
  { id: "rice", name: "Rice", unit: "tonne", sectors: ["agriculture", "food"], keywords: ["rice"] },
  { id: "potash", name: "Potash", unit: "tonne", sectors: ["fertilizer", "agriculture"], keywords: ["potash"] },
  { id: "phosphate-fertilizer", name: "Phosphate fertilizer", unit: "tonne", sectors: ["fertilizer", "agriculture"], keywords: ["phosphate", "phosphatic fertilizer"] },
  { id: "nitrogen-fertilizer", name: "Nitrogen fertilizer", unit: "tonne", sectors: ["fertilizer", "agriculture"], keywords: ["nitrogen fertilizer", "urea", "ammonia"] },
  { id: "crude-oil", name: "Crude oil", unit: "barrel", sectors: ["energy"], keywords: ["crude oil", "oil supply", "oil export", "oil production"] },
  { id: "lng", name: "Liquefied natural gas", unit: "energy_unit", sectors: ["energy"], keywords: ["lng", "liquefied natural gas"] },
  { id: "natural-gas", name: "Natural gas", unit: "energy_unit", sectors: ["energy"], keywords: ["natural gas", "gas pipeline", "gas supply"] },
  { id: "copper", name: "Copper", unit: "tonne", sectors: ["mining", "metals"], keywords: ["copper"] },
  { id: "cobalt", name: "Cobalt", unit: "tonne", sectors: ["mining", "critical_minerals"], keywords: ["cobalt"] },
  { id: "lithium", name: "Lithium", unit: "tonne", sectors: ["mining", "critical_minerals", "battery"], keywords: ["lithium"] },
  { id: "nickel", name: "Nickel", unit: "tonne", sectors: ["mining", "critical_minerals", "battery"], keywords: ["nickel"] },
  { id: "gallium", name: "Gallium", unit: "kg", sectors: ["critical_minerals", "semiconductors"], keywords: ["gallium"] },
  { id: "germanium", name: "Germanium", unit: "kg", sectors: ["critical_minerals", "semiconductors"], keywords: ["germanium"] },
  { id: "semiconductor-components", name: "Semiconductor components", unit: "unit", sectors: ["technology", "semiconductors"], keywords: ["semiconductor", "microchip", "chips", "wafer", "foundry"] },
  { id: "container-freight", name: "Container freight capacity", unit: "container_slot", sectors: ["logistics", "shipping"], keywords: ["container freight", "container shipping", "port congestion"] },
  { id: "tanker-freight", name: "Tanker freight capacity", unit: "freight_capacity", sectors: ["logistics", "shipping", "energy"], keywords: ["tanker", "strait of hormuz", "bab el-mandeb"] },
];

const DISRUPTION_TERMS = [
  "shortage", "disruption", "strike", "export ban", "restriction", "sanction", "closure",
  "drought", "flood", "war", "conflict", "outage", "blackout", "delay", "congestion",
  "tariff", "embargo", "production cut", "supply shock",
];

function textOf(signal) {
  return [
    signal?.title,
    signal?.summary,
    signal?.category,
    signal?.subcategory,
    ...(signal?.affected_sectors || []),
    ...(signal?.affected_stakeholders || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function productMatches(text) {
  return PRODUCT_RULES.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword)));
}

function catalystType(text) {
  const matched = DISRUPTION_TERMS.filter((term) => text.includes(term));
  return matched.length ? { type: "disruption_or_constraint", terms: matched } : { type: "market_change", terms: [] };
}

function evidenceManifest(signal) {
  const refs = Array.isArray(signal?.source_references) ? signal.source_references : [];
  return {
    source_signal_id: signal?.id ?? null,
    signal_evidence_hash: signal?.evidence_hash ?? null,
    source_references: refs,
    source_identifier_count: signal?.source_identifier_count ?? refs.length,
    source_independence_status: signal?.source_independence_status ?? "not_assessed",
  };
}

export function hypothesesForSignal(signal, relevance = null) {
  if (!signal?.id || !signal?.title) return [];
  const text = textOf(signal);
  const matches = productMatches(text);
  if (!matches.length) return [];

  const catalyst = catalystType(text);

  return matches.map((product) => ({
    hypothesis_id: ["hyp", signal.id, product.id].join(":"),
    hypothesis_version: OPPORTUNITY_HYPOTHESIS_VERSION,
    source_signal_id: signal.id,
    source_signal_title: signal.title,
    product: {
      id: product.id,
      name: product.name,
      unit: product.unit,
      sectors: product.sectors,
    },
    countries: signal.affected_countries ?? [],
    regions: signal.affected_regions ?? [],
    affected_sectors: signal.affected_sectors ?? [],
    catalyst_type: catalyst.type,
    matched_catalyst_terms: catalyst.terms,
    relevance_score: typeof relevance?.relevance_score === "number" ? relevance.relevance_score : null,
    relevance_tier: relevance?.relevance_tier ?? null,
    opportunity_type: "transaction_path_research",
    epistemic_status: "hypothesis_not_transaction",
    transaction_eligible: false,
    profitability_status: "unknown_until_verified_quotes_and_costs",
    evidence_manifest: evidenceManifest(signal),
    next_steps: [
      "discover_candidate_suppliers_buyers_or_logistics_providers",
      "verify_counterparty_identity_and_compliance",
      "obtain_current_attributable_quotes",
      "build_full_transaction_paths",
      "rank_against_user_preferences_and_capital_constraints",
    ],
    guardrail: "This hypothesis identifies a product-market relationship worth investigating; it does not assert price direction, profit, causality, or execution suitability.",
  }));
}

export function generateOpportunityHypotheses(signals = [], relevanceBySignal = {}) {
  const hypotheses = [];
  for (const signal of Array.isArray(signals) ? signals : []) {
    const relevance = relevanceBySignal?.[signal?.id] ?? null;
    hypotheses.push(...hypothesesForSignal(signal, relevance));
  }

  return hypotheses.sort((a, b) => {
    const ar = typeof a.relevance_score === "number" ? a.relevance_score : -1;
    const br = typeof b.relevance_score === "number" ? b.relevance_score : -1;
    return br - ar;
  });
}
