
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildResearchCompletionResolution,
  researchActionKindForCompletion,
} from "../supabase/functions/_shared/strategic-research-completion-v1.mjs";

test("verified supplier quote resolves only supplier quote research", () => {
  assert.equal(researchActionKindForCompletion("supplier_quote_verified"), "refresh_supplier_quote");
});

test("verified buyer quote resolves only buyer quote research", () => {
  assert.equal(researchActionKindForCompletion("buyer_quote_verified"), "refresh_buyer_quote");
});

test("verified logistics route maps to route refresh blocker", () => {
  assert.equal(researchActionKindForCompletion("logistics_route_verified"), "refresh_route_quote");
});

test("reference FX does not resolve executable FX blocker", () => {
  assert.equal(researchActionKindForCompletion("reference_fx_attached"), "verified_fx_normalization");
  assert.notEqual(researchActionKindForCompletion("reference_fx_attached"), "obtain_executable_fx_quote");
});

test("executable FX has a distinct completion kind", () => {
  assert.equal(researchActionKindForCompletion("executable_fx_verified"), "obtain_executable_fx_quote");
});

test("unsupported completion kind fails closed", () => {
  assert.equal(researchActionKindForCompletion("profit_confirmed"), null);
  const result = buildResearchCompletionResolution("profit_confirmed");
  assert.equal(result.ok, false);
  assert.equal(result.resolution, null);
});

test("completion resolution records evidence satisfaction rather than profit success", () => {
  const result = buildResearchCompletionResolution("buyer_quote_verified", {
    quote_id: "BQ-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.resolution.disposition, "evidence_satisfied_blocker");
  assert.equal(result.resolution.action_kind, "refresh_buyer_quote");
  assert.equal(result.resolution.metadata.quote_id, "BQ-1");
});
