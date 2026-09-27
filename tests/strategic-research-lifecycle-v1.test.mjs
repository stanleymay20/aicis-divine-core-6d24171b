
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeResearchEvidenceRefs,
  normalizeResearchResolution,
  validateStrategicResearchTransition,
} from "../supabase/functions/_shared/strategic-research-lifecycle-v1.mjs";

test("pending task can start, block, resolve, stale, or cancel", () => {
  for (const target of ["in_progress", "blocked", "resolved", "stale", "cancelled"]) {
    assert.equal(validateStrategicResearchTransition("pending", target).ok, true);
  }
});

test("in-progress task can resolve or block but not return to pending", () => {
  assert.equal(validateStrategicResearchTransition("in_progress", "resolved").ok, true);
  assert.equal(validateStrategicResearchTransition("in_progress", "blocked").ok, true);
  assert.equal(validateStrategicResearchTransition("in_progress", "pending").ok, false);
});

test("blocked task may resume but terminal states remain terminal", () => {
  assert.equal(validateStrategicResearchTransition("blocked", "in_progress").ok, true);
  for (const terminal of ["resolved", "stale", "cancelled"]) {
    assert.equal(validateStrategicResearchTransition(terminal, "in_progress").ok, false);
  }
});

test("same-status update is idempotent", () => {
  assert.deepEqual(
    validateStrategicResearchTransition("in_progress", "in_progress"),
    { ok: true, reason: "no_change" },
  );
});

test("evidence normalization requires attributable timestamp plus hash or citation", () => {
  const refs = normalizeResearchEvidenceRefs([
    {
      source_id: "quote-1",
      observed_at: "2026-09-27T12:00:00Z",
      sha256: "a".repeat(64),
      source_url: "https://example.com/quote",
    },
    {
      source_id: "citation-1",
      observed_at: "2026-09-27T12:00:00Z",
      citation_id: "citation:123",
    },
    {
      source_id: "bad",
      observed_at: "not-a-date",
      sha256: "b".repeat(64),
    },
  ]);

  assert.equal(refs.length, 2);
  assert.equal(refs[0].source_id, "quote-1");
  assert.equal(refs[1].citation_id, "citation:123");
});

test("resolution normalization rejects arrays and primitives", () => {
  assert.deepEqual(normalizeResearchResolution(null), {});
  assert.deepEqual(normalizeResearchResolution([]), {});
  assert.deepEqual(normalizeResearchResolution("resolved"), {});
  assert.deepEqual(normalizeResearchResolution({ note: "verified", amount: 10 }), {
    note: "verified",
    amount: 10,
  });
});
