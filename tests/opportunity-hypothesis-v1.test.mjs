import test from "node:test";
import assert from "node:assert/strict";
import { hypothesesForSignal, generateOpportunityHypotheses } from "../supabase/functions/_shared/opportunity-hypothesis-v1.mjs";

test("maps a cocoa disruption signal into a research hypothesis without inventing profit", () => {
  const signal = {
    id: "sig-cocoa",
    title: "Cocoa export disruption reported in Ghana",
    summary: "Port delays are affecting cocoa shipments.",
    category: "supply_chain",
    affected_countries: ["GHA"],
    affected_sectors: ["agriculture"],
    evidence_hash: "a".repeat(64),
  };
  const result = hypothesesForSignal(signal, { relevance_score: 91, relevance_tier: "critical" });
  assert.equal(result.length, 1);
  assert.equal(result[0].product.id, "cocoa-beans");
  assert.equal(result[0].transaction_eligible, false);
  assert.equal(result[0].profitability_status, "unknown_until_verified_quotes_and_costs");
  assert.equal(result[0].catalyst_type, "disruption_or_constraint");
});

test("does not create a transaction hypothesis when no supported product mapping exists", () => {
  const signal = {
    id: "sig-general",
    title: "General constitutional debate continues",
    summary: "Political discussions are ongoing.",
    category: "governance",
  };
  assert.deepEqual(hypothesesForSignal(signal), []);
});

test("one signal can map transparently to multiple explicitly mentioned products", () => {
  const signal = {
    id: "sig-minerals",
    title: "Export restrictions affect gallium and germanium",
    summary: "New restrictions concern gallium and germanium shipments.",
    category: "supply_chain",
  };
  const result = hypothesesForSignal(signal);
  assert.deepEqual(result.map((item) => item.product.id).sort(), ["gallium", "germanium"]);
});

test("hypotheses preserve source evidence metadata", () => {
  const signal = {
    id: "sig-copper",
    title: "Copper supply disruption",
    source_references: [{ url: "https://example.test/source" }],
    source_identifier_count: 1,
    source_independence_status: "not_established",
    evidence_hash: "b".repeat(64),
  };
  const result = hypothesesForSignal(signal)[0];
  assert.equal(result.evidence_manifest.source_signal_id, "sig-copper");
  assert.equal(result.evidence_manifest.source_references.length, 1);
  assert.equal(result.evidence_manifest.source_independence_status, "not_established");
});

test("multi-signal generator sorts by existing personalized relevance rather than claiming global importance", () => {
  const signals = [
    { id: "a", title: "Copper disruption" },
    { id: "b", title: "Cocoa shortage" },
  ];
  const result = generateOpportunityHypotheses(signals, {
    a: { relevance_score: 45, relevance_tier: "discovery" },
    b: { relevance_score: 90, relevance_tier: "critical" },
  });
  assert.equal(result[0].source_signal_id, "b");
});
