export const ECB_REFERENCE_FX_VERSION = "aicis-ecb-reference-fx-v1";
export const ECB_DAILY_FX_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

const finite = (value) => typeof value === "number" && Number.isFinite(value);

function attribute(tag, name) {
  const match = tag.match(new RegExp(name + "=['\"]([^'\"]+)['\"]", "i"));
  return match?.[1] ?? null;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(parsed);
}

function referenceValidUntil(date) {
  const start = Date.parse(date + "T23:59:59Z");
  return new Date(start + 4 * 24 * 60 * 60 * 1000).toISOString();
}

export function parseEcbReferenceXml(xml, evidence = {}) {
  const source = String(xml ?? "");
  const dateMatch = source.match(/<Cube\s+time=['\"]([^'\"]+)['\"]/i);
  const effectiveDate = dateMatch?.[1] ?? null;

  if (!effectiveDate || !validIsoDate(effectiveDate)) {
    return {
      ok: false,
      error: "ecb_effective_date_missing_or_invalid",
      effective_date: null,
      rates: [],
    };
  }

  const rates = [];
  const cubeTags = source.match(/<Cube\s+[^>]*currency=['\"][A-Z]{3}['\"][^>]*\/?\s*>/gi) || [];
  for (const tag of cubeTags) {
    const currency = attribute(tag, "currency")?.toUpperCase() ?? "";
    const rawRate = Number(attribute(tag, "rate"));
    if (!/^[A-Z]{3}$/.test(currency) || !finite(rawRate) || rawRate <= 0) continue;

    rates.push({
      id: "ecb:EUR:" + currency + ":" + effectiveDate,
      base_currency: "EUR",
      quote_currency: currency,
      rate: rawRate,
      observed_at: effectiveDate + "T16:00:00Z",
      valid_until: referenceValidUntil(effectiveDate),
      effective_date: effectiveDate,
      retrieved_at: evidence.retrieved_at ?? null,
      evidence_status: "official_reference",
      provider: "European Central Bank",
      transaction_use_status: "reference_only_not_execution_quote",
      execution_eligible_fx: false,
      evidence_refs: evidence.evidence_refs ?? [],
    });
  }

  return {
    ok: rates.length > 0,
    error: rates.length ? null : "ecb_rates_missing",
    effective_date: effectiveDate,
    rates,
  };
}
