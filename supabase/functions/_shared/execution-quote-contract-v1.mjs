
export const EXECUTION_QUOTE_CONTRACT_VERSION = "aicis-execution-quote-v1";

const SHA256 = /^[a-f0-9]{64}$/i;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{16,128}$/;
const EXECUTABLE_STATUS = "executable_quote";
const ALLOWED_STATUSES = new Set([
  "indicative",
  "verified_market",
  "official_reference",
  EXECUTABLE_STATUS,
]);
const ALLOWED_SIDES = new Set(["buy", "sell", "convert"]);
const ALLOWED_INSTRUMENT_KINDS = new Set([
  "fx",
  "security",
  "commodity",
  "physical_trade",
  "other",
]);
const ALLOWED_PURPOSES = new Set([
  "primary_transaction",
  "fx_conversion",
  "fee_estimate",
]);
const FORBIDDEN_KEY = /(password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|private[_-]?key|client[_-]?secret)/i;

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clean = (value) => String(value ?? "").trim();
const currency = (value) => clean(value).toUpperCase();
const round = (value, digits = 8) => Number(Number(value).toFixed(digits));
const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

function evidenceRefValid(ref) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return false;
  if (!ref.source_id || !ref.observed_at) return false;
  if (!Number.isFinite(Date.parse(ref.observed_at))) return false;
  if (ref.citation_id) return true;
  return typeof ref.sha256 === "string" && SHA256.test(ref.sha256);
}

function evidenceSetValid(refs) {
  return Array.isArray(refs) && refs.length > 0 && refs.every(evidenceRefValid);
}

function forbiddenPath(value, prefix = "") {
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    const path = prefix ? prefix + "." + key : key;
    if (FORBIDDEN_KEY.test(key)) return path;
    if (nested && typeof nested === "object") {
      const found = forbiddenPath(nested, path);
      if (found) return found;
    }
  }
  return null;
}

function quoteCurrent(quote, asOfMs) {
  const observedAt = Date.parse(quote?.observed_at);
  const validUntil = Date.parse(quote?.valid_until);
  return Number.isFinite(observedAt) &&
    Number.isFinite(validUntil) &&
    observedAt <= asOfMs &&
    validUntil >= asOfMs;
}

function selectedPrice(quote) {
  const pricing = quote?.pricing || {};
  const side = clean(quote?.side).toLowerCase();
  const kind = clean(quote?.instrument?.kind).toLowerCase();

  if (kind === "fx") {
    return finite(pricing.rate) && pricing.rate > 0
      ? { value: pricing.rate, source: "rate" }
      : null;
  }
  if (side === "buy" && finite(pricing.ask) && pricing.ask > 0) {
    return { value: pricing.ask, source: "ask" };
  }
  if (side === "sell" && finite(pricing.bid) && pricing.bid > 0) {
    return { value: pricing.bid, source: "bid" };
  }
  if (finite(pricing.unit_price) && pricing.unit_price > 0) {
    return { value: pricing.unit_price, source: "unit_price" };
  }
  return null;
}

function normalizedCostEntries(quoteCurrency, costs) {
  const entries = list(costs);
  const normalized = [];
  const reasons = [];

  for (const item of entries) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      reasons.push("cost_entry_invalid");
      continue;
    }
    const type = clean(item.type);
    const amount = item.amount;
    const costCurrency = currency(item.currency);
    if (!type) reasons.push("cost_type_missing");
    if (!finite(amount) || amount < 0) reasons.push("cost_amount_invalid");
    if (!costCurrency || costCurrency.length !== 3) reasons.push("cost_currency_invalid");
    if (costCurrency && quoteCurrency && costCurrency !== quoteCurrency) {
      reasons.push("cost_currency_must_match_quote_currency");
    }
    normalized.push({
      type: type || null,
      amount: finite(amount) ? round(amount) : null,
      currency: costCurrency || null,
      evidence_refs: list(item.evidence_refs),
    });
  }

  return {
    entries: normalized,
    reasons,
    total: reasons.length
      ? null
      : round(normalized.reduce((sum, item) => sum + (item.amount ?? 0), 0)),
  };
}

export function validateExecutionQuote(quote = {}, asOf = new Date().toISOString()) {
  const reasons = [];
  const asOfMs = Date.parse(asOf);
  const status = clean(quote.status).toLowerCase();
  const side = clean(quote.side).toLowerCase();
  const providerName = clean(quote.provider_name);
  const providerAdapter = clean(quote.provider_adapter);
  const quoteId = clean(quote.quote_id);
  const providerQuoteId = clean(quote.provider_quote_id);
  const kind = clean(quote?.instrument?.kind).toLowerCase();
  const quantity = quote.quantity;
  const quantityUnit = clean(quote.quantity_unit);
  const quoteCurrency = kind === "fx"
    ? currency(quote?.instrument?.quote_currency)
    : currency(quote?.pricing?.currency);
  const price = selectedPrice(quote);
  const leakedSecretPath = forbiddenPath(quote);
  const boundCandidateId = clean(quote?.execution_context?.candidate_id);
  const purpose = clean(quote?.execution_context?.purpose).toLowerCase();

  if (!Number.isFinite(asOfMs)) reasons.push("invalid_as_of");
  if (!quoteId) reasons.push("quote_id_missing");
  if (!providerQuoteId) reasons.push("provider_quote_id_missing");
  if (!providerName) reasons.push("provider_name_missing");
  if (!providerAdapter) reasons.push("provider_adapter_missing");
  if (!boundCandidateId) reasons.push("quote_candidate_binding_missing");
  if (!ALLOWED_PURPOSES.has(purpose)) reasons.push("quote_purpose_invalid");
  if (!ALLOWED_STATUSES.has(status)) reasons.push("quote_status_invalid");
  if (!ALLOWED_SIDES.has(side)) reasons.push("side_invalid");
  if (!ALLOWED_INSTRUMENT_KINDS.has(kind)) reasons.push("instrument_kind_invalid");
  if (!finite(quantity) || quantity <= 0) reasons.push("quantity_invalid");
  if (!quantityUnit) reasons.push("quantity_unit_missing");
  if (!quoteCurrency || quoteCurrency.length !== 3) reasons.push("pricing_currency_invalid");
  if (!price) reasons.push("executable_price_missing");
  if (!evidenceSetValid(quote.evidence_refs)) reasons.push("quote_evidence_invalid");
  if (leakedSecretPath) reasons.push("secret_material_forbidden:" + leakedSecretPath);

  if (!quote.observed_at || !Number.isFinite(Date.parse(quote.observed_at))) {
    reasons.push("observed_at_invalid");
  }
  if (!quote.valid_until || !Number.isFinite(Date.parse(quote.valid_until))) {
    reasons.push("valid_until_invalid");
  }
  if (Number.isFinite(asOfMs) && !quoteCurrent(quote, asOfMs)) {
    reasons.push("quote_stale_or_future");
  }

  if (kind === "fx") {
    const base = currency(quote?.instrument?.base_currency);
    const quoted = currency(quote?.instrument?.quote_currency);
    if (!base || base.length !== 3) reasons.push("base_currency_invalid");
    if (!quoted || quoted.length !== 3) reasons.push("quote_currency_invalid");
    if (base && quoted && base === quoted) reasons.push("fx_pair_must_differ");
    if (side !== "convert") reasons.push("fx_side_must_be_convert");
    if (purpose && purpose !== "fx_conversion") reasons.push("fx_quote_purpose_must_be_fx_conversion");
  } else {
    if (!clean(quote?.instrument?.symbol || quote?.instrument?.product_id || quote?.instrument?.description)) {
      reasons.push("instrument_identity_missing");
    }
    if (side === "convert") reasons.push("convert_side_requires_fx_instrument");
  }

  const costs = normalizedCostEntries(quoteCurrency, quote.costs);
  reasons.push(...costs.reasons);

  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    normalized: {
      quote_id: quoteId || null,
      provider_quote_id: providerQuoteId || null,
      provider_name: providerName || null,
      provider_adapter: providerAdapter || null,
      status: status || null,
      side: side || null,
      instrument: quote.instrument ?? null,
      quantity: finite(quantity) ? quantity : null,
      quantity_unit: quantityUnit || null,
      observed_at: quote.observed_at ?? null,
      valid_until: quote.valid_until ?? null,
      pricing: quote.pricing ?? null,
      pricing_currency: quoteCurrency || null,
      selected_price: price?.value ?? null,
      selected_price_source: price?.source ?? null,
      costs: costs.entries,
      estimated_costs_total: costs.total,
      execution_context: {
        candidate_id: boundCandidateId || null,
        purpose: purpose || null,
      },
      account_context: quote.account_context ?? null,
      evidence_refs: list(quote.evidence_refs),
    },
  };
}

function previewEconomics(normalized) {
  const kind = clean(normalized?.instrument?.kind).toLowerCase();
  const quantity = normalized.quantity;
  const price = normalized.selected_price;
  const costs = normalized.estimated_costs_total ?? 0;

  if (!finite(quantity) || !finite(price)) {
    return {
      gross_notional: null,
      estimated_costs_total: finite(costs) ? costs : null,
      estimated_cash_required: null,
      estimated_cash_proceeds: null,
      estimated_output_amount: null,
    };
  }

  if (kind === "fx") {
    return {
      gross_notional: round(quantity),
      estimated_costs_total: round(costs),
      estimated_cash_required: round(quantity + costs),
      estimated_cash_proceeds: null,
      estimated_output_amount: round(quantity * price),
    };
  }

  const gross = round(quantity * price);
  const side = normalized.side;
  return {
    gross_notional: gross,
    estimated_costs_total: round(costs),
    estimated_cash_required: side === "buy" ? round(gross + costs) : null,
    estimated_cash_proceeds: side === "sell" ? round(Math.max(0, gross - costs)) : null,
    estimated_output_amount: null,
  };
}

function normalizedFxRate(normalized) {
  if (
    clean(normalized?.instrument?.kind).toLowerCase() !== "fx" ||
    normalized.status !== EXECUTABLE_STATUS ||
    !finite(normalized.selected_price) ||
    (normalized.estimated_costs_total ?? 0) > 0
  ) {
    return null;
  }

  return {
    id: "execfx:" + normalized.quote_id,
    base_currency: currency(normalized.instrument.base_currency),
    quote_currency: currency(normalized.instrument.quote_currency),
    rate: normalized.selected_price,
    observed_at: normalized.observed_at,
    valid_until: normalized.valid_until,
    evidence_status: "executable_quote",
    provider: normalized.provider_name,
    provider_quote_id: normalized.provider_quote_id,
    provider_adapter: normalized.provider_adapter,
    evidence_refs: normalized.evidence_refs,
  };
}

export function buildExecutionPreview({
  candidate = {},
  quote = {},
  strategic_audit_hash = "",
  idempotency_key = "",
  as_of = new Date().toISOString(),
} = {}) {
  const quoteValidation = validateExecutionQuote(quote, as_of);
  const reasons = [];

  const candidateId = clean(candidate.candidate_id || candidate.id);
  const auditHash = clean(strategic_audit_hash).toLowerCase();
  const idempotency = clean(idempotency_key);

  if (!candidateId) reasons.push("candidate_id_missing");
  if (
    candidateId &&
    quoteValidation.normalized?.execution_context?.candidate_id &&
    quoteValidation.normalized.execution_context.candidate_id !== candidateId
  ) {
    reasons.push("quote_candidate_binding_mismatch");
  }
  if (!SHA256.test(auditHash)) reasons.push("strategic_audit_hash_invalid");
  if (!IDEMPOTENCY.test(idempotency)) reasons.push("idempotency_key_invalid");
  if (!quoteValidation.valid) reasons.push(...quoteValidation.reasons);

  const normalized = quoteValidation.normalized;
  const economics = previewEconomics(normalized);
  const executableQuote = normalized.status === EXECUTABLE_STATUS && quoteValidation.valid;
  const candidateExecutionReady = candidate.execution_ready === true;
  const rebuildRequired = executableQuote && !candidateExecutionReady;

  return {
    contract_version: EXECUTION_QUOTE_CONTRACT_VERSION,
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    preview_status: reasons.length
      ? "rejected"
      : executableQuote
        ? "previewed_order"
        : "indicative_only",
    candidate: {
      candidate_id: candidateId || null,
      title: candidate.title ?? null,
      transaction_type: candidate.transaction_type ?? null,
      candidate_execution_ready: candidateExecutionReady,
      candidate_currency: currency(candidate.currency) || null,
      capital_required: finite(candidate.capital_required) ? candidate.capital_required : null,
    },
    quote: normalized,
    economics,
    normalized_fx_rate: reasons.length ? null : normalizedFxRate(normalized),
    fx_handoff_blocked_reason:
      reasons.length === 0 &&
      clean(normalized?.instrument?.kind).toLowerCase() === "fx" &&
      normalized.status === EXECUTABLE_STATUS &&
      (normalized.estimated_costs_total ?? 0) > 0
        ? "explicit_fx_costs_require_transaction_cost_integration"
        : null,
    approval: {
      human_approval_required: true,
      human_approval_package_ready: reasons.length === 0 && executableQuote && candidateExecutionReady,
      rebuild_required_before_approval: rebuildRequired,
      approved: false,
      approval_token: null,
      approval_scope: "none_until_explicit_user_approval",
    },
    idempotency: {
      key: idempotency || null,
      valid: IDEMPOTENCY.test(idempotency),
    },
    execution_boundary: {
      provider_submission_enabled: false,
      order_submitted: false,
      contract_signed: false,
      money_moved: false,
      external_execution_performed: false,
    },
    semantics: executableQuote
      ? "provider_normalized_executable_quote_preview_not_execution"
      : "indicative_or_reference_quote_not_execution_ready",
  };
}
