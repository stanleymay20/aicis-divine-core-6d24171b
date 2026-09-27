
import test from "node:test";
import assert from "node:assert/strict";
import { planOfficialCustomsSources } from "../supabase/functions/_shared/official-customs-source-plan-v1.mjs";

test("Germany import plan separates EU tariff evidence from German national tax evidence", () => {
  const result = planOfficialCustomsSources({
    origin_country: "GHA",
    destination_country: "DEU",
    hs_code: "180100",
  });

  assert.equal(result.valid_request, true);
  assert.equal(result.classification_ready, true);
  assert.ok(result.sources.some((source) => source.source_id === "eu_taric"));
  assert.ok(result.sources.some((source) => source.source_id === "de_ezt"));
  const taric = result.sources.find((source) => source.source_id === "eu_taric");
  assert.ok(taric.explicitly_not_covered.includes("national_vat"));
  assert.equal(taric.requested_categories.includes("import_tax"), false);
  const ezt = result.sources.find((source) => source.source_id === "de_ezt");
  assert.ok(ezt.requested_categories.includes("import_tax"));
  assert.equal(result.customs_rate, null);
  assert.equal(result.tax_rate, null);
  assert.equal(result.transaction_eligible, false);
});

test("non-German EU import requires a national tax source instead of pretending TARIC supplies VAT", () => {
  const result = planOfficialCustomsSources({
    origin_country: "GHA",
    destination_country: "FRA",
    hs_code: "180100",
  });

  assert.ok(result.sources.some((source) => source.source_id === "eu_taric"));
  assert.ok(result.blockers.some((blocker) =>
    blocker.kind === "national_import_tax_source_required" &&
    blocker.jurisdiction === "FRA"
  ));
  assert.equal(result.sources.some((source) =>
    source.source_id === "eu_taric" && source.requested_categories.includes("import_tax")
  ), false);
});

test("missing HS classification remains a blocking evidence task", () => {
  const result = planOfficialCustomsSources({
    origin_country: "GHA",
    destination_country: "DEU",
    hs_code: "",
  });

  assert.equal(result.classification_ready, false);
  assert.ok(result.blockers.some((blocker) => blocker.kind === "verify_tariff_classification"));
  assert.equal(result.execution_boundary.tariff_treatment_claimed, false);
});

test("unsupported non-EU destination fails closed to an official national source requirement", () => {
  const result = planOfficialCustomsSources({
    origin_country: "GHA",
    destination_country: "USA",
    hs_code: "180100",
  });

  assert.equal(result.sources.length, 0);
  assert.ok(result.blockers.some((blocker) => blocker.kind === "national_customs_source_required"));
  assert.equal(result.automated_rate_extraction_performed, false);
});

test("EU-origin export can route export-measure research to TARIC without calculating a duty", () => {
  const result = planOfficialCustomsSources({
    origin_country: "DEU",
    destination_country: "GHA",
    hs_code: "850760",
  });

  const taric = result.sources.find((source) => source.source_id === "eu_taric");
  assert.ok(taric);
  assert.ok(taric.requested_categories.includes("export_customs"));
  assert.equal(result.customs_rate, null);
  assert.equal(result.legal_determination_made, false);
});
