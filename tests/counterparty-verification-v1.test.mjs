import test from "node:test";
import assert from "node:assert/strict";
import { verifyCounterpartyDossier } from "../supabase/functions/_shared/counterparty-verification-v1.mjs";

const HASH = "b".repeat(64);
const ref = (id) => [{ source_id: id, observed_at: "2026-09-27T05:00:00Z", sha256: HASH }];

function dossier() {
  return {
    as_of: "2026-09-27T06:00:00Z",
    role: "supplier",
    legal_identity: {
      legal_name: "Verified Cocoa Export Ltd",
      jurisdiction: "Ghana",
      registration_id: "GH-123",
      evidence_refs: ref("registry"),
    },
    official_site: {
      domain: "example.com",
      url: "https://example.com",
      evidence_refs: ref("official-site"),
    },
    compliance: {
      status: "clear",
      screened_at: "2026-09-27T05:30:00Z",
      evidence_refs: ref("compliance"),
    },
    commercial_quote: {
      quote_id: "Q-123",
      product_id: "cocoa-beans",
      unit_price: 3000,
      currency: "EUR",
      min_quantity: 1,
      max_quantity: 50,
      incoterm: "FOB",
      valid_until: "2026-09-30T23:00:00Z",
      evidence_status: "verified_quote",
      evidence_refs: ref("quote"),
    },
    capacity: {
      status: "verified",
      evidence_refs: ref("capacity"),
    },
    payment_terms: {
      terms: "30% deposit, balance against documents",
      evidence_refs: ref("payment"),
    },
    contact_channels: [{
      type: "generic_business_email",
      value: "sales@example.com",
      source_url: "https://example.com/contact",
      public_business_channel: true,
    }],
    evidence_score: 88,
    counterparty_quality_score: 82,
  };
}

test("complete evidenced dossier becomes a normalized transaction-eligible offer", () => {
  const result = verifyCounterpartyDossier(dossier());
  assert.equal(result.transaction_eligible, true);
  assert.equal(result.verification_status, "verified_for_transaction_candidate");
  assert.equal(result.normalized_offer.name, "Verified Cocoa Export Ltd");
  assert.equal(result.normalized_offer.unit_price, 3000);
  assert.equal(result.normalized_offer.compliance_status, "clear");
});

test("discovery-only data without registry and quote evidence cannot become transaction eligible", () => {
  const result = verifyCounterpartyDossier({
    as_of: "2026-09-27T06:00:00Z",
    role: "supplier",
    legal_identity: { legal_name: "Possible Supplier" },
    official_site: { domain: "example.com" },
    compliance: { status: "unknown" },
    commercial_quote: {},
    capacity: {},
    payment_terms: {},
  });
  assert.equal(result.transaction_eligible, false);
  assert.ok(result.rejection_reasons.includes("registration_id_missing"));
  assert.ok(result.rejection_reasons.includes("quote_id_missing"));
});

test("blocked compliance can never produce a normalized offer", () => {
  const input = dossier();
  input.compliance.status = "blocked";
  const result = verifyCounterpartyDossier(input);
  assert.equal(result.transaction_eligible, false);
  assert.equal(result.verification_status, "blocked");
  assert.equal(result.normalized_offer, null);
});

test("review compliance remains non-executable until cleared", () => {
  const input = dossier();
  input.compliance.status = "review";
  const result = verifyCounterpartyDossier(input);
  assert.equal(result.transaction_eligible, false);
  assert.equal(result.verification_status, "review_required");
});

test("expired quote fails closed", () => {
  const input = dossier();
  input.commercial_quote.valid_until = "2026-09-26T23:00:00Z";
  const result = verifyCounterpartyDossier(input);
  assert.equal(result.transaction_eligible, false);
  assert.ok(result.rejection_reasons.includes("quote_expired_or_missing_validity"));
});

test("non-public contact channels are excluded from normalized offer", () => {
  const input = dossier();
  input.contact_channels = [{
    type: "email",
    value: "person@example.com",
    public_business_channel: false,
  }];
  const result = verifyCounterpartyDossier(input);
  assert.equal(result.transaction_eligible, true);
  assert.equal(result.normalized_offer.contact, null);
});
