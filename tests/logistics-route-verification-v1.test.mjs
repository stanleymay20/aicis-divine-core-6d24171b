import test from "node:test";
import assert from "node:assert/strict";
import { verifyLogisticsRouteDossier } from "../supabase/functions/_shared/logistics-route-verification-v1.mjs";

const HASH = "e".repeat(64);
const ref = (id) => [{ source_id: id, observed_at: "2026-09-27T08:00:00Z", sha256: HASH }];

function dossier() {
  return {
    as_of: "2026-09-27T09:00:00Z",
    provider: {
      legal_name: "Verified Freight GmbH",
      jurisdiction: "Germany",
      registration_id: "HRB-123",
      evidence_refs: ref("registry"),
    },
    compliance: {
      status: "clear",
      screened_at: "2026-09-27T08:30:00Z",
      evidence_refs: ref("compliance"),
    },
    route_quote: {
      quote_id: "FQ-123",
      route_name: "Tema-Hamburg standard",
      origin_country: "Ghana",
      destination_country: "Germany",
      transit_days: 20,
      valid_until: "2026-09-30T23:00:00Z",
      evidence_status: "verified_quote",
      evidence_refs: ref("route-quote"),
      stops: ["Tema", "Hamburg"],
      costs: [
        { type: "freight", amount: 400, basis: "per_unit", currency: "EUR", evidence_refs: ref("freight") },
        { type: "insurance", amount: 600, basis: "fixed", currency: "EUR", evidence_refs: ref("insurance") },
      ],
    },
    capacity: {
      status: "verified",
      evidence_refs: ref("capacity"),
    },
    contact_channels: [{
      type: "generic_business_email",
      value: "sales@freight.example",
      source_url: "https://freight.example/contact",
      public_business_channel: true,
    }],
    evidence_score: 90,
    capacity_score: 85,
  };
}

test("complete evidenced logistics dossier becomes a normalized route", () => {
  const result = verifyLogisticsRouteDossier(dossier());
  assert.equal(result.transaction_eligible, true);
  assert.equal(result.verification_status, "verified_route_candidate");
  assert.equal(result.normalized_route.origin_country, "Ghana");
  assert.equal(result.normalized_route.destination_country, "Germany");
  assert.equal(result.normalized_route.costs.length, 2);
});

test("expired logistics quote fails closed", () => {
  const input = dossier();
  input.route_quote.valid_until = "2026-09-27T08:45:00Z";
  const result = verifyLogisticsRouteDossier(input);
  assert.equal(result.transaction_eligible, false);
  assert.ok(result.rejection_reasons.includes("route_quote_expired_or_missing_validity"));
});

test("missing cost evidence prevents route normalization", () => {
  const input = dossier();
  input.route_quote.costs[0].evidence_refs = [];
  const result = verifyLogisticsRouteDossier(input);
  assert.equal(result.transaction_eligible, false);
  assert.ok(result.rejection_reasons.includes("route_cost_evidence_invalid"));
});

test("compliance review remains non-executable", () => {
  const input = dossier();
  input.compliance.status = "review";
  const result = verifyLogisticsRouteDossier(input);
  assert.equal(result.transaction_eligible, false);
  assert.equal(result.verification_status, "review_required");
});

test("blocked provider is hard-stopped", () => {
  const input = dossier();
  input.compliance.status = "blocked";
  const result = verifyLogisticsRouteDossier(input);
  assert.equal(result.transaction_eligible, false);
  assert.equal(result.verification_status, "blocked");
});

test("public generic contact can be carried into normalized route", () => {
  const result = verifyLogisticsRouteDossier(dossier());
  assert.equal(result.normalized_route.contact.value, "sales@freight.example");
});
