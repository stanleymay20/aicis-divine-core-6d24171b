
export const STRATEGIC_RESEARCH_PLANNER_VERSION = "aicis-strategic-research-planner-v1";

const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const string = (value) => String(value ?? "").trim();

const PRIORITY_ORDER = { blocking: 0, high: 1, normal: 2 };

function action(input) {
  return {
    planner_version: STRATEGIC_RESEARCH_PLANNER_VERSION,
    id: input.id,
    kind: input.kind,
    title: input.title,
    priority: input.priority || "normal",
    source_candidate_id: input.source_candidate_id || null,
    trigger: input.trigger,
    required_evidence: list(input.required_evidence),
    completion_criteria: list(input.completion_criteria),
    suggested_next_step: input.suggested_next_step || null,
    research_only: true,
    transaction_eligible: false,
    expected_value: null,
    profit_claim: null,
    human_review_required: true,
  };
}

function addUnique(store, item) {
  if (!item?.id || store.has(item.id)) return;
  store.set(item.id, item);
}

function candidateId(item) {
  return string(item?.candidate_id || item?.source_candidate_id || item?.id);
}

function alternativeExists(strategic, sourceCandidateId, directness) {
  return list(strategic?.options).some((option) =>
    option?.source_candidate_id === sourceCandidateId &&
    option?.directness === directness &&
    option?.research_only === false
  );
}

function quoteRecoveryActions(build, store) {
  const rejected = list(build?.rejected_paths);
  const reasons = new Set(rejected.flatMap((item) => list(item?.reasons)));

  if (reasons.has("source_offer_not_verified_or_expired")) {
    addUnique(store, action({
      id: "research:refresh-supplier-quote",
      kind: "refresh_supplier_quote",
      title: "Obtain a current attributable supplier quote",
      priority: "blocking",
      trigger: "At least one supplied path was rejected because the source offer was unverified or expired.",
      required_evidence: ["supplier legal identity", "current quote", "quote validity", "product/quantity terms", "provenance"],
      completion_criteria: ["supplier quote passes the counterparty verification gate", "quote remains valid at path-build time"],
      suggested_next_step: "Return the verified supplier offer to the Transaction Lab.",
    }));
  }

  if (reasons.has("sale_offer_not_verified_or_expired")) {
    addUnique(store, action({
      id: "research:refresh-buyer-quote",
      kind: "refresh_buyer_quote",
      title: "Obtain a current attributable buyer quote",
      priority: "blocking",
      trigger: "At least one supplied path was rejected because the sale offer was unverified or expired.",
      required_evidence: ["buyer legal identity", "current buyer price/terms", "quote validity", "quantity acceptance", "provenance"],
      completion_criteria: ["buyer quote passes the counterparty verification gate", "quote remains valid at path-build time"],
      suggested_next_step: "Return the verified buyer offer to the Transaction Lab.",
    }));
  }

  if (reasons.has("route_not_verified_or_expired")) {
    addUnique(store, action({
      id: "research:refresh-route-quote",
      kind: "refresh_route_quote",
      title: "Obtain a current verified logistics route quote",
      priority: "blocking",
      trigger: "At least one supplied path was rejected because route evidence was missing, unverified, or expired.",
      required_evidence: ["provider identity", "route quote", "capacity", "transit time", "cost components", "quote validity"],
      completion_criteria: ["route passes logistics verification", "capacity and quote remain current"],
      suggested_next_step: "Return the normalized route to the Transaction Lab.",
    }));
  }

  if (reasons.has("scenario_not_validated")) {
    addUnique(store, action({
      id: "research:validate-scenario-inputs",
      kind: "validate_scenario",
      title: "Validate downside, completion, and cycle assumptions",
      priority: "blocking",
      trigger: "Transaction paths cannot be ranked because scenario inputs are not validated.",
      required_evidence: ["downside basis", "cycle-days basis", "completion-rate calibration or explicitly validated input", "provenance"],
      completion_criteria: ["scenario calibration status is validated_input", "all required numeric scenario fields are attributable"],
      suggested_next_step: "Rebuild transaction paths after scenario validation.",
    }));
  }
}

function strategicBlockerActions(strategic, store) {
  if (strategic?.comparison_blocked_reason === "mixed_currency_strategy_options_require_verified_fx_normalization") {
    addUnique(store, action({
      id: "research:normalize-strategy-fx",
      kind: "verified_fx_normalization",
      title: "Normalize strategic alternatives with verified FX",
      priority: "blocking",
      trigger: "AICIS cannot compare strategic options denominated in different currencies.",
      required_evidence: ["current attributable FX observation for each required pair", "observation time", "provider/provenance"],
      completion_criteria: ["all economically comparable strategies share one normalized comparison currency"],
      suggested_next_step: "Re-run strategic comparison after FX normalization.",
    }));
  }

  for (const option of list(strategic?.options)) {
    const id = candidateId(option);
    const reasons = new Set(list(option?.feasibility_reasons));

    if (reasons.has("missing_required_capabilities")) {
      for (const capability of list(option?.missing_capabilities)) {
        const normalized = string(capability).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        addUnique(store, action({
          id: "research:capability-gap:" + normalized,
          kind: "resolve_capability_gap",
          title: "Resolve capability gap: " + string(capability),
          priority: "blocking",
          source_candidate_id: id,
          trigger: "A strategic option requires a capability not present in the current actor profile.",
          required_evidence: ["evidence the actor possesses the capability, or an alternative verified structure that does not require it"],
          completion_criteria: ["capability is evidenced in the actor state or the option is redesigned without that requirement"],
          suggested_next_step: "Update the Know Yourself profile only when the capability is genuinely available.",
        }));
      }
    }

    if (reasons.has("capital_required_exceeds_deployable_after_reserve") &&
        id &&
        !alternativeExists(strategic, id, "indirect")) {
      addUnique(store, action({
        id: "research:capital-light-alternative:" + id,
        kind: "investigate_indirect_structure",
        title: "Investigate a lower-capital transaction structure",
        priority: "high",
        source_candidate_id: id,
        trigger: "The direct strategy exceeds deployable capital after the configured reserve and no evidenced indirect alternative is available.",
        required_evidence: ["brokerage/agency/financing structure", "capital requirement", "fees/costs", "downside", "cycle", "counterparty terms", "provenance"],
        completion_criteria: ["an alternative has attributable economics and passes feasibility checks"],
        suggested_next_step: "Research brokerage, agency, buyer-backed, partnership, or financing structures without assuming any will be profitable.",
      }));
    }

    if (reasons.has("expected_value_unknown") || option?.research_only === true) {
      if (option?.strategy_type === "information_gathering") {
        addUnique(store, action({
          id: "research:evidence-information-value:" + string(option.id),
          kind: "evidence_information_value",
          title: "Evidence the value of the proposed information action",
          priority: "normal",
          source_candidate_id: id,
          trigger: "The information action is research-only because its decision-loss reduction or cost is not sufficiently attributable.",
          required_evidence: ["information acquisition cost", "basis for expected decision-loss reduction", "currency", "provenance"],
          completion_criteria: ["information value can be calculated from attributable inputs"],
          suggested_next_step: "Re-run the doctrine engine only after both cost and loss-reduction inputs are evidenced.",
        }));
      } else if (option?.strategy_type === "position_building") {
        addUnique(store, action({
          id: "research:evidence-position-value:" + string(option.id),
          kind: "evidence_position_value",
          title: "Evidence the value of the proposed strategic position",
          priority: "normal",
          source_candidate_id: id,
          trigger: "The position-building option lacks attributable option-value economics.",
          required_evidence: ["commitment cost", "basis for option value", "currency", "rights/term/expiry", "provenance"],
          completion_criteria: ["net position value can be calculated from attributable inputs"],
          suggested_next_step: "Keep the position research-only until its material inputs are evidenced.",
        }));
      }
    }
  }
}

function executionReadinessActions(ranking, store) {
  for (const candidate of list(ranking?.ranked)) {
    const missing = new Set(list(candidate?.execution_dossier?.missing_execution_fields));
    const id = candidateId(candidate);

    if (missing.has("executable_fx_quote")) {
      addUnique(store, action({
        id: "research:executable-fx:" + id,
        kind: "obtain_executable_fx_quote",
        title: "Obtain an executable FX quote",
        priority: "blocking",
        source_candidate_id: id,
        trigger: "Reference/market FX can support research comparison but cannot satisfy execution readiness.",
        required_evidence: ["provider-issued executable FX quote", "pair", "rate", "validity", "fees/spread where applicable", "provenance"],
        completion_criteria: ["FX evidence status is executable_quote and remains current at approval time"],
        suggested_next_step: "Attach the executable FX quote and rebuild before any approval.",
      }));
    }

    if (candidate?.execution_ready === false && candidate?.execution_dossier?.who?.contacts?.length === 0) {
      addUnique(store, action({
        id: "research:business-contact:" + id,
        kind: "verify_business_contact",
        title: "Verify an official business contact channel",
        priority: "high",
        source_candidate_id: id,
        trigger: "The transaction dossier has no verified public/licensed business contact channel.",
        required_evidence: ["official or licensed sales/procurement/logistics contact channel", "source URL or licensed provenance"],
        completion_criteria: ["a verified business contact is attached to the relevant counterparty"],
        suggested_next_step: "Use only public/licensed business contact data; do not infer private contact information.",
      }));
    }
  }
}

function complianceActions(ranking, store) {
  const reviewCandidates = [
    ...list(ranking?.ranked),
    ...list(ranking?.rejected),
  ].filter((candidate) =>
    candidate?.rejection_reasons?.includes?.("compliance_unknown") ||
    candidate?.compliance_status === "review" ||
    candidate?.execution_dossier?.compliance_status === "review"
  );

  if (reviewCandidates.length) {
    addUnique(store, action({
      id: "research:complete-compliance-review",
      kind: "complete_compliance_review",
      title: "Complete outstanding compliance review",
      priority: "blocking",
      trigger: "At least one candidate remains review/unknown at the compliance boundary.",
      required_evidence: ["official-list screening coverage", "legal identity", "jurisdiction-specific checks", "documented human compliance decision"],
      completion_criteria: ["compliance status is explicitly clear or blocked; review/unknown cannot proceed to execution"],
      suggested_next_step: "Resolve compliance before contractual or monetary commitment.",
    }));
  }
}

function sensitivityActions(strategic, store) {
  const primary = strategic?.primary_strategy;
  const first = primary?.sensitivity?.cases?.[0];
  if (!first || first.delta_expected_value >= 0) return;

  addUnique(store, action({
    id: "research:validate-sensitive-assumption:" + string(first.id),
    kind: "validate_sensitive_assumption",
    title: "Validate the most decision-sensitive assumption: " + string(first.assumption),
    priority: first.evidence_status === "user_defined_scenario" ? "high" : "normal",
    source_candidate_id: candidateId(primary),
    trigger: "The supplied sensitivity case produces the largest negative change in expected value for the current primary strategy.",
    required_evidence: [
      "current evidence for the assumption",
      "point-in-time baseline",
      "credible stressed value or range",
      "provenance",
    ],
    completion_criteria: ["the assumption is refreshed and the strategic comparison is rerun"],
    suggested_next_step: "Treat this as an evidence task, not a prediction that the shock will occur.",
  }));
}

export function planStrategicResearch({
  build = {},
  ranking = {},
  strategic = {},
} = {}) {
  const store = new Map();

  quoteRecoveryActions(build, store);
  strategicBlockerActions(strategic, store);
  executionReadinessActions(ranking, store);
  complianceActions(ranking, store);
  sensitivityActions(strategic, store);

  const actions = [...store.values()].sort((a, b) => {
    const priorityDelta = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
    if (priorityDelta !== 0) return priorityDelta;
    return a.id.localeCompare(b.id);
  });

  return {
    planner_version: STRATEGIC_RESEARCH_PLANNER_VERSION,
    action_count: actions.length,
    blocking_count: actions.filter((item) => item.priority === "blocking").length,
    high_count: actions.filter((item) => item.priority === "high").length,
    actions,
    execution_performed: false,
    scope_notice: "Research actions are generated only from observed blockers in the supplied build, ranking, and strategic results. They do not assert that a missing alternative exists, that research will succeed, or that resolving a blocker will make the opportunity profitable.",
  };
}
