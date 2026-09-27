export const OPPORTUNITY_ENGINE_VERSION = "aicis-opportunity-transaction-v1";

const DEFAULT_PROFILE = {
  objective: "balanced",
  risk_tolerance: "balanced",
  capital_available: null,
  max_cycle_days: 90,
  min_base_margin_pct: 3,
  min_evidence_score: 60,
  min_relevance_score: 45,
  minimum_rank_score: 58,
  max_single_opportunity_capital_pct: 35,
  allowed_transaction_types: [],
  excluded_countries: [],
  excluded_sectors: [],
  manual_approval_required: true,
};

const clamp = (value, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(value) || 0));
const arr = (value) => Array.isArray(value) ? value.filter(Boolean).map((v) => String(v).toLowerCase().trim()) : [];
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

function overlap(left, right) {
  const a = new Set(arr(left));
  return arr(right).filter((item) => a.has(item));
}

function textMatches(text, terms) {
  const haystack = String(text || "").toLowerCase();
  return arr(terms).filter((term) => term.length > 1 && haystack.includes(term));
}

function opportunityProfile(preferences = {}) {
  const raw = preferences?.alert_preferences?.opportunity_profile || preferences?.opportunity_profile || {};
  return { ...DEFAULT_PROFILE, ...raw, manual_approval_required: true };
}

function completeness(candidate) {
  const required = [
    "capital_required",
    "expected_revenue",
    "expected_cost",
    "downside_loss",
    "cycle_days",
    "probability_of_completion",
    "evidence_score",
  ];
  return required.filter((key) => !finite(candidate?.[key]));
}

function economics(candidate) {
  const profit = candidate.expected_revenue - candidate.expected_cost;
  const marginPct = candidate.expected_revenue > 0 ? (profit / candidate.expected_revenue) * 100 : 0;
  const returnOnCapitalPct = candidate.capital_required > 0 ? (profit / candidate.capital_required) * 100 : 0;
  const profitPerDay = candidate.cycle_days > 0 ? profit / candidate.cycle_days : 0;
  const p = clamp(candidate.probability_of_completion, 0, 100) / 100;
  const expectedValue = p * profit - (1 - p) * Math.max(0, candidate.downside_loss);
  const expectedReturnOnCapitalPct = candidate.capital_required > 0 ? (expectedValue / candidate.capital_required) * 100 : 0;
  return {
    base_profit: round(profit),
    base_margin_pct: round(marginPct),
    return_on_capital_pct: round(returnOnCapitalPct),
    expected_value: round(expectedValue),
    expected_return_on_capital_pct: round(expectedReturnOnCapitalPct),
    profit_per_day: round(profitPerDay),
  };
}

function relevance(candidate, preferences = {}) {
  const text = [
    candidate.title,
    candidate.summary,
    candidate.domain,
    ...(candidate.sectors || []),
    ...(candidate.entities || []),
    ...(candidate.tags || []),
  ].filter(Boolean).join(" ");

  const countryHits = overlap(preferences.countries, candidate.countries);
  const regionHits = overlap(preferences.operating_regions, candidate.regions);
  const sectorHits = overlap(
    [...(preferences.industries || []), ...(preferences.domains || [])],
    [...(candidate.sectors || []), candidate.domain].filter(Boolean),
  );
  const entityHits = textMatches(text, preferences.watched_entities);
  const keywordHits = textMatches(text, preferences.keywords);
  const priorityHits = textMatches(text, preferences.risk_priorities);

  const configured =
    arr(preferences.countries).length +
    arr(preferences.operating_regions).length +
    arr(preferences.industries).length +
    arr(preferences.domains).length +
    arr(preferences.watched_entities).length +
    arr(preferences.keywords).length +
    arr(preferences.risk_priorities).length;

  if (configured === 0) {
    return { score: 50, matches: {}, explanation: "Neutral relevance: no personalization preferences are configured yet." };
  }

  let score = 15;
  if (countryHits.length) score += 25;
  else if (regionHits.length) score += 15;
  if (sectorHits.length) score += 25;
  if (entityHits.length) score += Math.min(15, entityHits.length * 5);
  if (keywordHits.length) score += Math.min(15, keywordHits.length * 5);
  if (priorityHits.length) score += Math.min(10, priorityHits.length * 5);
  score = clamp(score);

  const matches = {
    countries: countryHits,
    regions: regionHits,
    sectors: sectorHits,
    entities: entityHits,
    keywords: keywordHits,
    priorities: priorityHits,
  };
  return {
    score,
    matches,
    explanation: score >= 70
      ? "Strong match to the user's watched geography, sectors, entities or priorities."
      : score >= 45
        ? "Partial match to the user's configured context."
        : "Low direct match to the user's configured context.",
  };
}

function buildExecutionDossier(candidate, metrics) {
  const sourceOffer = candidate?.source_offer || null;
  const saleOffer = candidate?.sale_offer || null;
  const counterparties = Array.isArray(candidate?.counterparties) ? candidate.counterparties : [];
  const route = Array.isArray(candidate?.route) ? candidate.route : [];
  const costBreakdown = Array.isArray(candidate?.cost_breakdown) ? candidate.cost_breakdown : [];
  const contacts = Array.isArray(candidate?.contacts) ? candidate.contacts : [];
  const nextActions = Array.isArray(candidate?.next_actions) ? candidate.next_actions : [];
  const missing = [];

  if (!sourceOffer?.name) missing.push("source_offer");
  if (!saleOffer?.name) missing.push("sale_offer");
  if (counterparties.length < 2) missing.push("counterparties");
  if (route.length === 0) missing.push("route");
  if (costBreakdown.length === 0) missing.push("cost_breakdown");
  if (contacts.length === 0) missing.push("contacts");
  if (!candidate?.timing) missing.push("timing");

  return {
    execution_ready: missing.length === 0 &&
      candidate?.compliance_status === "clear" &&
      ["verified_quotes", "observed_market", "contractually_indicated"].includes(candidate?.economics_status),
    missing_execution_fields: missing,
    where: {
      source: sourceOffer,
      destination: saleOffer,
      route,
    },
    who: {
      counterparties,
      contacts,
    },
    when: candidate?.timing || null,
    how: {
      transaction_type: candidate?.transaction_type || null,
      next_actions: nextActions,
      settlement: candidate?.settlement || null,
      logistics: candidate?.logistics || null,
    },
    profitability: {
      downside: finite(candidate?.downside_loss) ? -Math.abs(candidate.downside_loss) : null,
      base: metrics?.base_profit ?? null,
      upside: finite(candidate?.upside_profit) ? candidate.upside_profit : null,
      expected_value: metrics?.expected_value ?? null,
      base_margin_pct: metrics?.base_margin_pct ?? null,
      return_on_capital_pct: metrics?.return_on_capital_pct ?? null,
      profit_per_day: metrics?.profit_per_day ?? null,
    },
    cost_breakdown: costBreakdown,
  };
}

function objectiveScore(metrics, candidate, profile) {
  const profitNorm = clamp(metrics.base_profit > 0 && candidate.capital_required > 0
    ? (metrics.base_profit / candidate.capital_required) * 500
    : 0);
  const rocNorm = clamp(metrics.return_on_capital_pct * 4);
  const velocityNorm = clamp(metrics.profit_per_day > 0 && candidate.capital_required > 0
    ? (metrics.profit_per_day / candidate.capital_required) * 10000
    : 0);
  const downsidePct = candidate.capital_required > 0 ? (candidate.downside_loss / candidate.capital_required) * 100 : 100;
  const preservationNorm = clamp(100 - downsidePct * 5);
  const expectedNorm = clamp(metrics.expected_return_on_capital_pct * 5);

  switch (profile.objective) {
    case "net_profit": return profitNorm;
    case "return_on_capital": return rocNorm;
    case "profit_velocity": return velocityNorm;
    case "capital_preservation": return preservationNorm;
    default: return clamp((rocNorm * 0.25) + (expectedNorm * 0.30) + (velocityNorm * 0.15) + (preservationNorm * 0.30));
  }
}

function riskFit(candidate, profile) {
  const capital = Math.max(1, candidate.capital_required || 1);
  const downsidePct = (Math.max(0, candidate.downside_loss || 0) / capital) * 100;
  const p = clamp(candidate.probability_of_completion);
  const base = clamp((p * 0.65) + ((100 - clamp(downsidePct * 5)) * 0.35));
  if (profile.risk_tolerance === "low") return clamp(base - downsidePct * 1.5);
  if (profile.risk_tolerance === "high") return clamp(base + 5);
  return base;
}

export function evaluateOpportunity(candidate, preferences = {}) {
  const profile = opportunityProfile(preferences);
  const rejection_reasons = [];
  const missing = completeness(candidate);

  if (missing.length) rejection_reasons.push(...missing.map((key) => `missing_numeric_input:${key}`));
  if (!candidate?.id) rejection_reasons.push("missing_id");
  if (!candidate?.title) rejection_reasons.push("missing_title");
  if (!candidate?.transaction_type) rejection_reasons.push("missing_transaction_type");
  if (!candidate?.compliance_status) rejection_reasons.push("missing_compliance_status");
  if (!candidate?.economics_status || ["insufficient", "synthetic", "unverified"].includes(candidate.economics_status)) {
    rejection_reasons.push("economics_not_verified");
  }
  if (candidate?.compliance_status === "blocked") rejection_reasons.push("compliance_blocked");
  if (candidate?.compliance_status === "unknown") rejection_reasons.push("compliance_unknown");
  if (candidate?.evidence_score != null && candidate.evidence_score < profile.min_evidence_score) rejection_reasons.push("evidence_below_threshold");
  if (candidate?.cycle_days != null && candidate.cycle_days > profile.max_cycle_days) rejection_reasons.push("cycle_exceeds_user_limit");
  if (profile.allowed_transaction_types.length && !arr(profile.allowed_transaction_types).includes(String(candidate?.transaction_type || "").toLowerCase())) {
    rejection_reasons.push("transaction_type_not_allowed");
  }
  if (overlap(profile.excluded_countries, candidate?.countries).length) rejection_reasons.push("excluded_country");
  if (overlap(profile.excluded_sectors, candidate?.sectors).length) rejection_reasons.push("excluded_sector");

  if (finite(profile.capital_available) && finite(candidate?.capital_required)) {
    if (candidate.capital_required > profile.capital_available) rejection_reasons.push("capital_required_exceeds_available");
    const singleLimit = profile.capital_available * (profile.max_single_opportunity_capital_pct / 100);
    if (candidate.capital_required > singleLimit) rejection_reasons.push("single_opportunity_capital_limit_exceeded");
  }

  if (rejection_reasons.some((reason) => reason.startsWith("missing_"))) {
    return { eligible: false, candidate_id: candidate?.id || null, rejection_reasons, score: 0 };
  }

  const metrics = economics(candidate);
  const dossier = buildExecutionDossier(candidate, metrics);
  if (metrics.base_margin_pct < profile.min_base_margin_pct) rejection_reasons.push("base_margin_below_threshold");

  const rel = relevance(candidate, preferences);
  if (rel.score < profile.min_relevance_score) rejection_reasons.push("relevance_below_threshold");

  const evidence = clamp(candidate.evidence_score);
  const counterparty = clamp(candidate.counterparty_quality_score ?? 50);
  const liquidity = clamp(candidate.liquidity_score ?? 50);
  const objective = objectiveScore(metrics, candidate, profile);
  const risk = riskFit(candidate, profile);

  let score = (
    objective * 0.30 +
    risk * 0.20 +
    evidence * 0.15 +
    rel.score * 0.20 +
    counterparty * 0.10 +
    liquidity * 0.05
  );

  if (candidate.compliance_status === "review") score -= 12;
  if (candidate.market_freshness_minutes != null && candidate.market_freshness_minutes > 1440) score -= 8;
  score = clamp(round(score, 1));

  const hardReject = rejection_reasons.some((reason) => [
    "economics_not_verified",
    "compliance_blocked",
    "compliance_unknown",
    "capital_required_exceeds_available",
    "single_opportunity_capital_limit_exceeded",
    "transaction_type_not_allowed",
    "excluded_country",
    "excluded_sector",
    "evidence_below_threshold",
    "base_margin_below_threshold",
    "relevance_below_threshold",
    "cycle_exceeds_user_limit",
  ].includes(reason));

  return {
    eligible: !hardReject,
    candidate_id: candidate.id,
    title: candidate.title,
    transaction_type: candidate.transaction_type,
    capital_required: candidate.capital_required,
    currency: candidate.currency ?? null,
    countries: candidate.countries ?? [],
    sectors: candidate.sectors ?? [],
    score,
    metrics,
    components: {
      objective_score: round(objective, 1),
      risk_fit_score: round(risk, 1),
      evidence_score: round(evidence, 1),
      relevance_score: round(rel.score, 1),
      counterparty_quality_score: round(counterparty, 1),
      liquidity_score: round(liquidity, 1),
    },
    relevance: rel,
    rejection_reasons,
    execution_ready: dossier.execution_ready,
    execution_dossier: dossier,
    human_approval_required: true,
    recommendation_semantics: "ranked_decision_support_not_profit_guarantee",
  };
}

export function rankOpportunities(candidates = [], preferences = {}) {
  const profile = opportunityProfile(preferences);
  const evaluations = candidates.map((candidate) => evaluateOpportunity(candidate, preferences));
  const eligible = evaluations
    .filter((item) => item.eligible)
    .sort((a, b) => b.score - a.score);
  const rejected = evaluations.filter((item) => !item.eligible);
  const top = eligible[0] || null;
  const noTransaction = !top || top.score < profile.minimum_rank_score;

  return {
    engine_version: OPPORTUNITY_ENGINE_VERSION,
    evaluated_count: candidates.length,
    eligible_count: eligible.length,
    rejected_count: rejected.length,
    no_transaction_recommended: noTransaction,
    no_transaction_reason: noTransaction
      ? top
        ? `Top eligible candidate scored ${top.score}, below the user's minimum rank threshold of ${profile.minimum_rank_score}.`
        : "No candidate cleared the user's evidence, relevance, economics, compliance, capital and risk constraints."
      : null,
    top_ranked: noTransaction ? null : top,
    ranked: eligible,
    rejected,
    ranking_scope_notice: "Rankings are only among candidates supplied to this engine; AICIS must not describe them as globally best unless candidate coverage is demonstrably exhaustive.",
    human_approval_required: true,
  };
}

export function extractOpportunityProfile(preferences = {}) {
  return opportunityProfile(preferences);
}
