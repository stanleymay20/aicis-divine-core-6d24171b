import test from "node:test";
import assert from "node:assert/strict";
import {
  convertVerifiedAmount,
  requiredFxPairs,
  validateFxRate,
} from "../supabase/functions/_shared/verified-fx-v1.mjs";

const HASH = "c".repeat(64);
const evidence = (id) => [{ source_id: id, observed_at: "2026-09-27T05:00:00Z", sha256: HASH }];

const eurUsd = {
  id: "fx-eur-usd",
  base_currency: "EUR",
  quote_currency: "USD",
  rate: 1.2,
  observed_at: "2026-09-27T05:00:00Z",
  valid_until: "2026-09-27T12:00:00Z",
  evidence_status: "verified_market",
  provider: "verified-provider",
  evidence_refs: evidence("fx-source"),
};

test("validates attributable current FX observations", () => {
  const result = validateFxRate(eurUsd, "2026-09-27T06:00:00Z");
  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);
});

test("converts direct quoted currency using verified rate", () => {
  const result = convertVerifiedAmount(100, "EUR", "USD", [eurUsd], "2026-09-27T06:00:00Z");
  assert.equal(result.ok, true);
  assert.equal(result.amount, 120);
  assert.equal(result.direction, "direct");
});

test("supports inverse conversion without inventing a second rate", () => {
  const result = convertVerifiedAmount(120, "USD", "EUR", [eurUsd], "2026-09-27T06:00:00Z");
  assert.equal(result.ok, true);
  assert.equal(result.amount, 100);
  assert.equal(result.direction, "inverse");
});

test("identity conversion requires no FX evidence", () => {
  const result = convertVerifiedAmount(50, "EUR", "EUR", [], "2026-09-27T06:00:00Z");
  assert.equal(result.ok, true);
  assert.equal(result.rate, 1);
  assert.deepEqual(result.evidence_refs, []);
});

test("stale FX evidence fails closed", () => {
  const stale = { ...eurUsd, valid_until: "2026-09-27T05:30:00Z" };
  const result = convertVerifiedAmount(100, "EUR", "USD", [stale], "2026-09-27T06:00:00Z");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "verified_fx_rate_unavailable");
});

test("provenance-free FX rate fails closed", () => {
  const bad = { ...eurUsd, evidence_refs: [] };
  const result = convertVerifiedAmount(100, "EUR", "USD", [bad], "2026-09-27T06:00:00Z");
  assert.equal(result.ok, false);
});

test("returns only FX pairs needed for the requested comparison currency", () => {
  const pairs = requiredFxPairs(["EUR", "USD", "GHS", "EUR"], "EUR");
  assert.deepEqual(pairs, [
    { from_currency: "USD", to_currency: "EUR" },
    { from_currency: "GHS", to_currency: "EUR" },
  ]);
});
