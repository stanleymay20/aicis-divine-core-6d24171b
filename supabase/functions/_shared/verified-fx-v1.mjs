export const VERIFIED_FX_VERSION = "aicis-verified-fx-v1";

const SHA256 = /^[a-f0-9]{64}$/i;
const ALLOWED_STATUSES = new Set(["verified_market", "official_reference", "executable_quote"]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const cleanCurrency = (value) => String(value ?? "").trim().toUpperCase();

function evidenceRefValid(ref) {
  if (!ref || typeof ref !== "object") return false;
  if (!ref.source_id || !ref.observed_at) return false;
  const observed = Date.parse(ref.observed_at);
  if (!Number.isFinite(observed)) return false;
  if (ref.citation_id) return true;
  return typeof ref.sha256 === "string" && SHA256.test(ref.sha256);
}

function evidenceSetValid(refs) {
  return Array.isArray(refs) && refs.length > 0 && refs.every(evidenceRefValid);
}

function rateIsCurrent(rate, asOfMs) {
  const observedAt = Date.parse(rate.observed_at);
  if (!Number.isFinite(observedAt) || observedAt > asOfMs) return false;
  if (rate.valid_until) {
    const validUntil = Date.parse(rate.valid_until);
    if (!Number.isFinite(validUntil) || validUntil < asOfMs) return false;
  }
  return true;
}

export function validateFxRate(rate, asOf = new Date().toISOString()) {
  const asOfMs = Date.parse(asOf);
  const reasons = [];
  const base = cleanCurrency(rate?.base_currency);
  const quote = cleanCurrency(rate?.quote_currency);

  if (!Number.isFinite(asOfMs)) reasons.push("invalid_as_of");
  if (!base || base.length !== 3) reasons.push("base_currency_invalid");
  if (!quote || quote.length !== 3) reasons.push("quote_currency_invalid");
  if (base && quote && base === quote) reasons.push("fx_pair_must_differ");
  if (!finite(rate?.rate) || rate.rate <= 0) reasons.push("fx_rate_invalid");
  if (!ALLOWED_STATUSES.has(rate?.evidence_status)) reasons.push("fx_evidence_status_invalid");
  if (!evidenceSetValid(rate?.evidence_refs)) reasons.push("fx_evidence_invalid");
  if (Number.isFinite(asOfMs) && !rateIsCurrent(rate, asOfMs)) reasons.push("fx_rate_stale_or_future");

  return {
    valid: reasons.length === 0,
    reasons,
    base_currency: base || null,
    quote_currency: quote || null,
  };
}

function candidateRates(rates, from, to, asOf) {
  const direct = [];
  const inverse = [];

  for (const rate of Array.isArray(rates) ? rates : []) {
    const validation = validateFxRate(rate, asOf);
    if (!validation.valid) continue;
    if (validation.base_currency === from && validation.quote_currency === to) direct.push(rate);
    if (validation.base_currency === to && validation.quote_currency === from) inverse.push(rate);
  }

  const newestFirst = (a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at);
  direct.sort(newestFirst);
  inverse.sort(newestFirst);
  return { direct, inverse };
}

export function convertVerifiedAmount(amount, fromCurrency, toCurrency, rates = [], asOf = new Date().toISOString()) {
  const from = cleanCurrency(fromCurrency);
  const to = cleanCurrency(toCurrency);

  if (!finite(amount)) {
    return { ok: false, reason: "amount_invalid", amount: null, from_currency: from, to_currency: to };
  }
  if (!from || from.length !== 3 || !to || to.length !== 3) {
    return { ok: false, reason: "currency_invalid", amount: null, from_currency: from, to_currency: to };
  }
  if (from === to) {
    return {
      ok: true,
      amount,
      from_currency: from,
      to_currency: to,
      rate: 1,
      direction: "identity",
      fx_rate_id: null,
      evidence_status: "identity",
      execution_eligible_fx: true,
      evidence_refs: [],
    };
  }

  const { direct, inverse } = candidateRates(rates, from, to, asOf);

  if (direct.length) {
    const selected = direct[0];
    return {
      ok: true,
      amount: amount * selected.rate,
      from_currency: from,
      to_currency: to,
      rate: selected.rate,
      direction: "direct",
      fx_rate_id: selected.id ?? null,
      provider: selected.provider ?? null,
      observed_at: selected.observed_at,
      evidence_status: selected.evidence_status,
      execution_eligible_fx: selected.evidence_status === "executable_quote",
      evidence_refs: selected.evidence_refs,
    };
  }

  if (inverse.length) {
    const selected = inverse[0];
    return {
      ok: true,
      amount: amount / selected.rate,
      from_currency: from,
      to_currency: to,
      rate: 1 / selected.rate,
      direction: "inverse",
      fx_rate_id: selected.id ?? null,
      provider: selected.provider ?? null,
      observed_at: selected.observed_at,
      evidence_status: selected.evidence_status,
      execution_eligible_fx: selected.evidence_status === "executable_quote",
      evidence_refs: selected.evidence_refs,
    };
  }

  return {
    ok: false,
    reason: "verified_fx_rate_unavailable",
    amount: null,
    from_currency: from,
    to_currency: to,
  };
}

export function requiredFxPairs(currencies = [], comparisonCurrency = "") {
  const target = cleanCurrency(comparisonCurrency);
  if (!target || target.length !== 3) return [];
  const unique = [...new Set((Array.isArray(currencies) ? currencies : []).map(cleanCurrency).filter(Boolean))];
  return unique
    .filter((currency) => currency !== target)
    .map((currency) => ({ from_currency: currency, to_currency: target }));
}
