export const COUNTERPARTY_VERIFICATION_VERSION = "aicis-counterparty-verification-v1";

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

function quoteCurrent(quote, asOfMs) {
  if (!quote?.valid_until) return false;
  const validUntil = Date.parse(quote.valid_until);
  return Number.isFinite(validUntil) && validUntil >= asOfMs;
}

function roleValid(role) {
  return role === "supplier" || role === "buyer";
}

export function verifyCounterpartyDossier(dossier = {}) {
  const reasons = [];
  const asOfMs = dossier.as_of ? Date.parse(dossier.as_of) : Date.now();
  const role = clean(dossier.role).toLowerCase();
  const identity = dossier.legal_identity || {};
  const site = dossier.official_site || {};
  const compliance = dossier.compliance || {};
  const quote = dossier.commercial_quote || {};
  const capacity = dossier.capacity || {};
  const payment = dossier.payment_terms || {};

  if (!Number.isFinite(asOfMs)) reasons.push("invalid_as_of");
  if (!roleValid(role)) reasons.push("invalid_role");

  if (!clean(identity.legal_name)) reasons.push("legal_name_missing");
  if (!clean(identity.jurisdiction)) reasons.push("jurisdiction_missing");
  if (!clean(identity.registration_id)) reasons.push("registration_id_missing");
  if (!evidenceSetValid(identity.evidence_refs)) reasons.push("legal_identity_evidence_invalid");

  if (!clean(site.domain)) reasons.push("official_domain_missing");
  if (!evidenceSetValid(site.evidence_refs)) reasons.push("official_site_evidence_invalid");

  if (!["clear", "review", "blocked"].includes(clean(compliance.status).toLowerCase())) {
    reasons.push("compliance_status_invalid");
  }
  if (!evidenceSetValid(compliance.evidence_refs)) reasons.push("compliance_evidence_invalid");
  if (!clean(compliance.screened_at) || !Number.isFinite(Date.parse(compliance.screened_at))) {
    reasons.push("compliance_screen_time_invalid");
  }

  if (!clean(quote.quote_id)) reasons.push("quote_id_missing");
  if (!finite(quote.unit_price) || quote.unit_price < 0) reasons.push("quote_price_invalid");
  if (!clean(quote.currency)) reasons.push("quote_currency_missing");
  if (!clean(quote.product_id)) reasons.push("quote_product_missing");
  if (!ALLOWED_QUOTE_STATUSES.has(clean(quote.evidence_status))) reasons.push("quote_evidence_status_invalid");
  if (!evidenceSetValid(quote.evidence_refs)) reasons.push("quote_evidence_invalid");
  if (Number.isFinite(asOfMs) && !quoteCurrent(quote, asOfMs)) reasons.push("quote_expired_or_missing_validity");

  if (!["verified", "contracted", "observed"].includes(clean(capacity.status).toLowerCase())) {
    reasons.push("capacity_status_invalid");
  }
  if (!evidenceSetValid(capacity.evidence_refs)) reasons.push("capacity_evidence_invalid");

  if (!clean(payment.terms)) reasons.push("payment_terms_missing");
  if (!evidenceSetValid(payment.evidence_refs)) reasons.push("payment_terms_evidence_invalid");

  const complianceStatus = clean(compliance.status).toLowerCase();
  const blocked = complianceStatus === "blocked";
  const review = complianceStatus === "review";

  const eligible = reasons.length === 0 && !blocked && !review;

  const contactChannels = Array.isArray(dossier.contact_channels)
    ? dossier.contact_channels.filter((channel) => channel?.public_business_channel === true)
    : [];

  const normalizedOffer = eligible ? {
    id: clean(quote.quote_id),
    role,
    name: clean(identity.legal_name),
    country: clean(identity.jurisdiction),
    region: clean(dossier.region) || null,
    registration_id: clean(identity.registration_id),
    official_website: clean(site.url) || null,
    unit_price: quote.unit_price,
    currency: clean(quote.currency).toUpperCase(),
    product_id: clean(quote.product_id),
    min_quantity: finite(quote.min_quantity) ? quote.min_quantity : null,
    max_quantity: finite(quote.max_quantity) ? quote.max_quantity : null,
    incoterm: clean(quote.incoterm) || null,
    evidence_status: clean(quote.evidence_status),
    evidence_score: finite(dossier.evidence_score) ? dossier.evidence_score : 100,
    compliance_status: "clear",
    counterparty_quality_score: finite(dossier.counterparty_quality_score)
      ? dossier.counterparty_quality_score
      : 50,
    liquidity_score: finite(dossier.liquidity_score) ? dossier.liquidity_score : 50,
    quote_valid_until: quote.valid_until,
    evidence_refs: [
      ...(identity.evidence_refs || []),
      ...(site.evidence_refs || []),
      ...(compliance.evidence_refs || []),
      ...(quote.evidence_refs || []),
      ...(capacity.evidence_refs || []),
      ...(payment.evidence_refs || []),
    ],
    contact: contactChannels[0] ? {
      company: clean(identity.legal_name),
      channel: contactChannels[0].type || "public_business_channel",
      value: contactChannels[0].value || null,
      source: contactChannels[0].source_url || site.url || null,
    } : null,
    payment_terms: payment.terms,
    capacity_status: capacity.status,
    verification_version: COUNTERPARTY_VERIFICATION_VERSION,
  } : null;

  return {
    verification_version: COUNTERPARTY_VERIFICATION_VERSION,
    role,
    legal_name: clean(identity.legal_name) || null,
    verification_status: blocked
      ? "blocked"
      : review
        ? "review_required"
        : eligible
          ? "verified_for_transaction_candidate"
          : "incomplete",
    transaction_eligible: eligible,
    rejection_reasons: reasons,
    compliance_status: complianceStatus || "unknown",
    normalized_offer: normalizedOffer,
    human_review_required: true,
    verification_scope_notice: "Verification is only as strong as the supplied evidence artifacts and does not independently certify the company beyond those sources.",
  };
}
