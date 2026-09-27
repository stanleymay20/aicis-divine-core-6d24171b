
import { convertVerifiedAmount } from "./verified-fx-v1.mjs";

export const LANDED_COST_EVIDENCE_VERSION = "aicis-landed-cost-evidence-v1";

export const REQUIRED_LANDED_COST_CATEGORIES = Object.freeze([
  "origin_inland_transport",
  "origin_handling",
  "export_customs",
  "export_duty_tax",
  "international_freight",
  "cargo_insurance",
  "import_duty",
  "import_tax",
  "customs_brokerage",
  "destination_handling",
  "inspection_certification",
  "financing",
  "storage_distribution",
]);

const SHA256 = /^[a-f0-9]{64}$/i;
const ISO3 = /^[A-Z]{3}$/;
const HS = /^[0-9]{6,10}$/;
const ALLOWED_COVERAGE = new Set([
  "included_here",
  "covered_elsewhere",
  "not_applicable",
  "unknown",
]);
const ALLOWED_EVIDENCE_STATUS = new Set([
  "official_rule",
  "verified_quote",
  "contractually_indicated",
  "observed_market",
]);
const EXECUTION_GRADE_STATUS = new Set([
  "official_rule",
  "verified_quote",
  "contractually_indicated",
]);
const ALLOWED_SOURCE_KIND = new Set([
  "official_customs_tariff",
  "official_tax_rule",
  "official_trade_rule",
  "customs_broker_quote",
  "inspection_quote",
  "insurance_quote",
  "financing_quote",
  "route_quote",
  "provider_quote",
  "other_verified_source",
]);
const ALLOWED_CALCULATION = new Set([
  "fixed",
  "per_unit",
  "percent_of_basis",
]);
const ALLOWED_CASH_FLOW_TREATMENT = new Set([
  "cost",
  "recoverable_tax",
]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();
const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const normalizeHs = (value) => clean(value).replace(/[^0-9]/g, "");

function evidenceRefValid(ref) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return false;
  if (!clean(ref.source_id) || !clean(ref.observed_at)) return false;
  if (!Number.isFinite(Date.parse(ref.observed_at))) return false;
  if (clean(ref.citation_id)) return true;
  return typeof ref.sha256 === "string" && SHA256.test(ref.sha256);
}

function evidenceSetValid(refs) {
  return Array.isArray(refs) && refs.length > 0 && refs.every(evidenceRefValid);
}

function temporalEvidenceValid(component, asOfMs) {
  const status = clean(component.evidence_status).toLowerCase();
  const effectiveFrom = Date.parse(component.effective_from);
  const validUntil = Date.parse(component.valid_until);

  if (status === "official_rule") {
    return Number.isFinite(effectiveFrom) && effectiveFrom <= asOfMs &&
      (!component.valid_until || (Number.isFinite(validUntil) && validUntil >= asOfMs));
  }

  return Number.isFinite(validUntil) && validUntil >= asOfMs;
}

function componentValue(component, quantity) {
  const calculation = clean(component.calculation_kind).toLowerCase();

  if (calculation === "fixed") {
    if (!finite(component.amount) || component.amount < 0) return { ok: false, reason: "fixed_amount_invalid" };
    return {
      ok: true,
      amount: component.amount,
      currency: upper(component.currency),
      basis_evidence_refs: [],
    };
  }

  if (calculation === "per_unit") {
    if (!finite(component.amount) || component.amount < 0) return { ok: false, reason: "per_unit_amount_invalid" };
    if (!finite(quantity) || quantity <= 0) return { ok: false, reason: "quantity_invalid_for_per_unit_cost" };
    return {
      ok: true,
      amount: component.amount * quantity,
      currency: upper(component.currency),
      basis_evidence_refs: [],
    };
  }

  if (calculation === "percent_of_basis") {
    const basis = component.basis || {};
    if (!finite(component.rate_pct) || component.rate_pct < 0) return { ok: false, reason: "rate_pct_invalid" };
    if (!finite(basis.amount) || basis.amount < 0) return { ok: false, reason: "basis_amount_invalid" };
    if (!clean(basis.name)) return { ok: false, reason: "basis_name_missing" };
    if (!evidenceSetValid(basis.evidence_refs)) return { ok: false, reason: "basis_evidence_invalid" };
    return {
      ok: true,
      amount: basis.amount * component.rate_pct / 100,
      currency: upper(basis.currency),
      basis_evidence_refs: list(basis.evidence_refs),
    };
  }

  return { ok: false, reason: "calculation_kind_invalid" };
}

function componentRequiresHs(category) {
  return ["export_customs", "export_duty_tax", "import_duty", "import_tax"].includes(category);
}

function normalizeCoverage(coverage) {
  const byCategory = new Map();
  for (const item of list(coverage)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const category = clean(item.category).toLowerCase();
    if (category) byCategory.set(category, item);
  }
  return byCategory;
}

function buildResearchTasks({ missingCategories, invalidCoverage, invalidComponents, hsCode, origin, destination }) {
  const tasks = [];
  for (const category of missingCategories) {
    tasks.push({
      category,
      priority: "blocking",
      research_only: true,
      transaction_eligible: false,
      required_evidence: "Attributable current evidence or evidenced not-applicable determination",
      suggested_next_step: `Obtain evidence for ${category.replaceAll("_", " ")} before treating landed cost as complete.`,
    });
  }
  for (const item of invalidCoverage) {
    tasks.push({
      category: item.category,
      priority: "blocking",
      research_only: true,
      transaction_eligible: false,
      required_evidence: item.reason,
      suggested_next_step: `Resolve landed-cost coverage for ${item.category.replaceAll("_", " ")}.`,
    });
  }
  for (const item of invalidComponents) {
    tasks.push({
      category: item.category,
      component_id: item.component_id,
      priority: "blocking",
      research_only: true,
      transaction_eligible: false,
      required_evidence: item.reasons.join(", "),
      suggested_next_step: "Refresh or correct the attributable cost evidence before re-evaluating.",
    });
  }

  if (
    [...missingCategories, ...invalidCoverage.map((item) => item.category), ...invalidComponents.map((item) => item.category)]
      .some(componentRequiresHs)
  ) {
    tasks.push({
      category: "classification",
      priority: "blocking",
      research_only: true,
      transaction_eligible: false,
      required_evidence: `Product classification and official rule for HS ${hsCode || "unknown"} on ${origin || "origin"} → ${destination || "destination"}.`,
      suggested_next_step: "Verify the HS classification and applicable official customs/tax rule for the exact origin-destination pair.",
    });
  }

  return tasks;
}

export function evaluateLandedCostEvidence(input = {}) {
  const asOfIso = clean(input.as_of) || new Date().toISOString();
  const asOfMs = Date.parse(asOfIso);
  const quantity = input.quantity;
  const comparisonCurrency = upper(input.comparison_currency);
  const origin = upper(input.origin_country);
  const destination = upper(input.destination_country);
  const hsCode = normalizeHs(input.hs_code);
  const fxRates = list(input.fx_rates);
  const reasons = [];

  if (!Number.isFinite(asOfMs)) reasons.push("invalid_as_of");
  if (!clean(input.candidate_id)) reasons.push("candidate_id_missing");
  if (!clean(input.product_id)) reasons.push("product_id_missing");
  if (!finite(quantity) || quantity <= 0) reasons.push("quantity_invalid");
  if (!clean(input.quantity_unit)) reasons.push("quantity_unit_missing");
  if (!ISO3.test(origin)) reasons.push("origin_country_invalid");
  if (!ISO3.test(destination)) reasons.push("destination_country_invalid");
  if (!/^[A-Z]{3}$/.test(comparisonCurrency)) reasons.push("comparison_currency_invalid");

  const coverageByCategory = normalizeCoverage(input.coverage);
  const components = list(input.components);
  const validComponents = [];
  const invalidComponents = [];
  let supplementalCostTotal = 0;
  let recoverableTaxTotal = 0;
  let cashRequirementTotal = 0;
  let allExecutionGrade = true;
  let allFxExecutionReady = true;
  const fxEvidenceRefs = [];

  for (const component of components) {
    const componentReasons = [];
    const category = clean(component.category).toLowerCase();
    const componentId = clean(component.id);
    const status = clean(component.evidence_status).toLowerCase();
    const sourceKind = clean(component.source_kind).toLowerCase();
    const calculationKind = clean(component.calculation_kind).toLowerCase();
    const cashFlowTreatment = clean(component.cash_flow_treatment || "cost").toLowerCase();

    if (!REQUIRED_LANDED_COST_CATEGORIES.includes(category)) componentReasons.push("component_category_invalid");
    if (!componentId) componentReasons.push("component_id_missing");
    if (!ALLOWED_EVIDENCE_STATUS.has(status)) componentReasons.push("evidence_status_invalid");
    if (!ALLOWED_SOURCE_KIND.has(sourceKind)) componentReasons.push("source_kind_invalid");
    if (!ALLOWED_CALCULATION.has(calculationKind)) componentReasons.push("calculation_kind_invalid");
    if (!ALLOWED_CASH_FLOW_TREATMENT.has(cashFlowTreatment)) componentReasons.push("cash_flow_treatment_invalid");
    if (!evidenceSetValid(component.evidence_refs)) componentReasons.push("component_evidence_invalid");
    if (Number.isFinite(asOfMs) && !temporalEvidenceValid(component, asOfMs)) {
      componentReasons.push("component_evidence_stale_or_not_yet_effective");
    }

    if (componentRequiresHs(category) && !HS.test(hsCode)) {
      componentReasons.push("hs_code_required_for_customs_or_tax");
    }

    const calculated = componentValue(component, quantity);
    if (!calculated.ok) {
      componentReasons.push(calculated.reason);
    }

    let normalizedAmount = null;
    let fxConversion = null;
    if (calculated.ok) {
      if (!/^[A-Z]{3}$/.test(calculated.currency)) {
        componentReasons.push("component_currency_invalid");
      } else if (/^[A-Z]{3}$/.test(comparisonCurrency)) {
        const converted = convertVerifiedAmount(
          calculated.amount,
          calculated.currency,
          comparisonCurrency,
          fxRates,
          asOfIso,
        );
        if (!converted.ok) {
          componentReasons.push("component_fx_missing_or_unverified");
          allFxExecutionReady = false;
        } else {
          normalizedAmount = round(converted.amount);
          if (converted.direction !== "identity") {
            fxConversion = {
              from_currency: converted.from_currency,
              to_currency: converted.to_currency,
              rate: converted.rate,
              fx_rate_id: converted.fx_rate_id,
              provider: converted.provider ?? null,
              observed_at: converted.observed_at ?? null,
              evidence_status: converted.evidence_status ?? null,
              execution_eligible_fx: converted.execution_eligible_fx === true,
              evidence_refs: converted.evidence_refs ?? [],
            };
            fxEvidenceRefs.push(...(converted.evidence_refs ?? []));
            if (converted.execution_eligible_fx !== true) allFxExecutionReady = false;
          }
        }
      }
    }

    if (!EXECUTION_GRADE_STATUS.has(status)) allExecutionGrade = false;

    if (componentReasons.length) {
      invalidComponents.push({
        component_id: componentId || null,
        category: category || "unknown",
        reasons: [...new Set(componentReasons)],
      });
      continue;
    }

    const normalized = {
      id: componentId,
      category,
      label: clean(component.label) || category.replaceAll("_", " "),
      amount: normalizedAmount,
      currency: comparisonCurrency,
      calculation_kind: calculationKind,
      original_amount: round(calculated.amount),
      original_currency: calculated.currency,
      rate_pct: finite(component.rate_pct) ? component.rate_pct : null,
      basis: calculationKind === "percent_of_basis"
        ? {
            name: clean(component.basis?.name) || null,
            amount: component.basis?.amount ?? null,
            currency: upper(component.basis?.currency) || null,
            evidence_refs: list(component.basis?.evidence_refs),
          }
        : null,
      cash_flow_treatment: cashFlowTreatment,
      evidence_status: status,
      source_kind: sourceKind,
      effective_from: component.effective_from ?? null,
      valid_until: component.valid_until ?? null,
      evidence_refs: [
        ...list(component.evidence_refs),
        ...list(calculated.basis_evidence_refs),
      ],
      fx_conversion: fxConversion,
    };
    validComponents.push(normalized);

    cashRequirementTotal += normalizedAmount;
    if (cashFlowTreatment === "recoverable_tax") {
      recoverableTaxTotal += normalizedAmount;
    } else {
      supplementalCostTotal += normalizedAmount;
    }
  }

  const missingCategories = [];
  const invalidCoverage = [];

  for (const category of REQUIRED_LANDED_COST_CATEGORIES) {
    const coverage = coverageByCategory.get(category);
    if (!coverage) {
      missingCategories.push(category);
      continue;
    }

    const status = clean(coverage.status).toLowerCase();
    if (!ALLOWED_COVERAGE.has(status)) {
      invalidCoverage.push({ category, reason: "coverage_status_invalid" });
      continue;
    }
    if (status === "unknown") {
      invalidCoverage.push({ category, reason: "coverage_unknown" });
      continue;
    }

    if (status === "included_here") {
      const categoryComponents = validComponents.filter((component) => component.category === category);
      if (!categoryComponents.length) {
        invalidCoverage.push({ category, reason: "included_category_has_no_valid_component" });
      }
      continue;
    }

    if (status === "covered_elsewhere") {
      if (!clean(coverage.existing_cost_id)) {
        invalidCoverage.push({ category, reason: "covered_elsewhere_cost_id_missing" });
      }
      if (!evidenceSetValid(coverage.evidence_refs)) {
        invalidCoverage.push({ category, reason: "covered_elsewhere_evidence_invalid" });
      }
      continue;
    }

    if (status === "not_applicable") {
      if (!clean(coverage.reason)) {
        invalidCoverage.push({ category, reason: "not_applicable_reason_missing" });
      }
      if (!evidenceSetValid(coverage.evidence_refs)) {
        invalidCoverage.push({ category, reason: "not_applicable_evidence_invalid" });
      }
    }
  }

  const coverageComplete =
    reasons.length === 0 &&
    missingCategories.length === 0 &&
    invalidCoverage.length === 0 &&
    invalidComponents.length === 0;

  const executionReady =
    coverageComplete &&
    allExecutionGrade &&
    allFxExecutionReady;

  const normalizedStructureCosts = executionReady || coverageComplete
    ? validComponents
        .filter((component) => component.cash_flow_treatment === "cost")
        .map((component) => ({
          type: component.category,
          amount: component.amount,
          basis: "fixed",
          currency: comparisonCurrency,
          evidence_refs: component.evidence_refs,
          landed_cost_component_id: component.id,
        }))
    : [];

  const missingExecutionFields = [];
  if (!coverageComplete) missingExecutionFields.push("complete_landed_cost_coverage");
  if (coverageComplete && !allExecutionGrade) missingExecutionFields.push("execution_grade_cost_evidence");
  if (coverageComplete && !allFxExecutionReady) missingExecutionFields.push("executable_fx_for_landed_costs");

  const researchTasks = buildResearchTasks({
    missingCategories,
    invalidCoverage,
    invalidComponents,
    hsCode,
    origin,
    destination,
  });

  const coverageEvidenceRefs = [...coverageByCategory.values()]
    .flatMap((item) => list(item?.evidence_refs));
  const componentEvidenceRefs = validComponents.flatMap((component) => component.evidence_refs || []);
  const evidenceRefs = [
    ...componentEvidenceRefs,
    ...coverageEvidenceRefs,
    ...fxEvidenceRefs,
  ];

  return {
    verification_version: LANDED_COST_EVIDENCE_VERSION,
    candidate_id: clean(input.candidate_id) || null,
    product_id: clean(input.product_id) || null,
    hs_code: HS.test(hsCode) ? hsCode : null,
    origin_country: ISO3.test(origin) ? origin : null,
    destination_country: ISO3.test(destination) ? destination : null,
    quantity: finite(quantity) ? quantity : null,
    quantity_unit: clean(input.quantity_unit) || null,
    comparison_currency: /^[A-Z]{3}$/.test(comparisonCurrency) ? comparisonCurrency : null,
    valid_request: reasons.length === 0,
    request_reasons: reasons,
    coverage_complete: coverageComplete,
    research_complete: coverageComplete,
    execution_ready_cost_stack: executionReady,
    missing_categories: missingCategories,
    invalid_coverage: invalidCoverage,
    invalid_components: invalidComponents,
    components: validComponents,
    supplemental_landed_cost: round(supplementalCostTotal),
    recoverable_tax_cash_flow: round(recoverableTaxTotal),
    supplemental_cash_requirement: round(cashRequirementTotal),
    normalized_structure_costs: normalizedStructureCosts,
    fx_evidence_refs: fxEvidenceRefs,
    evidence_refs: evidenceRefs,
    missing_execution_fields: missingExecutionFields,
    research_tasks: researchTasks,
    transaction_eligible: false,
    human_review_required: true,
    execution_boundary: {
      cost_evidence_verified_only: true,
      customs_declaration_filed: false,
      insurance_bound: false,
      financing_accepted: false,
      payment_made: false,
      order_or_contract_executed: false,
    },
    semantics: executionReady
      ? "complete_execution_grade_landed_cost_evidence_not_transaction_authorization"
      : coverageComplete
        ? "complete_research_landed_cost_evidence_not_execution_ready"
        : "incomplete_landed_cost_evidence_fail_closed",
    scope_notice: "This engine validates only supplied attributable cost evidence. It does not infer tariff classification, customs value, tax recoverability, legal applicability, insurance coverage or financing terms.",
  };
}
