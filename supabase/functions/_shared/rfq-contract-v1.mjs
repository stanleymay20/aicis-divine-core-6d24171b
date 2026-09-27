
export const RFQ_CONTRACT_VERSION = "aicis-rfq-v1";

const SHA256 = /^[a-f0-9]{64}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const GENERIC_EMAIL_LOCAL = /^(sales|procurement|purchasing|sourcing|info|contact|export|exports|trade|commercial|orders|quotes|rfq|business|office|hello)([._+-].*)?$/i;
const ALLOWED_CONTACT_CHANNELS = new Set([
  "official_procurement",
  "procurement",
  "official_sales",
  "sales",
  "public_business_channel",
  "business_email",
  "website_form",
  "official_website",
]);
const ALLOWED_COUNTERPARTY_ROLES = new Set(["supplier", "buyer", "logistics"]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();
const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

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

function publicBusinessContactValid(contact) {
  if (!contact || typeof contact !== "object" || Array.isArray(contact)) return false;
  const channel = clean(contact.channel).toLowerCase();
  const value = clean(contact.value);
  const source = clean(contact.source);
  if (!ALLOWED_CONTACT_CHANNELS.has(channel)) return false;
  if (!value || !source) return false;

  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    if (!local || !domain || !domain.includes(".")) return false;
    if (!GENERIC_EMAIL_LOCAL.test(local)) return false;
  }

  return true;
}

function cleanLines(values) {
  return list(values).map(clean).filter(Boolean);
}

function formatList(values) {
  const items = cleanLines(values);
  return items.length ? items.join(", ") : "not specified";
}

function deterministicMessage({
  rfqId,
  counterparty,
  product,
  quantity,
  commercial,
  quality,
  responseDeadline,
}) {
  const destination = clean(commercial.destination);
  const currencyPreferences = cleanLines(commercial.currency_preferences);
  const incoterms = cleanLines(commercial.requested_incoterms);
  const paymentTerms = cleanLines(commercial.requested_payment_terms);
  const deliveryWindow = clean(commercial.delivery_window);
  const qualityRequirements = cleanLines(quality.requirements);
  const certificationRequirements = cleanLines(quality.certifications);

  const subject = `RFQ ${rfqId}: ${product.name} — ${quantity.amount} ${quantity.unit}`;

  const lines = [
    `Dear ${counterparty.legal_name} Commercial Team,`,
    "",
    `Please provide a commercial quotation for the following request (RFQ ${rfqId}).`,
    "",
    `Product: ${product.name}`,
    product.specification ? `Specification: ${product.specification}` : null,
    `Quantity: ${quantity.amount} ${quantity.unit}`,
    destination ? `Destination: ${destination}` : null,
    `Requested Incoterm(s): ${formatList(incoterms)}`,
    `Preferred quote currency/currencies: ${formatList(currencyPreferences)}`,
    `Requested payment term(s): ${formatList(paymentTerms)}`,
    deliveryWindow ? `Requested delivery window: ${deliveryWindow}` : null,
    qualityRequirements.length ? `Quality requirements: ${formatList(qualityRequirements)}` : null,
    certificationRequirements.length ? `Certification requirements: ${formatList(certificationRequirements)}` : null,
    "",
    "Please include in your response:",
    "- legal entity name and registration/jurisdiction reference;",
    "- unit price and total price;",
    "- currency;",
    "- Incoterm and named place/port where applicable;",
    "- minimum/maximum quantity or available capacity;",
    "- production/dispatch lead time and expected delivery window;",
    "- payment terms;",
    "- quote validity / expiry;",
    "- applicable taxes, handling, inspection, insurance or other charges that are not included in the quoted price;",
    "- official contact details for commercial follow-up.",
    "",
    `Please respond by: ${responseDeadline}`,
    "",
    "This request is for quotation and due diligence only. It is not a purchase order, contract, commitment, or authorization to supply.",
    "",
    "Regards,",
    "AICIS-assisted procurement research",
  ].filter((line) => line !== null);

  return { subject, body: lines.join("\n") };
}

export function buildRfqDraft(input = {}, asOf = new Date().toISOString()) {
  const reasons = [];
  const asOfMs = Date.parse(asOf);
  const candidateId = clean(input.candidate_id);
  const strategicAuditHash = clean(input.strategic_audit_hash).toLowerCase();
  const counterparty = input.counterparty || {};
  const product = input.product || {};
  const quantity = input.quantity || {};
  const commercial = input.commercial || {};
  const quality = input.quality || {};
  const contact = input.contact || counterparty.contact || {};
  const responseDeadline = clean(input.response_deadline);
  const responseDeadlineMs = Date.parse(responseDeadline);

  if (!Number.isFinite(asOfMs)) reasons.push("invalid_as_of");
  if (!candidateId) reasons.push("candidate_id_missing");
  if (!SHA256.test(strategicAuditHash)) reasons.push("strategic_audit_hash_invalid");

  const role = clean(counterparty.role).toLowerCase();
  if (!ALLOWED_COUNTERPARTY_ROLES.has(role)) reasons.push("counterparty_role_invalid");
  if (!clean(counterparty.id)) reasons.push("counterparty_id_missing");
  if (!clean(counterparty.legal_name)) reasons.push("counterparty_legal_name_missing");
  if (!clean(counterparty.jurisdiction)) reasons.push("counterparty_jurisdiction_missing");
  if (clean(counterparty.compliance_status).toLowerCase() !== "clear") reasons.push("counterparty_compliance_not_clear");
  if (!evidenceSetValid(counterparty.evidence_refs)) reasons.push("counterparty_evidence_invalid");

  if (!publicBusinessContactValid(contact)) reasons.push("public_business_contact_invalid");

  if (!clean(product.id)) reasons.push("product_id_missing");
  if (!clean(product.name)) reasons.push("product_name_missing");
  if (!finite(quantity.amount) || quantity.amount <= 0) reasons.push("quantity_invalid");
  if (!clean(quantity.unit)) reasons.push("quantity_unit_missing");

  const currencyPreferences = cleanLines(commercial.currency_preferences).map(upper);
  if (currencyPreferences.some((item) => !CURRENCY.test(item))) reasons.push("currency_preference_invalid");
  if (!clean(commercial.destination)) reasons.push("destination_missing");
  if (!cleanLines(commercial.requested_incoterms).length) reasons.push("requested_incoterm_missing");
  if (!cleanLines(commercial.requested_payment_terms).length) reasons.push("requested_payment_terms_missing");

  if (!responseDeadline || !Number.isFinite(responseDeadlineMs)) {
    reasons.push("response_deadline_invalid");
  } else if (Number.isFinite(asOfMs) && responseDeadlineMs <= asOfMs) {
    reasons.push("response_deadline_not_future");
  }

  const rfqIdSeed = [
    candidateId,
    clean(counterparty.id),
    clean(product.id),
    String(quantity.amount ?? ""),
    clean(quantity.unit),
    responseDeadline,
  ].join("|");
  const rfqId = "rfq:" + rfqIdSeed
    .toLowerCase()
    .replace(/[^a-z0-9._|:-]+/g, "-")
    .replace(/\|/g, ":")
    .slice(0, 120);

  const normalized = {
    rfq_id: rfqId,
    candidate_id: candidateId || null,
    strategic_audit_hash: SHA256.test(strategicAuditHash) ? strategicAuditHash : null,
    counterparty: {
      id: clean(counterparty.id) || null,
      role: role || null,
      legal_name: clean(counterparty.legal_name) || null,
      jurisdiction: clean(counterparty.jurisdiction) || null,
      registration_id: clean(counterparty.registration_id) || null,
      compliance_status: clean(counterparty.compliance_status).toLowerCase() || null,
      official_website: clean(counterparty.official_website) || null,
      evidence_refs: list(counterparty.evidence_refs),
    },
    contact: {
      company: clean(contact.company || counterparty.legal_name) || null,
      channel: clean(contact.channel).toLowerCase() || null,
      value: clean(contact.value) || null,
      source: clean(contact.source) || null,
      public_business_channel: publicBusinessContactValid(contact),
    },
    product: {
      id: clean(product.id) || null,
      name: clean(product.name) || null,
      specification: clean(product.specification) || null,
    },
    quantity: {
      amount: finite(quantity.amount) ? quantity.amount : null,
      unit: clean(quantity.unit) || null,
    },
    commercial: {
      destination: clean(commercial.destination) || null,
      requested_incoterms: cleanLines(commercial.requested_incoterms),
      currency_preferences: currencyPreferences,
      requested_payment_terms: cleanLines(commercial.requested_payment_terms),
      delivery_window: clean(commercial.delivery_window) || null,
    },
    quality: {
      requirements: cleanLines(quality.requirements),
      certifications: cleanLines(quality.certifications),
    },
    response_deadline: responseDeadline || null,
    generated_at: Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null,
  };

  const message = reasons.length
    ? null
    : deterministicMessage({
        rfqId,
        counterparty: normalized.counterparty,
        product: normalized.product,
        quantity: normalized.quantity,
        commercial: normalized.commercial,
        quality: normalized.quality,
        responseDeadline: normalized.response_deadline,
      });

  return {
    contract_version: RFQ_CONTRACT_VERSION,
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    draft: reasons.length
      ? null
      : {
          ...normalized,
          message,
          requested_response_fields: [
            "legal_identity",
            "unit_price",
            "total_price",
            "currency",
            "incoterm",
            "named_place_or_port",
            "capacity",
            "lead_time",
            "delivery_window",
            "payment_terms",
            "valid_until",
            "excluded_or_additional_costs",
            "official_business_contact",
          ],
        },
    approval: {
      human_approval_required_before_send: true,
      approved_to_send: false,
      approval_token: null,
      sent: false,
      sent_at: null,
    },
    execution_boundary: {
      outbound_message_sent: false,
      purchase_order_created: false,
      contract_signed: false,
      money_moved: false,
    },
    semantics: "rfq_draft_for_human_review_not_purchase_order_or_commitment",
  };
}

export function normalizeRfqResponse(input = {}, asOf = new Date().toISOString()) {
  const reasons = [];
  const asOfMs = Date.parse(asOf);
  const evidence = input.evidence_refs;
  const role = clean(input.role).toLowerCase();
  const currency = upper(input.currency);
  const validUntil = clean(input.valid_until);
  const validUntilMs = Date.parse(validUntil);

  if (!Number.isFinite(asOfMs)) reasons.push("invalid_as_of");
  if (!clean(input.rfq_id)) reasons.push("rfq_id_missing");
  if (!clean(input.quote_id)) reasons.push("quote_id_missing");
  if (!["supplier", "buyer"].includes(role)) reasons.push("quote_role_invalid");
  if (!clean(input.counterparty_id)) reasons.push("counterparty_id_missing");
  if (!clean(input.legal_name)) reasons.push("legal_name_missing");
  if (!clean(input.jurisdiction)) reasons.push("jurisdiction_missing");
  if (!clean(input.product_id)) reasons.push("product_id_missing");
  if (!finite(input.unit_price) || input.unit_price < 0) reasons.push("unit_price_invalid");
  if (!CURRENCY.test(currency)) reasons.push("currency_invalid");
  if (!finite(input.quantity) || input.quantity <= 0) reasons.push("quantity_invalid");
  if (!clean(input.quantity_unit)) reasons.push("quantity_unit_missing");
  if (!clean(input.incoterm)) reasons.push("incoterm_missing");
  if (!clean(input.payment_terms)) reasons.push("payment_terms_missing");
  if (!evidenceSetValid(evidence)) reasons.push("quote_evidence_invalid");
  if (!validUntil || !Number.isFinite(validUntilMs)) {
    reasons.push("valid_until_invalid");
  } else if (Number.isFinite(asOfMs) && validUntilMs < asOfMs) {
    reasons.push("quote_expired");
  }

  const normalized = reasons.length ? null : {
    id: clean(input.quote_id),
    rfq_id: clean(input.rfq_id),
    role,
    name: clean(input.legal_name),
    country: clean(input.jurisdiction),
    registration_id: clean(input.registration_id) || null,
    official_website: clean(input.official_website) || null,
    unit_price: input.unit_price,
    currency,
    product_id: clean(input.product_id),
    requested_quantity: input.quantity,
    requested_quantity_unit: clean(input.quantity_unit),
    min_quantity: finite(input.min_quantity) ? input.min_quantity : null,
    max_quantity: finite(input.max_quantity) ? input.max_quantity : null,
    incoterm: clean(input.incoterm),
    named_place_or_port: clean(input.named_place_or_port) || null,
    payment_terms: clean(input.payment_terms),
    lead_time_days: finite(input.lead_time_days) ? input.lead_time_days : null,
    delivery_window: clean(input.delivery_window) || null,
    quote_valid_until: validUntil,
    additional_costs: list(input.additional_costs),
    evidence_status: "rfq_response_unverified",
    evidence_refs: list(evidence),
    contact: input.contact ?? null,
    compliance_status: "unknown",
    transaction_eligible: false,
  };

  return {
    contract_version: RFQ_CONTRACT_VERSION,
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    normalized_response: normalized,
    next_required_gate: reasons.length
      ? "correct_response_evidence"
      : "counterparty_and_commercial_quote_verification",
    transaction_eligible: false,
    quote_executed: false,
    contract_signed: false,
    money_moved: false,
    semantics: "rfq_response_evidence_not_verified_transaction_offer",
  };
}
