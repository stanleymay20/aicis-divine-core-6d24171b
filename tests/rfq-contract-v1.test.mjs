
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRfqDraft,
  normalizeRfqResponse,
} from "../supabase/functions/_shared/rfq-contract-v1.mjs";

const HASH = "a".repeat(64);
const evidence = (id) => [{
  source_id: id,
  observed_at: "2026-09-27T15:00:00Z",
  sha256: HASH,
}];

function baseInput() {
  return {
    candidate_id: "tx:cocoa:ghana:germany",
    strategic_audit_hash: HASH,
    counterparty: {
      id: "supplier-1",
      role: "supplier",
      legal_name: "Verified Cocoa Exporter Ltd",
      jurisdiction: "Ghana",
      registration_id: "GH-12345",
      compliance_status: "clear",
      official_website: "https://example.test",
      evidence_refs: evidence("supplier"),
    },
    contact: {
      company: "Verified Cocoa Exporter Ltd",
      channel: "official_sales",
      value: "sales@example.test",
      source: "https://example.test/contact",
    },
    product: {
      id: "cocoa",
      name: "Cocoa beans",
      specification: "Grade 1 export quality",
    },
    quantity: { amount: 10, unit: "tonnes" },
    commercial: {
      destination: "Hamburg, Germany",
      requested_incoterms: ["CIF Hamburg", "FOB Tema"],
      currency_preferences: ["EUR", "USD"],
      requested_payment_terms: ["LC at sight", "30% deposit / 70% against documents"],
      delivery_window: "October 2026",
    },
    quality: {
      requirements: ["moisture <= 7.5%"],
      certifications: ["phytosanitary certificate"],
    },
    response_deadline: "2026-09-30T12:00:00Z",
  };
}

test("builds deterministic RFQ draft with explicit no-send boundary", () => {
  const result = buildRfqDraft(baseInput(), "2026-09-27T15:10:00Z");
  assert.equal(result.valid, true);
  assert.match(result.draft.message.subject, /RFQ/);
  assert.match(result.draft.message.body, /not a purchase order/i);
  assert.match(result.draft.message.body, /10 tonnes/);
  assert.equal(result.approval.approved_to_send, false);
  assert.equal(result.approval.sent, false);
  assert.equal(result.execution_boundary.outbound_message_sent, false);
  assert.equal(result.execution_boundary.contract_signed, false);
  assert.equal(result.execution_boundary.money_moved, false);
});

test("rejects personal-looking email instead of treating it as business contact", () => {
  const input = baseInput();
  input.contact.value = "john.smith@example.test";
  const result = buildRfqDraft(input, "2026-09-27T15:10:00Z");
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("public_business_contact_invalid"));
});

test("requires clear compliance before preparing counterparty RFQ", () => {
  const input = baseInput();
  input.counterparty.compliance_status = "review";
  const result = buildRfqDraft(input, "2026-09-27T15:10:00Z");
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("counterparty_compliance_not_clear"));
});

test("requires future response deadline", () => {
  const input = baseInput();
  input.response_deadline = "2026-09-26T12:00:00Z";
  const result = buildRfqDraft(input, "2026-09-27T15:10:00Z");
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("response_deadline_not_future"));
});

test("normalizes evidenced RFQ response but keeps it non-transaction-eligible", () => {
  const result = normalizeRfqResponse({
    rfq_id: "rfq:1",
    quote_id: "supplier-quote-77",
    role: "supplier",
    counterparty_id: "supplier-1",
    legal_name: "Verified Cocoa Exporter Ltd",
    jurisdiction: "Ghana",
    registration_id: "GH-12345",
    product_id: "cocoa",
    unit_price: 3100,
    currency: "EUR",
    quantity: 10,
    quantity_unit: "tonnes",
    incoterm: "CIF",
    named_place_or_port: "Hamburg",
    payment_terms: "LC at sight",
    lead_time_days: 18,
    valid_until: "2026-10-02T12:00:00Z",
    evidence_refs: evidence("rfq-response"),
  }, "2026-09-27T15:10:00Z");

  assert.equal(result.valid, true);
  assert.equal(result.normalized_response.evidence_status, "rfq_response_unverified");
  assert.equal(result.transaction_eligible, false);
  assert.equal(result.next_required_gate, "counterparty_and_commercial_quote_verification");
});

test("RFQ response without attributable evidence fails closed", () => {
  const result = normalizeRfqResponse({
    rfq_id: "rfq:1",
    quote_id: "supplier-quote-77",
    role: "supplier",
    counterparty_id: "supplier-1",
    legal_name: "Verified Cocoa Exporter Ltd",
    jurisdiction: "Ghana",
    product_id: "cocoa",
    unit_price: 3100,
    currency: "EUR",
    quantity: 10,
    quantity_unit: "tonnes",
    incoterm: "CIF",
    payment_terms: "LC at sight",
    valid_until: "2026-10-02T12:00:00Z",
    evidence_refs: [],
  }, "2026-09-27T15:10:00Z");

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("quote_evidence_invalid"));
});

test("RFQ response cannot silently become verified quote", () => {
  const result = normalizeRfqResponse({
    rfq_id: "rfq:1",
    quote_id: "supplier-quote-77",
    role: "supplier",
    counterparty_id: "supplier-1",
    legal_name: "Verified Cocoa Exporter Ltd",
    jurisdiction: "Ghana",
    product_id: "cocoa",
    unit_price: 3100,
    currency: "EUR",
    quantity: 10,
    quantity_unit: "tonnes",
    incoterm: "CIF",
    payment_terms: "LC at sight",
    valid_until: "2026-10-02T12:00:00Z",
    evidence_refs: evidence("rfq-response"),
    evidence_status: "verified_quote",
  }, "2026-09-27T15:10:00Z");

  assert.equal(result.valid, true);
  assert.equal(result.normalized_response.evidence_status, "rfq_response_unverified");
  assert.equal(result.normalized_response.transaction_eligible, false);
});


test("full landed cost response requires evidence for that completeness claim", () => {
  const result = normalizeRfqResponse({
    rfq_id: "rfq:1",
    quote_id: "supplier-quote-77",
    role: "supplier",
    counterparty_id: "supplier-1",
    legal_name: "Verified Cocoa Exporter Ltd",
    jurisdiction: "Ghana",
    product_id: "cocoa",
    unit_price: 3100,
    currency: "EUR",
    quantity: 10,
    quantity_unit: "tonnes",
    incoterm: "CIF",
    payment_terms: "LC at sight",
    cost_completeness: "full_landed_cost",
    cost_completeness_evidence_refs: [],
    valid_until: "2026-10-02T12:00:00Z",
    evidence_refs: evidence("rfq-response"),
  }, "2026-09-27T15:10:00Z");

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("cost_completeness_evidence_invalid"));
});

test("evidenced additional costs survive normalization", () => {
  const result = normalizeRfqResponse({
    rfq_id: "rfq:1",
    quote_id: "supplier-quote-77",
    role: "supplier",
    counterparty_id: "supplier-1",
    legal_name: "Verified Cocoa Exporter Ltd",
    jurisdiction: "Ghana",
    product_id: "cocoa",
    unit_price: 3100,
    currency: "EUR",
    quantity: 10,
    quantity_unit: "tonnes",
    incoterm: "CIF",
    payment_terms: "LC at sight",
    cost_completeness: "full_landed_cost",
    cost_completeness_evidence_refs: evidence("landed-completeness"),
    additional_costs: [{
      type: "inspection",
      amount: 500,
      basis: "fixed",
      currency: "EUR",
      evidence_refs: evidence("inspection-cost"),
    }],
    valid_until: "2026-10-02T12:00:00Z",
    evidence_refs: evidence("rfq-response"),
  }, "2026-09-27T15:10:00Z");

  assert.equal(result.valid, true);
  assert.equal(result.normalized_response.cost_completeness, "full_landed_cost");
  assert.equal(result.normalized_response.additional_costs[0].amount, 500);
});
