
export const STRATEGIC_DOCTRINE_ENGINE_VERSION = "aicis-strategic-doctrine-v1";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const clamp = (value, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(value) || 0));
const lower = (value) => String(value ?? "").trim().toLowerCase();
const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

const DOCTRINES = {
  know_self: {
    id: "know_self",
    source: "sunzi_derived",
    status: "experimental",
    falsifiable_claim: "Strategies aligned with verified actor capabilities should fail less often from execution infeasibility.",
    measurement_hint: "execution_failure_rate_due_to_capability_gap",
    principle: "Assess the actor's actual capabilities and constraints before selecting a strategy.",
  },
  know_terrain: {
    id: "know_terrain",
    source: "sunzi_derived",
    status: "experimental",
    falsifiable_claim: "Strategies that explicitly model material terrain constraints should suffer fewer unanticipated operational failures.",
    measurement_hint: "unanticipated_operational_failure_rate",
    principle: "Evaluate geography, regulation, infrastructure, market structure and operating conditions.",
  },
  timing: {
    id: "timing",
    source: "sunzi_derived",
    status: "experimental",
    falsifiable_claim: "Strategies executed within evidence-backed windows should outperform otherwise comparable late actions.",
    measurement_hint: "realized_value_vs_timing_window",
    principle: "Treat timing and opportunity windows as part of strategy, not metadata.",
  },
  economy_of_force: {
    id: "economy_of_force",
    source: "sunzi_derived",
    status: "experimental",
    falsifiable_claim: "For comparable objectives, lower unnecessary capital exposure should improve risk-adjusted realized value.",
    measurement_hint: "incremental_value_per_capital_at_risk",
    principle: "Prefer strategies that achieve the objective with lower unnecessary capital, exposure or friction when outcomes are comparable.",
  },
  indirect_approach: {
    id: "indirect_approach",
    source: "sunzi_derived",
    status: "experimental",
    falsifiable_claim: "Evidence-backed indirect strategies can outperform direct strategies when they achieve similar objectives with lower exposure.",
    measurement_hint: "risk_adjusted_incremental_value_vs_direct_comparator",
    principle: "Consider indirect structures such as brokerage, partnership or financing instead of assuming principal ownership is best.",
  },
  formlessness: {
    id: "formlessness",
    source: "sunzi_derived",
    status: "experimental",
    falsifiable_claim: "Contingent strategies with explicit switching rules should reduce losses when conditions change materially.",
    measurement_hint: "loss_avoided_after_invalidation_or_switch",
    principle: "Represent strategy as a contingent policy with invalidation and switching conditions.",
  },
  foreknowledge: {
    id: "foreknowledge",
    source: "sunzi_derived",
    status: "experimental",
    falsifiable_claim: "Decision-relevant information should improve outcomes when its realized decision-loss reduction exceeds acquisition cost.",
    measurement_hint: "realized_information_value",
    principle: "Acquire decision-relevant information before irreversible commitment when information value exceeds its cost.",
  },
};

function profile(preferences = {}) {
  const raw = preferences?.alert_preferences?.opportunity_profile || preferences?.opportunity_profile || {};
  return {
    capital_available: finite(raw.capital_available) ? raw.capital_available : null,
    risk_tolerance: ["low", "balanced", "high"].includes(raw.risk_tolerance) ? raw.risk_tolerance : "balanced",
    objective: raw.objective || "balanced",
    max_cycle_days: finite(raw.max_cycle_days) ? raw.max_cycle_days : 90,
    required_reserve_pct: finite(raw.reserve_pct) ? clamp(raw.reserve_pct, 0, 90) : 10,
  };
}

function capabilitySet(state = {}) {
  const values = [
    ...list(state.capabilities),
    ...list(state.licenses),
    ...list(state.relationships),
    ...list(state.infrastructure),
  ];
  return new Set(values.map(lower));
}

function optionEvidenceValid(option) {
  return finite(option?.evidence_score) && option.evidence_score >= 0 && option.evidence_score <= 100;
}

function normalizedOption(raw, fallback = {}) {
  const metrics = raw.metrics || {};
  const informationCost = finite(raw.information_cost) ? Math.max(0, raw.information_cost) : null;
  const decisionLossReduction = finite(raw.expected_decision_loss_reduction)
    ? Math.max(0, raw.expected_decision_loss_reduction)
    : null;
  const commitmentCost = finite(raw.commitment_cost) ? Math.max(0, raw.commitment_cost) : null;
  const optionValueEstimate = finite(raw.option_value_estimate) ? Math.max(0, raw.option_value_estimate) : null;
  const informationEvidenceBacked = list(raw.evidence_refs).length > 0;
  const derivedInformationValue = informationCost != null &&
    decisionLossReduction != null &&
    informationEvidenceBacked
    ? decisionLossReduction - informationCost
    : null;
  const positionEvidenceBacked = list(raw.evidence_refs).length > 0;
  const derivedPositionValue = commitmentCost != null &&
    optionValueEstimate != null &&
    positionEvidenceBacked
    ? optionValueEstimate - commitmentCost
    : null;
  return {
    id: raw.id || fallback.id,
    title: raw.title || fallback.title,
    strategy_type: raw.strategy_type || fallback.strategy_type || "unknown",
    source_candidate_id: raw.source_candidate_id || fallback.source_candidate_id || null,
    directness: raw.directness || fallback.directness || "direct",
    transaction_type: raw.transaction_type || fallback.transaction_type || null,
    currency: String(raw.currency || fallback.currency || "").trim().toUpperCase() || null,
    research_only: raw.research_only === true,
    executable_input: raw.executable_input === true,
    capital_required: finite(raw.capital_required) ? raw.capital_required : null,
    cycle_days: finite(raw.cycle_days) ? raw.cycle_days : null,
    evidence_score: finite(raw.evidence_score) ? raw.evidence_score : null,
    downside_loss: finite(raw.downside_loss) ? Math.max(0, raw.downside_loss) : null,
    expected_value: finite(raw.expected_value)
      ? raw.expected_value
      : finite(metrics.expected_value)
        ? metrics.expected_value
        : finite(derivedInformationValue)
          ? derivedInformationValue
          : finite(derivedPositionValue)
            ? derivedPositionValue
            : null,
    base_profit: finite(raw.base_profit)
      ? raw.base_profit
      : finite(metrics.base_profit)
        ? metrics.base_profit
        : finite(derivedInformationValue)
          ? derivedInformationValue
          : finite(derivedPositionValue)
            ? derivedPositionValue
            : null,
    information_cost: informationCost,
    expected_decision_loss_reduction: decisionLossReduction,
    information_value_estimate: finite(derivedInformationValue) ? round(derivedInformationValue) : null,
    commitment_cost: commitmentCost,
    option_value_estimate: optionValueEstimate,
    net_position_value_estimate: finite(derivedPositionValue) ? round(derivedPositionValue) : null,
    sequence_steps: list(raw.sequence_steps),
    assumptions: list(raw.assumptions),
    sensitivity_cases: list(raw.sensitivity_cases),
    reversibility_score: finite(raw.reversibility_score) ? clamp(raw.reversibility_score) : 50,
    execution_friction_score: finite(raw.execution_friction_score) ? clamp(raw.execution_friction_score) : 50,
    required_capabilities: list(raw.required_capabilities).map(String),
    invalidation_rules: list(raw.invalidation_rules),
    switching_rules: list(raw.switching_rules),
    scenarios: list(raw.scenarios),
    evidence_refs: list(raw.evidence_refs),
    metadata: raw.metadata || {},
  };
}

function transactionDirectness(transactionType) {
  const type = lower(transactionType);
  if ([
    "brokerage",
    "broker",
    "agency",
    "introduction",
    "referral",
    "financing",
    "licensing",
    "partnership",
    "distribution_rights",
  ].includes(type)) return "indirect";
  return "direct";
}

function transactionOption(candidate) {
  const id = candidate.candidate_id || candidate.id;
  return normalizedOption({
    id: "strategy:direct:" + id,
    title: "Direct execution — " + (candidate.title || "candidate"),
    strategy_type: "direct_transaction",
    source_candidate_id: id || null,
    directness: transactionDirectness(candidate.transaction_type),
    transaction_type: candidate.transaction_type || null,
    currency: candidate.currency || null,
    research_only: false,
    executable_input: candidate.execution_ready === true,
    capital_required: candidate.capital_required,
    cycle_days: candidate?.execution_dossier?.when?.cycle_days ?? candidate?.cycle_days ?? null,
    evidence_score: candidate?.components?.evidence_score ?? candidate?.evidence_score ?? null,
    downside_loss: candidate?.execution_dossier?.profitability?.downside != null
      ? Math.abs(candidate.execution_dossier.profitability.downside)
      : candidate?.downside_loss ?? null,
    expected_value: candidate?.metrics?.expected_value ?? null,
    base_profit: candidate?.metrics?.base_profit ?? null,
    reversibility_score: candidate.execution_ready ? 30 : 20,
    execution_friction_score: candidate.execution_ready ? 55 : 80,
    required_capabilities: candidate.required_capabilities || [],
    sequence_steps: candidate?.execution_dossier?.how?.next_actions || [],
    assumptions: candidate.assumptions || [],
    sensitivity_cases: candidate.sensitivity_cases || [],
    invalidation_rules: candidate.invalidation_rules || [],
    switching_rules: candidate.switching_rules || [],
    scenarios: candidate.scenarios || [],
    evidence_refs: candidate.evidence_refs || [],
    metadata: {
      rank_score: candidate.score ?? null,
      original_execution_ready: candidate.execution_ready === true,
    },
  });
}

function suppliedAlternatives(candidate) {
  const groups = [
    ["indirect_strategies", "indirect"],
    ["position_options", "position_building"],
    ["information_actions", "information_gathering"],
  ];
  const options = [];

  for (const [key, type] of groups) {
    for (const raw of list(candidate?.[key])) {
      options.push(normalizedOption({
        ...raw,
        strategy_type: raw.strategy_type || type,
        source_candidate_id: candidate.candidate_id || candidate.id || null,
        directness: type === "indirect" ? "indirect" : "non_transactional",
        currency: raw.currency || candidate.currency || null,
        research_only: raw.research_only === true || (
          !finite(raw.expected_value) &&
          !(
            (type === "information_gathering" &&
              finite(raw.information_cost) &&
              finite(raw.expected_decision_loss_reduction) &&
              list(raw.evidence_refs).length > 0) ||
            (type === "position_building" &&
              finite(raw.commitment_cost) &&
              finite(raw.option_value_estimate) &&
              list(raw.evidence_refs).length > 0)
          )
        ),
        executable_input: raw.executable_input === true,
      }));
    }
  }
  return options;
}

function noActionOption(candidate) {
  const id = candidate.candidate_id || candidate.id;
  return normalizedOption({
    id: "strategy:no-action:" + id,
    title: "No action — " + (candidate.title || "candidate"),
    strategy_type: "no_action",
    source_candidate_id: id || null,
    directness: "none",
    currency: candidate.currency || null,
    research_only: false,
    executable_input: true,
    capital_required: 0,
    cycle_days: 0,
    evidence_score: 100,
    downside_loss: 0,
    expected_value: 0,
    base_profit: 0,
    reversibility_score: 100,
    execution_friction_score: 0,
    required_capabilities: [],
    sequence_steps: [],
    assumptions: [],
    sensitivity_cases: [],
    invalidation_rules: [],
    switching_rules: [],
    scenarios: candidate.no_action_scenarios || [],
    metadata: { semantic: "preserve_capital_and_optionality" },
  });
}

function feasibility(option, actorState, preferences) {
  const p = profile(preferences);
  const capabilities = capabilitySet(actorState);
  const reasons = [];
  const missingCapabilities = option.required_capabilities.filter((item) => !capabilities.has(lower(item)));
  const capitalAvailable = finite(actorState?.capital_available)
    ? actorState.capital_available
    : p.capital_available;
  const deployableCapital = finite(capitalAvailable)
    ? capitalAvailable * (1 - p.required_reserve_pct / 100)
    : null;

  if (missingCapabilities.length) reasons.push("missing_required_capabilities");
  if (finite(deployableCapital) && finite(option.capital_required) && option.capital_required > deployableCapital) {
    reasons.push("capital_required_exceeds_deployable_after_reserve");
  }
  if (finite(option.cycle_days) && option.cycle_days > p.max_cycle_days) reasons.push("cycle_exceeds_user_limit");
  if (option.strategy_type !== "no_action" && !optionEvidenceValid(option)) reasons.push("evidence_score_missing");
  if (option.strategy_type !== "no_action" && option.expected_value == null) reasons.push("expected_value_unknown");
  if (option.strategy_type !== "no_action" && !option.currency) reasons.push("currency_unknown");
  if (option.research_only) reasons.push("research_only");

  const hard = reasons.some((reason) => [
    "missing_required_capabilities",
    "capital_required_exceeds_deployable_after_reserve",
    "cycle_exceeds_user_limit",
    "evidence_score_missing",
    "expected_value_unknown",
    "currency_unknown",
  ].includes(reason));

  return { feasible: !hard, reasons, missing_capabilities: missingCapabilities };
}

function scenarioMap(option) {
  const map = new Map();
  for (const scenario of option.scenarios) {
    if (!scenario?.id || !finite(scenario?.net_value)) continue;
    map.set(String(scenario.id), scenario.net_value);
  }
  return map;
}

function robustness(option) {
  const values = [...scenarioMap(option).values()];
  if (!values.length) {
    return {
      scenario_count: 0,
      worst_case: null,
      best_case: null,
      average_case: option.expected_value,
      robustness_score: null,
    };
  }
  const worst = Math.min(...values);
  const best = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const capital = Math.max(1, option.capital_required || 1);
  const downsideRatio = Math.max(0, -worst) / capital;
  return {
    scenario_count: values.length,
    worst_case: round(worst),
    best_case: round(best),
    average_case: round(avg),
    robustness_score: round(clamp(100 - downsideRatio * 100), 1),
  };
}

function sensitivityAnalysis(option) {
  const baseline = option.expected_value;
  const cases = list(option.sensitivity_cases)
    .filter((item) =>
      item &&
      item.id &&
      finite(item.shocked_expected_value) &&
      finite(baseline)
    )
    .map((item) => ({
      id: String(item.id),
      assumption: String(item.assumption || item.label || item.id),
      baseline_value: item.baseline_value ?? null,
      shocked_value: item.shocked_value ?? null,
      shocked_expected_value: round(item.shocked_expected_value),
      delta_expected_value: round(item.shocked_expected_value - baseline),
      evidence_refs: list(item.evidence_refs),
    }))
    .sort((a, b) => Math.abs(b.delta_expected_value) - Math.abs(a.delta_expected_value));

  return {
    case_count: cases.length,
    cases,
    largest_absolute_delta: cases.length ? Math.abs(cases[0].delta_expected_value) : null,
    worst_delta: cases.length ? Math.min(...cases.map((item) => item.delta_expected_value)) : null,
    most_sensitive_assumption: cases.length ? cases[0].assumption : null,
    semantics: "supplied_sensitivity_cases_not_probability_distribution",
  };
}

function regretByScenario(options) {
  const scenarioIds = new Set();
  const maps = new Map();

  for (const option of options) {
    const map = scenarioMap(option);
    maps.set(option.id, map);
    for (const id of map.keys()) scenarioIds.add(id);
  }

  const regrets = new Map(options.map((option) => [option.id, []]));
  for (const scenarioId of scenarioIds) {
    const observed = options
      .map((option) => ({ id: option.id, value: maps.get(option.id)?.get(scenarioId) }))
      .filter((item) => finite(item.value));
    if (observed.length < 2) continue;
    const best = Math.max(...observed.map((item) => item.value));
    for (const item of observed) regrets.get(item.id).push(best - item.value);
  }

  return new Map(options.map((option) => {
    const values = regrets.get(option.id) || [];
    return [option.id, {
      comparable_scenarios: values.length,
      max_regret: values.length ? round(Math.max(...values)) : null,
      average_regret: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    }];
  }));
}

function dominates(a, b) {
  const dims = [
    [a.expected_value, b.expected_value],
    [-(a.capital_required ?? Infinity), -(b.capital_required ?? Infinity)],
    [-(a.downside_loss ?? Infinity), -(b.downside_loss ?? Infinity)],
    [a.reversibility_score, b.reversibility_score],
    [-(a.execution_friction_score ?? Infinity), -(b.execution_friction_score ?? Infinity)],
    [a.evidence_score, b.evidence_score],
  ].filter(([left, right]) => finite(left) && finite(right));

  if (!dims.length) return false;
  const noWorse = dims.every(([left, right]) => left >= right);
  const strictlyBetter = dims.some(([left, right]) => left > right);
  return noWorse && strictlyBetter;
}

function paretoFront(options) {
  return options.filter((candidate, index) =>
    !options.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate))
  );
}

function economyOfForce(option) {
  if (!finite(option.expected_value) || !finite(option.capital_required)) return null;
  if (option.capital_required === 0) return option.expected_value > 0 ? null : 0;
  return round(option.expected_value / option.capital_required, 6);
}

function strategicFit(option, preferences) {
  const p = profile(preferences);
  if (option.strategy_type === "no_action") {
    return p.risk_tolerance === "low" ? 70 : p.risk_tolerance === "high" ? 30 : 50;
  }

  const capital = Math.max(1, option.capital_required || 1);
  const downsidePct = finite(option.downside_loss) ? (option.downside_loss / capital) * 100 : 100;
  const expectedPct = finite(option.expected_value) ? (option.expected_value / capital) * 100 : -100;
  let score = clamp(50 + expectedPct * 2 - downsidePct * 1.5);
  if (p.risk_tolerance === "low") score = clamp(score + option.reversibility_score * 0.2 - downsidePct);
  if (p.risk_tolerance === "high") score = clamp(score + expectedPct);
  if (p.objective === "capital_preservation") score = clamp(score + option.reversibility_score * 0.25 - downsidePct);
  if (p.objective === "return_on_capital") score = clamp(score + expectedPct * 1.5);
  return round(score, 1);
}

function doctrineTrace(option) {
  const ids = ["know_self", "know_terrain", "timing"];
  if (option.directness === "indirect") ids.push("indirect_approach");
  if (option.strategy_type === "information_gathering") ids.push("foreknowledge");
  if (option.reversibility_score >= 70 || option.switching_rules.length) ids.push("formlessness");
  if ((option.capital_required || 0) > 0 || option.strategy_type === "no_action") ids.push("economy_of_force");
  return [...new Set(ids)].map((id) => DOCTRINES[id]);
}

export function buildStrategicState({ actor_state = {}, terrain = {}, timing = {}, objective = null } = {}) {
  return {
    actor_state: {
      capabilities: list(actor_state.capabilities),
      licenses: list(actor_state.licenses),
      relationships: list(actor_state.relationships),
      infrastructure: list(actor_state.infrastructure),
      capital_available: finite(actor_state.capital_available) ? actor_state.capital_available : null,
      constraints: list(actor_state.constraints),
    },
    terrain: {
      geographies: list(terrain.geographies),
      regulatory_constraints: list(terrain.regulatory_constraints),
      infrastructure_constraints: list(terrain.infrastructure_constraints),
      market_constraints: list(terrain.market_constraints),
      evidence_refs: list(terrain.evidence_refs),
    },
    timing: {
      window_opens_at: timing.window_opens_at ?? null,
      preferred_action_by: timing.preferred_action_by ?? null,
      invalid_after: timing.invalid_after ?? null,
      evidence_refs: list(timing.evidence_refs),
    },
    objective: objective ?? null,
    semantics: "strategic_state_not_prediction",
  };
}

export function evaluateStrategicOptions({
  ranked_candidates = [],
  actor_state = {},
  terrain = {},
  timing = {},
  preferences = {},
} = {}) {
  const state = buildStrategicState({ actor_state, terrain, timing, objective: profile(preferences).objective });
  const rawOptions = [];

  for (const candidate of list(ranked_candidates)) {
    rawOptions.push(transactionOption(candidate));
    rawOptions.push(...suppliedAlternatives(candidate));
    rawOptions.push(noActionOption(candidate));
  }

  const unique = [];
  const seen = new Set();
  for (const option of rawOptions) {
    if (!option.id || seen.has(option.id)) continue;
    seen.add(option.id);
    unique.push(option);
  }

  const feasibilityById = new Map();
  for (const option of unique) feasibilityById.set(option.id, feasibility(option, actor_state, preferences));

  const economicallyComparable = unique.filter((option) => {
    const result = feasibilityById.get(option.id);
    return result.feasible && !option.research_only && finite(option.expected_value);
  });

  const comparableCurrencies = [...new Set(
    economicallyComparable
      .filter((option) => option.strategy_type !== "no_action")
      .map((option) => option.currency)
      .filter(Boolean)
  )];
  const mixedCurrencyBlocked = comparableCurrencies.length > 1;
  const comparableForSelection = mixedCurrencyBlocked ? [] : economicallyComparable;

  const regrets = regretByScenario(comparableForSelection);
  const frontierIds = new Set(paretoFront(comparableForSelection).map((option) => option.id));

  const evaluated = unique.map((option) => {
    const result = feasibilityById.get(option.id);
    const robust = robustness(option);
    const sensitivity = sensitivityAnalysis(option);
    const regret = regrets.get(option.id) || { comparable_scenarios: 0, max_regret: null, average_regret: null };
    const fit = strategicFit(option, preferences);

    return {
      ...option,
      feasible: result.feasible,
      feasibility_reasons: result.reasons,
      missing_capabilities: result.missing_capabilities,
      strategic_fit_score: fit,
      economy_of_force_ratio: economyOfForce(option),
      robustness: robust,
      sensitivity,
      regret,
      pareto_frontier: frontierIds.has(option.id),
      doctrine_trace: doctrineTrace(option),
      recommendation_semantics: option.research_only
        ? "research_option_not_economic_recommendation"
        : option.strategy_type === "information_gathering"
          ? "information_value_decision_support_from_supplied_inputs"
          : "strategic_decision_support_not_guaranteed_outcome",
    };
  });

  const selectable = evaluated
    .filter((option) => option.feasible && !option.research_only && option.pareto_frontier)
    .sort((a, b) => {
      if (b.strategic_fit_score !== a.strategic_fit_score) return b.strategic_fit_score - a.strategic_fit_score;
      const av = finite(a.expected_value) ? a.expected_value : -Infinity;
      const bv = finite(b.expected_value) ? b.expected_value : -Infinity;
      return bv - av;
    });

  const primary = mixedCurrencyBlocked ? null : (selectable[0] || null);
  const noAction = selectable.find((option) => option.strategy_type === "no_action") || null;
  const doctrineIds = primary
    ? [...new Set(primary.doctrine_trace.map((item) => item.id))]
    : [];
  const learningPacket = primary ? {
    strategy_id: primary.id,
    source_candidate_id: primary.source_candidate_id,
    strategy_type: primary.strategy_type,
    doctrine_ids: doctrineIds,
    comparator_strategy_id: noAction?.id ?? null,
    evaluated_option_ids: evaluated.map((option) => option.id),
    pareto_frontier_ids: evaluated.filter((option) => option.pareto_frontier).map((option) => option.id),
    pre_registered_outcome_metrics: [
      "outcome_success",
      "realized_net_value",
      "time_to_outcome_days",
      "capital_actually_committed",
      "maximum_realized_downside",
      "strategy_switched",
      "invalidation_triggered",
      "option_value_realized",
      "information_value_realized",
    ],
    pre_commit_sequence_steps: primary.sequence_steps,
    pre_commit_assumptions: primary.assumptions,
    pre_commit_sensitivity_cases: primary.sensitivity_cases,
    pre_commit_invalidation_rules: primary.invalidation_rules,
    pre_commit_switching_rules: primary.switching_rules,
    epistemic_boundary: "outcome_association_not_causal_attribution",
  } : null;

  return {
    engine_version: STRATEGIC_DOCTRINE_ENGINE_VERSION,
    strategic_state: state,
    option_count: evaluated.length,
    feasible_count: evaluated.filter((option) => option.feasible).length,
    pareto_frontier_count: evaluated.filter((option) => option.pareto_frontier).length,
    primary_strategy: primary,
    primary_information_action: mixedCurrencyBlocked
      ? null
      : (selectable.find((option) => option.strategy_type === "information_gathering") || null),
    no_action_option: noAction,
    learning_packet: learningPacket,
    comparison_currency: comparableCurrencies.length === 1 ? comparableCurrencies[0] : null,
    comparison_blocked_reason: mixedCurrencyBlocked ? "mixed_currency_strategy_options_require_verified_fx_normalization" : null,
    options: evaluated,
    doctrine_registry: Object.values(DOCTRINES),
    human_approval_required: true,
    execution_performed: false,
    scope_notice: "Strategy selection is only among supplied and generated options. Sunzi-derived doctrines are treated as testable heuristics, not unquestionable authority. Unknown economics remain unknown and research-only options cannot become execution recommendations.",
  };
}
