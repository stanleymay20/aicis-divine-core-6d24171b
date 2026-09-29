import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  resolveGeography,
  routeDomains,
  signalCitationSource,
  REGION_ISO3,
} from "../supabase/functions/_shared/ask-scope-v1.mjs";

// Fixture mirrors live country_profiles naming, including word-like ISO3 codes.
const COUNTRIES = [
  ["GHA", "Ghana"], ["DEU", "Germany"], ["KEN", "Kenya"], ["AND", "Andorra"],
  ["ARE", "United Arab Emirates"], ["CAN", "Canada"], ["NER", "Niger"], ["NGA", "Nigeria"],
  ["ETH", "Ethiopia"], ["FRA", "France"], ["USA", "United States"],
].map(([iso3, country_name]) => ({ iso3, country_name }));

const geo = (q, ctx) => resolveGeography(q, COUNTRIES, ctx);

test("Ghana -> GHA only", () => {
  const r = geo("What is happening in Ghana?");
  assert.equal(r.status, "resolved");
  assert.deepEqual(r.iso3, ["GHA"]);
});

test("Germany -> DEU only", () => {
  assert.deepEqual(geo("Energy outlook for Germany").iso3, ["DEU"]);
});

test("East Africa expands to region ISO3 set with no AND", () => {
  const r = geo("Food and climate risk in East Africa and beyond");
  assert.equal(r.scope, "region");
  assert.deepEqual(r.iso3, [...REGION_ISO3["east africa"]].sort());
  assert.ok(!r.iso3.includes("AND"));
});

test("Ghana vs Kenya -> GHA + KEN, no AND", () => {
  const r = geo("Compare Ghana vs Kenya and their debt");
  assert.deepEqual(r.iso3, ["GHA", "KEN"]);
  assert.equal(r.scope, "multi_country");
});

test("'What can AICIS conclude about Ghana?' -> GHA, no CAN", () => {
  assert.deepEqual(geo("What can AICIS conclude about Ghana?").iso3, ["GHA"]);
});

test("'Where are energy risks?' does not resolve ARE and asks for clarification", () => {
  const r = geo("Where are energy risks?");
  assert.equal(r.status, "clarification_needed");
  assert.deepEqual(r.iso3, []);
});

test("Shouted English words are never ISO3 codes", () => {
  const r = geo("WHERE ARE THE RISKS AND CAN WE ACT");
  assert.equal(r.status, "clarification_needed");
});

test("global -> explicit global scope", () => {
  const r = geo("What are the top global supply chain risks?");
  assert.equal(r.status, "resolved");
  assert.equal(r.scope, "global");
  assert.deepEqual(r.iso3, []);
});

test("Berlin -> clarification-needed, never an unrelated country", () => {
  const r = geo("Is Berlin facing energy shortages?");
  assert.equal(r.status, "clarification_needed");
  assert.equal(r.reason, "city_without_verified_mapping");
  assert.deepEqual(r.iso3, []);
});

test("Niger does not match inside Nigeria", () => {
  assert.deepEqual(geo("Security in Nigeria").iso3, ["NGA"]);
});

test("Explicit uppercase ISO3 token is accepted; EU, Sahel, West Africa, East Asia expand", () => {
  assert.deepEqual(geo("Latest on KEN inflation").iso3, ["KEN"]);
  assert.equal(geo("EU energy policy").regions[0].key, "european union");
  assert.equal(geo("European Union sanctions").regions[0].key, "european union");
  assert.equal(geo("Conflict in the Sahel").regions[0].key, "sahel");
  assert.ok(geo("West Africa cocoa").iso3.includes("GHA"));
  assert.ok(geo("East Asia semiconductors").iso3.includes("CHN"));
});

test("Selected country context is used only when the question names no place", () => {
  assert.deepEqual(geo("What changed this week?", { iso3: "KEN" }).iso3, ["KEN"]);
  assert.deepEqual(geo("What changed in Ghana?", { iso3: "KEN" }).iso3, ["GHA"]);
});

test("Domain routing returns >=2 supported domains", () => {
  const e = routeDomains("Where are energy risks?");
  assert.ok(e.domains.includes("energy"));
  assert.ok(e.domains.length >= 2);
  const d = routeDomains("What can AICIS conclude about Ghana?");
  assert.deepEqual(d.domains, ["security", "governance", "finance"]);
  assert.equal(d.routing, "default_cross_domain");
  const f = routeDomains("drought and food prices and inflation");
  assert.ok(f.domains.includes("food") && f.domains.includes("climate") && f.domains.includes("finance"));
});

test("source_url prefers source_references URL over publisher name", () => {
  const r = signalCitationSource({
    primary_source: "ReliefWeb (UN OCHA)",
    source_references: [{ name: "ReliefWeb (UN OCHA)", url: "https://reliefweb.int/node/4231500" }],
  });
  assert.equal(r.url, "https://reliefweb.int/node/4231500");
  assert.equal(r.publisher, "ReliefWeb (UN OCHA)");
});

test("Publisher name is never returned as a URL and no URL is fabricated", () => {
  const r = signalCitationSource({ primary_source: "GDELT", source_references: [] });
  assert.equal(r.url, null);
  assert.equal(r.publisher, "GDELT");
  const bad = signalCitationSource({ primary_source: "x", source_references: [{ url: "javascript:alert(1)" }] });
  assert.equal(bad.url, null);
});

test("orchestrate-multi-agent resolves scope itself, fails closed, and returns citations", async () => {
  const src = await readFile(new URL("../supabase/functions/orchestrate-multi-agent/index.ts", import.meta.url), "utf8");
  assert.match(src, /resolveGeography\(/);
  assert.match(src, /routeDomains\(/);
  assert.match(src, /citationSource: signalCitationSource/);
  assert.doesNotMatch(src, /source_url: s\.primary_source/);
  assert.match(src, /\.in\("geo_admin0_iso3", iso3List\)/);
  assert.match(src, /code: "model_not_configured"/);
  assert.match(src, /status: "clarification_needed"/);
  assert.match(src, /executive_summary: str\(syn\.executive_summary\)/);
  assert.match(src, /citations,/);
  assert.match(src, /requireAdminOrTrustedWorker/);
});
