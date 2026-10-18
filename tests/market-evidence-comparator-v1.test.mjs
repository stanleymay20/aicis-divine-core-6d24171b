import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMarketEvidenceComparison as compare } from "../src/lib/market-evidence-comparator-v1.mjs";

const metric = (iso3, extra = {}) => ({
  iso3, metric_name: "GDP growth", period: "2024", unit: "%", provider_name: "World Bank",
  value: 0, provenance_source: "WDI", last_verified_at: null, ...extra,
});

test("same metric, period, unit, provider compare without inventing a score", () => {
  const out = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("DEU", { value: 0 })], rowsB: [metric("POL", { value: 3.1 })] });
  assert.equal(out.indicators[0].state, "comparable");
  assert.equal(out.indicators[0].countryA.value, 0);
  assert.equal(out.indicators[0].countryB.value, 3.1);
  assert.equal(out.indicators[0].countryA.provider, "World Bank");
  assert.equal(out.hasMarketPotentialScore, false);
  assert.equal(out.hasForecast, false);
});

test("different provider or year must never compare", () => {
  for (const row of [metric("POL", { period: "2023" }), metric("POL", { provider_name: "OECD" }), metric("POL", { unit: "USD" })]) {
    const out = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("DEU")], rowsB: [row] });
    assert.equal(out.indicators[0].state, "not_aligned");
    assert.equal(out.indicators[0].countryA, null);
    assert.equal(out.indicators[0].countryB, null);
  }
});

test("missing rows, nonfinite values, and missing provenance identity remain unavailable", () => {
  const absent = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("DEU")], rowsB: [] });
  assert.equal(absent.indicators[0].state, "missing_country");
  const invalid = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("DEU")], rowsB: [metric("POL", { value: Number.NaN })] });
  assert.equal(invalid.indicators[0].state, "invalid_evidence");
  const noProvider = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("DEU")], rowsB: [metric("POL", { provider_name: "" })] });
  assert.equal(noProvider.indicators[0].state, "invalid_evidence");
  const noUnit = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("DEU")], rowsB: [metric("POL", { unit: null })] });
  assert.equal(noUnit.indicators[0].state, "invalid_evidence");
  const unknownProvider = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("DEU")], rowsB: [metric("POL", { provider_name: "unknown" })] });
  assert.equal(unknownProvider.indicators[0].state, "invalid_evidence");
});

test("multiple matching source records remain ambiguous rather than being silently chosen", () => {
  const out = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("DEU"), metric("DEU", { value: 99 })], rowsB: [metric("POL")] });
  assert.equal(out.indicators[0].state, "ambiguous");
  assert.equal(out.indicators[0].countryA, null);
});

test("most recent comparable pair may be older than the latest non-aligned row", () => {
  const out = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("DEU", { period: "2025" }), metric("DEU", { period: "2024" })], rowsB: [metric("POL", { period: "2024" })] });
  assert.equal(out.indicators[0].state, "comparable");
  assert.equal(out.indicators[0].countryA.period, "2024");
});

test("out-of-country records cannot leak into the comparison; invalid country IDs fail closed", () => {
  const out = compare({ countryA: "DEU", countryB: "POL", rowsA: [metric("POL")], rowsB: [metric("DEU")] });
  assert.equal(out.availableIndicatorGroups, 0);
  assert.throws(() => compare({ countryA: "DE", countryB: "POL" }), /distinct ISO3/);
  assert.throws(() => compare({ countryA: "DEU", countryB: "DEU" }), /distinct ISO3/);
});

test("deterministic and explicitly bounded display is not a market-potential ranking", () => {
  const rowsA = ["Population", "Exports", "Inflation"].map((metric_name, i) => metric("DEU", { metric_name, value: i }));
  const rowsB = ["Inflation", "Population", "Exports"].map((metric_name, i) => metric("POL", { metric_name, value: i }));
  const one = compare({ countryA: "DEU", countryB: "POL", rowsA, rowsB, maxIndicators: 2 });
  const two = compare({ countryA: "DEU", countryB: "POL", rowsA: [...rowsA].reverse(), rowsB: [...rowsB].reverse(), maxIndicators: 2 });
  assert.deepEqual(one, two);
  assert.equal(one.availableIndicatorGroups, 3);
  assert.equal(one.displayedIndicatorGroups, 2);
});

test("Market evidence stays a read-only sample in existing protected Risk Atlas", () => {
  const hook = readFileSync(new URL("../src/hooks/useMarketEvidenceComparisonV1.ts", import.meta.url), "utf8");
  const atlas = readFileSync(new URL("../src/components/risk-atlas/AtlasInsightPanel.tsx", import.meta.url), "utf8");
  const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  assert.match(hook, /\.from\("normalized_metrics"\)/);
  assert.match(hook, /\.eq\("iso3", country\)/);
  assert.match(hook, /SAMPLE_LIMIT_PER_COUNTRY = 250/);
  assert.doesNotMatch(hook, /\.(?:insert|update|upsert|delete)\(/);
  assert.match(atlas, /<MarketEvidenceComparisonV1/);
  assert.match(agents, /GLOBALEDGE_MARKET_EVIDENCE_BENCHMARK_V1\.md/);
});
