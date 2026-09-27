
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaricDutyRow } from "../supabase/functions/_shared/taric-duty-row-normalizer-v1.mjs";

const HASH = "d".repeat(64);

function simpleRow() {
  return [
    "2403110000",
    "",
    "",
    "01-01-2026",
    "",
    "",
    "Erga Omnes",
    "Third country duty",
    "Regulation 0001/26",
    "74.900 %",
    "1011",
    "103",
  ];
}

test("normalizes documented TARIC A-L fields but never claims applicability", () => {
  const result = normalizeTaricDutyRow({
    direction: "import",
    columns: simpleRow(),
    extraction_reference_date: "2026-09-01",
    observed_at: "2026-09-27T17:00:00Z",
    source_sha256: HASH,
  });

  assert.equal(result.valid, true);
  assert.equal(result.normalized_measure.goods_code, "2403110000");
  assert.equal(result.normalized_measure.parsed_duty.kind, "simple_ad_valorem_percentage");
  assert.equal(result.normalized_measure.parsed_duty.candidate_rate_pct, 74.9);
  assert.equal(result.applicability_status, "unresolved");
  assert.equal(result.landed_cost_component, null);
  assert.equal(result.tariff_rate_claimed_applicable, false);
  assert.ok(result.unresolved_dependencies.includes("geographical_area_membership"));
  assert.ok(result.unresolved_dependencies.includes("goods_nomenclature_parent_cascade"));
});

test("compound duty expression remains unresolved instead of being reduced to a percentage", () => {
  const row = simpleRow();
  row[9] = "5.400 % MAX 3.500 EUR HMT";

  const result = normalizeTaricDutyRow({
    direction: "import",
    columns: row,
    extraction_reference_date: "01-09-2026",
    observed_at: "2026-09-27T17:00:00Z",
    source_sha256: HASH,
  });

  assert.equal(result.valid, true);
  assert.equal(result.normalized_measure.parsed_duty.kind, "complex_or_conditional");
  assert.equal(result.normalized_measure.parsed_duty.candidate_rate_pct, null);
  assert.ok(result.unresolved_dependencies.includes("compound_or_conditional_duty_expression_resolution"));
});

test("additional code quota and reduction indicator each add explicit applicability dependencies", () => {
  const row = simpleRow();
  row[1] = "2500";
  row[2] = "09.9999";
  row[5] = "2";

  const result = normalizeTaricDutyRow({
    direction: "import",
    columns: row,
    extraction_reference_date: "2026-09-01",
    observed_at: "2026-09-27T17:00:00Z",
    source_sha256: HASH,
  });

  assert.ok(result.unresolved_dependencies.includes("additional_code_resolution"));
  assert.ok(result.unresolved_dependencies.includes("tariff_quota_status"));
  assert.ok(result.unresolved_dependencies.includes("agricultural_reduction_indicator_resolution"));
  assert.equal(result.landed_cost_component, null);
});

test("invalid source provenance fails closed", () => {
  const result = normalizeTaricDutyRow({
    direction: "import",
    columns: simpleRow(),
    extraction_reference_date: "2026-09-01",
    observed_at: "2026-09-27T17:00:00Z",
    source_sha256: "not-a-hash",
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("source_sha256_invalid"));
  assert.equal(result.normalized_measure, null);
});

test("row missing documented A-L fields fails closed", () => {
  const result = normalizeTaricDutyRow({
    direction: "import",
    columns: ["2403110000", "", ""],
    extraction_reference_date: "2026-09-01",
    observed_at: "2026-09-27T17:00:00Z",
    source_sha256: HASH,
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("taric_duty_row_requires_columns_a_to_l"));
});

test("date parser accepts documented day-month-year style without ambiguous Date parsing", () => {
  const result = normalizeTaricDutyRow({
    direction: "export",
    columns: simpleRow(),
    extraction_reference_date: "01/09/2026",
    observed_at: "2026-09-27T17:00:00Z",
    source_sha256: HASH,
  });

  assert.equal(result.valid, true);
  assert.equal(result.normalized_measure.validity_start_date, "2026-01-01");
  assert.equal(result.normalized_measure.extraction_reference_date, "2026-09-01");
});
