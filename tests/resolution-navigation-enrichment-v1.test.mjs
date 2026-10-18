import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countryDeepDivePath, resolutionCountryPath, resolutionRegionPath } from "../src/lib/country-navigation-v1.mjs";
import { enrichmentChunks, verifyEnrichmentClassifications } from "../supabase/functions/_shared/enrichment-batch-contract-v1.mjs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("country and region routes are deterministic and reject unknown country identity", () => {
  assert.equal(countryDeepDivePath("deu"), "/deepdive/DEU");
  assert.equal(resolutionCountryPath("GHA"), "/resolution?country=GHA");
  assert.equal(resolutionRegionPath("deu", "North Rhine-Westphalia"), "/resolution?country=DEU&regionName=North%20Rhine-Westphalia");
  assert.equal(countryDeepDivePath("unknown"), null);
  assert.equal(resolutionCountryPath(null), null);
  assert.equal(resolutionRegionPath("DEU", ""), null);
  assert.equal(resolutionRegionPath("DEU", "X".repeat(121)), null);
});

test("route component exists and country/region URLs are wired into protected navigation", () => {
  const app = source("../src/App.tsx");
  const resolution = source("../src/pages/ResolutionExplorer.tsx");
  const badges = source("../src/components/navigation/CountryRegionLinksV1.tsx");
  const world = source("../src/pages/WorldWorkspace.tsx");
  const brief = source("../src/components/morning-brief/MorningBriefDashboard.tsx");
  const situations = source("../src/pages/Situations.tsx");
  assert.match(app, /path="\/deepdive\/:iso3" element=\{<Protected>/);
  assert.match(app, /path="\/resolution" element=\{<Protected>/);
  assert.match(resolution, /\.eq\("country_iso3", countryIso3\)/);
  assert.match(resolution, /\.limit\(2\)/);
  assert.match(resolution, /data\?\.length === 1/);
  assert.match(badges, /codes.length === 1/);
  assert.match(badges, /resolutionRegionPath\(parentCountry, name\)/);
  assert.match(world, /Resolution Explorer/);
  assert.match(brief, /<CountryRegionLinksV1/);
  assert.match(situations, /<CountryRegionLinksV1/);
});

test("global and country resolution prefer newest available snapshots, not today-only filters", () => {
  const global = source("../src/components/resolution/GlobalOverview.tsx");
  const country = source("../src/components/resolution/CountryDrilldown.tsx");
  for (const view of [global, country]) {
    assert.match(view, /\.order\("snapshot_date", \{ ascending: false \}\)/);
    assert.match(view, /\.eq\("snapshot_date", snapshotDate\)/);
    assert.doesNotMatch(view, /\.eq\("snapshot_date", today\)/);
    assert.match(view, /if \(.*error\) throw/);
  }
  assert.match(global, /topCountries\.rows\.map/);
  assert.match(global, /Snapshot:/);
  assert.match(country, /avgRisk == null \? "Unknown"/);
});

test("bounded enrichment chunking preserves original order and never overlaps batches", () => {
  const chunks = enrichmentChunks(Array.from({ length: 12 }, (_, id) => ({ id })), 4);
  assert.deepEqual(chunks.map((x) => x.offset), [0, 4, 8]);
  assert.deepEqual(chunks.flatMap((x) => x.signals.map((s) => s.id)), Array.from({ length: 12 }, (_, i) => i));
  assert.deepEqual(enrichmentChunks([], 4), []);
  assert.throws(() => enrichmentChunks([1], 0));
  assert.throws(() => enrichmentChunks([1], 30));
});

test("AI chunk results must cover exact local indices, no holes or duplicates", () => {
  assert.equal(verifyEnrichmentClassifications([{ index: 1 }, { index: 0 }], 2).length, 2);
  assert.throws(() => verifyEnrichmentClassifications([{ index: 0 }, { index: 0 }], 2));
  assert.throws(() => verifyEnrichmentClassifications([{ index: 2 }, { index: 0 }], 2));
  assert.throws(() => verifyEnrichmentClassifications([{ index: "0" }], 1));
  assert.throws(() => verifyEnrichmentClassifications([], 1));
});

test("concurrent claims are compare-and-set guarded and failures release only claimed rows", () => {
  const edge = source("../supabase/functions/enrich-global-signals/index.ts");
  assert.match(edge, /MAX_BATCH = 12/);
  assert.match(edge, /CHUNK_SIZE = 4/);
  assert.match(edge, /MAX_PARALLEL_CHUNKS = 2/);
  assert.match(edge, /\.eq\("enrichment_attempts", signal\.enrichment_attempts\)/);
  assert.match(edge, /\.eq\("enrichment_status", "pending_enrichment"\)/);
  assert.match(edge, /else if \(won\?\.length === 1\) claimed\.push\(signal\)/);
  assert.match(edge, /await failClaimed\(result\.chunk\.signals, reason\)/);
  assert.match(edge, /if \(classificationFailures\.has\(i\)\) continue/);
  assert.match(edge, /verifyEnrichmentClassifications/);
  assert.match(edge, /requireAdminOrTrustedWorker/);
});
