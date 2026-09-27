
import { convertVerifiedAmount } from "./verified-fx-v1.mjs";

export const RFQ_QUOTE_COMPARISON_VERSION = "aicis-rfq-quote-comparison-v1";

const SHA256 = /^[a-f0-9]{64}$/i;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();
const norm = (value) => clean(value).toLowerCase().replace(/\s+/g, " ");
const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

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

function additionalCostValue(cost, quantity) {
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) return null;
  if (!finite(cost.amount) || cost.amount < 0) return null;
  if (cost.basis === "per_unit") return cost.amount * quantity;
  if (cost.basis === "fixed") return cost.amount;
  return null;
}

function normalizedQuote(response, comparisonCurrency, fxRates, asOf) {
  const reasons = [];
  const quantity = response.requested_quantity;
  const quoteCurrency = upper(response.currency);
  const targetCurrency = upper(comparisonCurrency);

  if (!clean(response.id)) reasons.push("quote_id_missing");
  if (!clean(response.product_id)) reasons.push("product_id_missing");
  if (!finite(quantity) || quantity <= 0) reasons.push("quantity_invalid");
  if (!clean(response.requested_quantity_unit)) reasons.push("quantity_unit_missing");
  if (!finite(response.unit_price) || response.unit_price < 0) reasons.push("unit_price_invalid");
  if (!quoteCurrency) reasons.push("currency_missing");
  if (!clean(response.incoterm)) reasons.push("incoterm_missing");
  if (!clean(response.named_place_or_port)) reasons.push("named_place_or_port_missing");
  if (!evidenceSetValid(response.evidence_refs)) reasons.push("quote_evidence_invalid");
  if (response.evidence_status !== "rfq_response_unverified") reasons.push("unexpected_quote_evidence_status");

  const validUntil = Date.parse(response.quote_valid_until);
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(validUntil) || !Number.isFinite(asOfMs) || validUntil < asOfMs) {
    reasons.push("quote_expired_or_invalid");
  }

  const completeness = clean(response.cost_completeness).toLowerCase() || "quoted_price_only";
  if (!["quoted_price_only", "explicit_additional_costs", "full_landed_cost"].includes(completeness)) {
    reasons.push("cost_completeness_invalid");
  }

  const quotedPrice = finite(quantity) && finite(response.unit_price)
    ? quantity * response.unit_price
    : null;
  let convertedBase = null;
  const fxEvidence = [];

  if (quotedPrice != null && targetCurrency) {
    const conversion = convertVerifiedAmount(
      quotedPrice,
      quoteCurrency,
      targetCurrency,
      fxRates,
      asOf,
    );
    if (!conversion.ok) {
      reasons.push("quote_currency_not_normalized");
    } else {
      convertedBase = conversion.amount;
      if (conversion.direction !== "identity") {
        fxEvidence.push(...list(conversion.evidence_refs));
      }
    }
  }

  let additionalTotal = 0;
  const normalizedCosts = [];
  for (const cost of list(response.additional_costs)) {
    const rawValue = additionalCostValue(cost, quantity);
    const costCurrency = upper(cost.currency);
    if (rawValue == null) {
      reasons.push("additional_cost_invalid");
      continue;
    }
    if (!costCurrency) {
      reasons.push("additional_cost_currency_missing");
      continue;
    }
    if (!evidenceSetValid(cost.evidence_refs)) {
      reasons.push("additional_cost_evidence_invalid");
      continue;
    }

    const conversion = convertVerifiedAmount(
      rawValue,
      costCurrency,
      targetCurrency,
      fxRates,
      asOf,
    );
    if (!conversion.ok) {
      reasons.push("additional_cost_currency_not_normalized");
      continue;
    }

    additionalTotal += conversion.amount;
    normalizedCosts.push({
      type: clean(cost.type) || "additional_cost",
      amount: round(conversion.amount),
      currency: targetCurrency,
      original_amount: round(rawValue),
      original_currency: costCurrency,
      evidence_refs: list(cost.evidence_refs),
    });
    if (conversion.direction !== "identity") {
      fxEvidence.push(...list(conversion.evidence_refs));
    }
  }

  const total = convertedBase == null || reasons.some((reason) =>
    [
      "quote_currency_not_normalized",
      "additional_cost_invalid",
      "additional_cost_currency_missing",
      "additional_cost_evidence_invalid",
      "additional_cost_currency_not_normalized",
    ].includes(reason)
  )
    ? null
    : round(convertedBase + additionalTotal);

  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    quote_id: clean(response.id) || null,
    rfq_id: clean(response.rfq_id) || null,
    supplier_name: clean(response.name) || null,
    product_id: clean(response.product_id) || null,
    quantity: finite(quantity) ? quantity : null,
    quantity_unit: clean(response.requested_quantity_unit) || null,
    incoterm: clean(response.incoterm) || null,
    named_place_or_port: clean(response.named_place_or_port) || null,
    payment_terms: clean(response.payment_terms) || null,
    lead_time_days: finite(response.lead_time_days) ? response.lead_time_days : null,
    cost_completeness: completeness,
    comparison_currency: targetCurrency || null,
    quoted_price_converted: convertedBase == null ? null : round(convertedBase),
    additional_costs_converted: round(additionalTotal),
    total_comparable_cost: total,
    normalized_costs: normalizedCosts,
    fx_evidence_refs: fxEvidence,
    quote_valid_until: response.quote_valid_until ?? null,
    evidence_refs: list(response.evidence_refs),
  };
}

function commonValue(values) {
  const cleaned = values.map(norm);
  return cleaned.length > 0 && cleaned.every((value) => value === cleaned[0])
    ? cleaned[0]
    : null;
}

export function compareRfqResponses({
  responses = [],
  comparison_currency = "",
  fx_rates = [],
  as_of = new Date().toISOString(),
} = {}) {
  const targetCurrency = upper(comparison_currency);
  const reasons = [];

  if (!targetCurrency || !/^[A-Z]{3}$/.test(targetCurrency)) {
    reasons.push("comparison_currency_invalid");
  }
  if (!Array.isArray(responses) || responses.length < 2) {
    reasons.push("at_least_two_responses_required");
  }

  const normalized = list(responses).map((response) =>
    normalizedQuote(response, targetCurrency, fx_rates, as_of)
  );

  const validQuotes = normalized.filter((quote) => quote.valid);
  if (validQuotes.length !== normalized.length) reasons.push("one_or_more_quotes_invalid");

  const productsMatch = commonValue(validQuotes.map((quote) => quote.product_id));
  const unitsMatch = commonValue(validQuotes.map((quote) => quote.quantity_unit));
  const incotermsMatch = commonValue(validQuotes.map((quote) => quote.incoterm));
  const placesMatch = commonValue(validQuotes.map((quote) => quote.named_place_or_port));

  const quantities = validQuotes.map((quote) => quote.quantity);
  const quantityMatch = quantities.length > 0 &&
    quantities.every((value) => finite(value) && value === quantities[0]);

  if (validQuotes.length > 1 && !productsMatch) reasons.push("product_mismatch");
  if (validQuotes.length > 1 && !unitsMatch) reasons.push("quantity_unit_mismatch");
  if (validQuotes.length > 1 && !quantityMatch) reasons.push("quantity_mismatch");
  if (validQuotes.length > 1 && !incotermsMatch) reasons.push("incoterm_mismatch");
  if (validQuotes.length > 1 && !placesMatch) reasons.push("named_place_or_port_mismatch");

  const allFullLanded = validQuotes.length > 1 &&
    validQuotes.every((quote) => quote.cost_completeness === "full_landed_cost");
  if (validQuotes.length > 1 && !allFullLanded) reasons.push("full_landed_cost_required_for_winner");

  const allTotalsKnown = validQuotes.length > 1 &&
    validQuotes.every((quote) => finite(quote.total_comparable_cost));
  if (validQuotes.length > 1 && !allTotalsKnown) reasons.push("comparable_total_cost_missing");

  const orderingAllowed = reasons.length === 0 && validQuotes.length >= 2;
  const ranked = orderingAllowed
    ? [...validQuotes].sort((a, b) => a.total_comparable_cost - b.total_comparable_cost)
    : validQuotes;

  const lowest = orderingAllowed ? ranked[0] : null;

  return {
    comparison_version: RFQ_QUOTE_COMPARISON_VERSION,
    valid: normalized.length >= 2 && validQuotes.length === normalized.length,
    comparison_currency: targetCurrency || null,
    ordering_allowed: orderingAllowed,
    blocking_reasons: [...new Set(reasons)],
    quote_count: normalized.length,
    quotes: ranked,
    lowest_evaluated_landed_cost_response: lowest
      ? {
          quote_id: lowest.quote_id,
          supplier_name: lowest.supplier_name,
          total_comparable_cost: lowest.total_comparable_cost,
          currency: targetCurrency,
        }
      : null,
    transaction_eligible: false,
    human_verification_required: true,
    semantics: orderingAllowed
      ? "lowest_landed_cost_among_supplied_unverified_rfq_responses_not_supplier_recommendation"
      : "rfq_responses_not_comparable_enough_to_rank",
    scope_notice: "RFQ response comparison is research-only. Even when landed costs are comparable, responses remain unverified and must pass counterparty, compliance, commercial quote, capacity and payment-term verification before entering transaction ranking.",
  };
}
