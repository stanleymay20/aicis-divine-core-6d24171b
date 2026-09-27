
export const STRATEGIC_RESEARCH_WORKFLOW_VERSION = "aicis-strategic-research-workflow-v1";

const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const clean = (value) => String(value ?? "").trim();

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

export function researchWorkflowContextFromTransactionInput(input = {}) {
  const sourceOffers = list(input.source_offers);
  const saleOffers = list(input.sale_offers);
  const routes = list(input.routes);
  const product = input.product && typeof input.product === "object" ? input.product : {};

  const supplierCountries = unique(sourceOffers.map((item) => item?.country));
  const buyerCountries = unique(saleOffers.map((item) => item?.country));
  const originCountries = unique([
    ...routes.map((item) => item?.origin_country),
    ...supplierCountries,
  ]);
  const destinationCountries = unique([
    ...routes.map((item) => item?.destination_country),
    ...buyerCountries,
  ]);

  return {
    product_name: clean(product.name || input.product_name),
    product_id: clean(product.id),
    supplier_countries: supplierCountries,
    buyer_countries: buyerCountries,
    origin_country: originCountries[0] || "",
    destination_country: destinationCountries[0] || "",
    comparison_currency: clean(input.comparison_currency).toUpperCase(),
  };
}

function workflow(status, kind, label, payload = {}, extras = {}) {
  return {
    workflow_version: STRATEGIC_RESEARCH_WORKFLOW_VERSION,
    status,
    kind,
    label,
    payload,
    read_only_or_research_only: true,
    external_execution_performed: false,
    ...extras,
  };
}

function discoveryWorkflow(action, context, role) {
  const productName = clean(context.product_name);
  const countries = role === "supplier"
    ? list(context.supplier_countries)
    : role === "buyer"
      ? list(context.buyer_countries)
      : [];

  if (!productName) {
    return workflow(
      "requires_context",
      "counterparty_discovery",
      "Add product context",
      {},
      { missing_context: ["product_name"] },
    );
  }

  if (role !== "logistics" && countries.length === 0) {
    return workflow(
      "requires_context",
      "counterparty_discovery",
      "Add target country context",
      { product_name: productName, role },
      { missing_context: [role === "supplier" ? "supplier_countries" : "buyer_countries"] },
    );
  }

  if (role === "logistics" && (!clean(context.origin_country) || !clean(context.destination_country))) {
    return workflow(
      "requires_context",
      "counterparty_discovery",
      "Add route origin and destination",
      { product_name: productName, role },
      { missing_context: ["origin_country", "destination_country"] },
    );
  }

  return workflow(
    "ready",
    "counterparty_discovery",
    role === "supplier"
      ? "Discover supplier candidates"
      : role === "buyer"
        ? "Discover buyer candidates"
        : "Discover logistics candidates",
    {
      product_name: productName,
      role,
      countries,
      origin_country: clean(context.origin_country),
      destination_country: clean(context.destination_country),
      source_candidate_id: action.source_candidate_id || null,
    },
    {
      completion_handoff: role === "logistics"
        ? "logistics_verification"
        : "counterparty_verification",
      execution_boundary: "discovery_candidates_only",
    },
  );
}

export function resolveStrategicResearchWorkflow(action = {}, context = {}) {
  const kind = clean(action.kind);

  if (kind === "refresh_supplier_quote") {
    return discoveryWorkflow(action, context, "supplier");
  }
  if (kind === "refresh_buyer_quote") {
    return discoveryWorkflow(action, context, "buyer");
  }
  if (kind === "refresh_route_quote") {
    return discoveryWorkflow(action, context, "logistics");
  }

  if (kind === "verified_fx_normalization") {
    return workflow(
      "ready",
      "reference_fx",
      "Add official reference FX",
      {
        comparison_currency: clean(context.comparison_currency) || null,
      },
      {
        execution_boundary: "reference_only_not_execution_quote",
        notice: "Reference FX can support research comparison but cannot clear execution readiness.",
      },
    );
  }

  if (kind === "obtain_executable_fx_quote") {
    return workflow(
      "provider_required",
      "executable_fx_provider",
      "Connect an executable FX quote provider",
      {
        comparison_currency: clean(context.comparison_currency) || null,
        source_candidate_id: action.source_candidate_id || null,
      },
      {
        provider_requirement: "provider adapter capable of attributable executable_quote evidence",
        execution_boundary: "no_order_or_money_movement",
      },
    );
  }

  if (kind === "complete_compliance_review") {
    return workflow(
      "requires_context",
      "official_sanctions_screen",
      "Select a counterparty to screen",
      {},
      {
        missing_context: ["legal_name", "role"],
        execution_boundary: "human_compliance_decision_required",
      },
    );
  }

  if (kind === "verify_business_contact") {
    return workflow(
      "requires_context",
      "counterparty_contact_verification",
      "Select the counterparty whose contact must be verified",
      {
        source_candidate_id: action.source_candidate_id || null,
      },
      {
        missing_context: ["counterparty_identity"],
        execution_boundary: "public_or_licensed_business_contacts_only",
      },
    );
  }

  if (kind === "resolve_capability_gap") {
    return workflow(
      "ready",
      "actor_profile",
      "Review Know Yourself profile",
      {
        source_candidate_id: action.source_candidate_id || null,
      },
      {
        execution_boundary: "profile_update_only_after_capability_is_real",
      },
    );
  }

  if (kind === "validate_scenario") {
    return workflow(
      "ready",
      "transaction_input_editor",
      "Edit and evidence scenario inputs",
      {},
      {
        focus_fields: ["scenario"],
        execution_boundary: "no_synthetic_probability_or_downside",
      },
    );
  }

  if (kind === "evidence_information_value") {
    return workflow(
      "ready",
      "transaction_input_editor",
      "Evidence information-value inputs",
      {
        source_candidate_id: action.source_candidate_id || null,
      },
      {
        focus_fields: ["information_actions"],
        execution_boundary: "research_only_until_cost_and_loss_reduction_are_attributable",
      },
    );
  }

  if (kind === "evidence_position_value") {
    return workflow(
      "ready",
      "transaction_input_editor",
      "Evidence position-value inputs",
      {
        source_candidate_id: action.source_candidate_id || null,
      },
      {
        focus_fields: ["position_options"],
        execution_boundary: "research_only_until_commitment_cost_and_option_value_are_attributable",
      },
    );
  }

  if (kind === "investigate_indirect_structure") {
    return workflow(
      "ready",
      "transaction_input_editor",
      "Model an evidence-backed indirect structure",
      {
        source_candidate_id: action.source_candidate_id || null,
      },
      {
        focus_fields: ["indirect_strategies"],
        execution_boundary: "no_assumed_brokerage_financing_or_profit",
      },
    );
  }

  if (kind === "validate_sensitive_assumption") {
    return workflow(
      "manual_research",
      "assumption_research",
      "Research the sensitive assumption",
      {
        source_candidate_id: action.source_candidate_id || null,
      },
      {
        execution_boundary: "evidence_collection_only",
        notice: "No generic autonomous source adapter is configured for this assumption. Collect current attributable evidence, then rerun sensitivity.",
      },
    );
  }

  return workflow(
    "unsupported",
    "unknown",
    "No workflow adapter available",
    {},
    {
      unsupported_action_kind: kind || null,
    },
  );
}

export function attachStrategicResearchWorkflows(plan = {}, context = {}) {
  const actions = list(plan.actions).map((action) => ({
    ...action,
    workflow: resolveStrategicResearchWorkflow(action, context),
  }));

  const counts = actions.reduce((acc, item) => {
    const status = item.workflow?.status || "unsupported";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return {
    ...plan,
    workflow_version: STRATEGIC_RESEARCH_WORKFLOW_VERSION,
    workflow_context: context,
    workflow_status_counts: counts,
    actions,
    workflow_scope_notice: "A ready workflow starts an existing research or verification surface only. It does not send contracts, place orders, move money, or turn discovery evidence into transaction eligibility.",
  };
}
