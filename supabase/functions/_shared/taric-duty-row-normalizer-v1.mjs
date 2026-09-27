
export const TARIC_DUTY_ROW_NORMALIZER_VERSION = "aicis-taric-duty-row-normalizer-v1";

const SHA256 = /^[a-f0-9]{64}$/i;
const GOODS_CODE = /^[0-9]{10}$/;
const clean = (value) => String(value ?? "").trim();

function parseOfficialDate(value) {
  const text = clean(value);
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return match[1] + "-" + match[2] + "-" + match[3];

  match = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (match) return match[3] + "-" + match[2] + "-" + match[1];

  return null;
}

function simpleAdValorem(duty) {
  const text = clean(duty).replace(/,/g, ".");
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*%$/);
  if (!match) return null;
  const rate = Number(match[1]);
  return Number.isFinite(rate) ? rate : null;
}

export function normalizeTaricDutyRow(input = {}) {
  const reasons = [];
  const direction = clean(input.direction).toLowerCase();
  const columns = Array.isArray(input.columns) ? input.columns : [];
  const extractionReferenceDate = parseOfficialDate(input.extraction_reference_date);
  const observedAt = clean(input.observed_at);
  const sourceSha = clean(input.source_sha256).toLowerCase();

  if (!["import", "export"].includes(direction)) reasons.push("direction_invalid");
  if (columns.length < 12) reasons.push("taric_duty_row_requires_columns_a_to_l");
  if (!extractionReferenceDate) reasons.push("extraction_reference_date_invalid");
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) reasons.push("observed_at_invalid");
  if (!SHA256.test(sourceSha)) reasons.push("source_sha256_invalid");

  const [
    goodsRaw,
    additionalCodeRaw,
    quotaOrderRaw,
    startRaw,
    endRaw,
    reductionRaw,
    geographyDescriptionRaw,
    measureDescriptionRaw,
    legalReferenceRaw,
    dutyRaw,
    geographyCodeRaw,
    measureTypeCodeRaw,
  ] = columns;

  const goodsCode = clean(goodsRaw).replace(/\s+/g, "");
  const startDate = parseOfficialDate(startRaw);
  const endDate = clean(endRaw) ? parseOfficialDate(endRaw) : null;
  const dutyExpression = clean(dutyRaw);
  const parsedRate = simpleAdValorem(dutyExpression);

  if (columns.length >= 12) {
    if (!GOODS_CODE.test(goodsCode)) reasons.push("goods_code_invalid");
    if (!startDate) reasons.push("measure_start_date_invalid");
    if (clean(endRaw) && !endDate) reasons.push("measure_end_date_invalid");
    if (!clean(geographyCodeRaw)) reasons.push("geography_code_missing");
    if (!clean(measureTypeCodeRaw)) reasons.push("measure_type_code_missing");
    if (!dutyExpression) reasons.push("duty_expression_missing");
  }

  const additionalCode = clean(additionalCodeRaw) || null;
  const quotaOrderNumber = clean(quotaOrderRaw) || null;
  const reductionIndicator = clean(reductionRaw) || null;

  const dependencies = [
    "goods_nomenclature_parent_cascade",
    "geographical_area_membership",
    "measure_exclusions",
    "measure_conditions",
  ];
  if (additionalCode) dependencies.push("additional_code_resolution");
  if (quotaOrderNumber) dependencies.push("tariff_quota_status");
  if (reductionIndicator) dependencies.push("agricultural_reduction_indicator_resolution");
  if (parsedRate == null) dependencies.push("compound_or_conditional_duty_expression_resolution");

  const normalized = reasons.length ? null : {
    direction,
    goods_code: goodsCode,
    additional_code: additionalCode,
    tariff_quota_order_number: quotaOrderNumber,
    validity_start_date: startDate,
    validity_end_date: endDate,
    reduction_indicator: reductionIndicator,
    geography_description: clean(geographyDescriptionRaw) || null,
    measure_type_description: clean(measureDescriptionRaw) || null,
    legal_reference: clean(legalReferenceRaw) || null,
    duty_expression: dutyExpression,
    geography_code: clean(geographyCodeRaw),
    measure_type_code: clean(measureTypeCodeRaw),
    parsed_duty: parsedRate == null
      ? {
          kind: "complex_or_conditional",
          candidate_rate_pct: null,
        }
      : {
          kind: "simple_ad_valorem_percentage",
          candidate_rate_pct: parsedRate,
        },
    extraction_reference_date: extractionReferenceDate,
    observed_at: observedAt,
    source_sha256: sourceSha,
    source_authority: "European Commission — DG TAXUD",
    source_family: "TARIC official extraction",
  };

  return {
    normalizer_version: TARIC_DUTY_ROW_NORMALIZER_VERSION,
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    normalized_measure: normalized,
    applicability_status: reasons.length ? "invalid_row" : "unresolved",
    unresolved_dependencies: reasons.length ? [] : [...new Set(dependencies)],
    landed_cost_component: null,
    tariff_rate_claimed_applicable: false,
    legal_determination_made: false,
    transaction_eligible: false,
    semantics: reasons.length
      ? "invalid_taric_extraction_row"
      : parsedRate == null
        ? "official_taric_measure_normalized_but_complex_applicability_and_duty_unresolved"
        : "official_taric_measure_with_candidate_simple_rate_but_applicability_unresolved",
    scope_notice: "Parsing a TARIC duty expression is not a determination that the measure applies. Country-group membership, exclusions, nomenclature cascade, conditions, additional codes, quotas and other measure logic must be resolved from attributable TARIC data before a landed-cost component can be created.",
  };
}
