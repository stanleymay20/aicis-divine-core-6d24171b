export const LOGISTICS_ROUTE_VERIFICATION_VERSION = "aicis-logistics-route-verification-v1";

const SHA256 = /^[a-f0-9]{64}$/i;
const ALLOWED_QUOTE_STATUSES = new Set(["verified_quote", "contractually_indicated", "observed_market"]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clean = (value) => String(value ?? "").trim();

function evidenceRefValid(ref) {
  if (!ref || typeof ref !== "object") return false;
  if (!clean(ref.source_id) || !clean(ref.observed_at)) return false;
  if (!Number.isFinite(Date.parse(ref.observed_at))) return false;
  if (clean(ref.citation_id)) return true;
  return typeof ref.sha256 === "string" && SHA256.test(ref.sha256);
}

function evidenceSetValid(refs) {
  return Array.isArray(refs) && refs.length > 0 && refs.every(evidenceRefValid);
}

function quoteCurrent(validUntil, asOfMs) {
  const parsed = Date.parse(validUntil);
  return Number.isFinite(parsed) && parsed >= asOfMs;
}

function costValid(cost) {
  return Boolean(
    cost &&
    clean(cost.type) &&
    finite(cost.amount) &&
    cost.amount >= 0 &&
    (cost.basis === "fixed" || cost.basis === "per_unit") &&
    /^[A-Z]{3}$/i.test(clean(cost.currency)) &&
    evidenceSetValid(cost.evidence_refs)
  );
}

export function verifyLogisticsRouteDossier(dossier = {}) {
  const reasons = [];
  const asOfMs = dossier.as_of ? Date.parse(dossier.as_of) : Date.now();
  const provider = dossier.provider || {};
  const compliance = dossier.compliance || {};
  const quote = dossier.route_quote || {};
  const capacity = dossier.capacity || {};

  if (!Number.isFinite(asOfMs)) reasons.push("invalid_as_of");

  if (!clean(provider.legal_name)) reasons.push("provider_legal_name_missing");
  if (!clean(provider.jurisdiction)) reasons.push("provider_jurisdiction_missing");
  if (!clean(provider.registration_id)) reasons.push("provider_registration_id_missing");
  if (!evidenceSetValid(provider.evidence_refs)) reasons.push("provider_identity_evidence_invalid");

  const complianceStatus = clean(compliance.status).toLowerCase();
  if (!["clear", "review", "blocked"].includes(complianceStatus)) reasons.push("compliance_status_invalid");
  if (!evidenceSetValid(compliance.evidence_refs)) reasons.push("compliance_evidence_invalid");
  if (!clean(compliance.screened_at) || !Number.isFinite(Date.parse(compliance.screened_at))) {
    reasons.push("compliance_screen_time_invalid");
  }

  if (!clean(quote.quote_id)) reasons.push("route_quote_id_missing");
  if (!clean(quote.origin_country)) reasons.push("origin_country_missing");
  if (!clean(quote.destination_country)) reasons.push("destination_country_missing");
  if (!finite(quote.transit_days) || quote.transit_days <= 0) reasons.push("transit_days_invalid");
  if (!ALLOWED_QUOTE_STATUSES.has(clean(quote.evidence_status))) reasons.push("route_quote_evidence_status_invalid");
  if (!evidenceSetValid(quote.evidence_refs)) reasons.push("route_quote_evidence_invalid");
  if (!clean(quote.valid_until) || (Number.isFinite(asOfMs) && !quoteCurrent(quote.valid_until, asOfMs))) {
    reasons.push("route_quote_expired_or_missing_validity");
  }

  if (!Array.isArray(quote.costs) || quote.costs.length === 0) {
    reasons.push("route_costs_missing");
  } else if (!quote.costs.every(costValid)) {
    reasons.push("route_cost_evidence_invalid");
  }

  const capacityStatus = clean(capacity.status).toLowerCase();
  if (!["verified", "contracted", "observed"].includes(capacityStatus)) {
    reasons.push("capacity_status_invalid");
  }
  if (!evidenceSetValid(capacity.evidence_refs)) reasons.push("capacity_evidence_invalid");

  const blocked = complianceStatus === "blocked";
  const review = complianceStatus === "review";
  const eligible = reasons.length === 0 && !blocked && !review;

  const contactChannels = Array.isArray(dossier.contact_channels)
    ? dossier.contact_channels.filter((channel) => channel?.public_business_channel === true)
    : [];

  const normalizedRoute = eligible ? {
    id: clean(quote.quote_id),
    name: clean(quote.route_name) || [
      clean(quote.origin_country),
      clean(quote.destination_country),
    ].filter(Boolean).join(" → "),
    origin_country: clean(quote.origin_country),
    destination_country: clean(quote.destination_country),
    transit_days: quote.transit_days,
    evidence_status: clean(quote.evidence_status),
    evidence_score: finite(dossier.evidence_score) ? dossier.evidence_score : 100,
    compliance_status: "clear",
    capacity_score: finite(dossier.capacity_score) ? dossier.capacity_score : 50,
    quote_valid_until: quote.valid_until,
    evidence_refs: [
      ...(provider.evidence_refs || []),
      ...(compliance.evidence_refs || []),
      ...(quote.evidence_refs || []),
      ...(capacity.evidence_refs || []),
    ],
    stops: Array.isArray(quote.stops) ? quote.stops.map(clean).filter(Boolean) : [],
    costs: quote.costs.map((cost) => ({
      type: clean(cost.type),
      amount: cost.amount,
      basis: cost.basis,
      currency: clean(cost.currency).toUpperCase(),
      evidence_refs: cost.evidence_refs,
    })),
    provider: clean(provider.legal_name),
    provider_registration_id: clean(provider.registration_id),
    contact: contactChannels[0] ? {
      company: clean(provider.legal_name),
      channel: contactChannels[0].type || "public_business_channel",
      value: contactChannels[0].value || null,
      source: contactChannels[0].source_url || null,
    } : null,
    verification_version: LOGISTICS_ROUTE_VERIFICATION_VERSION,
  } : null;

  return {
    verification_version: LOGISTICS_ROUTE_VERIFICATION_VERSION,
    provider_name: clean(provider.legal_name) || null,
    verification_status: blocked
      ? "blocked"
      : review
        ? "review_required"
        : eligible
          ? "verified_route_candidate"
          : "incomplete",
    transaction_eligible: eligible,
    compliance_status: complianceStatus || "unknown",
    rejection_reasons: reasons,
    normalized_route: normalizedRoute,
    human_review_required: true,
    verification_scope_notice: "The route is verified only against the supplied provider, quote, capacity and compliance evidence. It is not a guarantee of future carrier performance or capacity.",
  };
}
