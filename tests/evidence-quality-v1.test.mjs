import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  scoreSignalForDomain,
  selectDomainEvidence,
  selectInternalSnapshots,
  questionTerms,
  aggregateEvidenceQuality,
  normalizeTitle,
} from "../supabase/functions/_shared/evidence-quality-v1.mjs";
import { signalCitationSource } from "../supabase/functions/_shared/ask-scope-v1.mjs";

// Fixtures copied from live Ghana global_signals rows (title/summary/category).
const EHR = {
  id: "ehr", category: "cybersecurity", geo_admin0_iso3: "GHA",
  title: "OneHealthEHR Goes Live in Liberia , Ghana",
  summary: "OneHealthEHR Goes Live in Liberia , Ghana",
  source_references: [{ name: "liberianobserver.com", url: "https://www.liberianobserver.com/onehealthehr" }],
};
const DRUGS = {
  id: "ndlea", category: "technology", geo_admin0_iso3: "GHA",
  title: "NDLEA intercepts N6.2bn drugs hidden in Ghana soap, opioids at Lagos airport",
  summary: "The National Drug Law Enforcement Agency has intercepted consignments of captagon, popularly known as the “Jihadi drug,” and millions of opioid tablets.",
};
const CLASH = {
  id: "clash", category: "defense_conflict", geo_admin0_iso3: "GHA",
  title: "Armed clash in Bawku leaves several killed as troops deploy",
  summary: "Violence between rival groups prompted a military deployment and curfew.",
  source_references: [{ name: "GhanaWeb", url: "https://www.ghanaweb.com/bawku-clash" }],
};
const GAS = {
  id: "gas", category: "geopolitical", geo_admin0_iso3: "GHA",
  title: "West Africa: Ghana Plans 1,200 Mw Gas Plant As Power Sector Costs Mount",
  summary: "Ghana is moving ahead with a 1,200-megawatt gas-fired power plant as the government seeks to improve electricity supply and reduce costs that continue to weigh on public finances.",
};
const FOOD = {
  id: "food", category: "food_agriculture", geo_admin0_iso3: "GHA",
  title: "Ghana food production index 2022: 135.5 (+3.8% vs 2021)", summary: "",
};
const FOOD_DUP = { ...FOOD, id: "food2", title: "Ghana food production index 2022: 135.5 (+10.7% YoY)" };
const ELECTION = {
  id: "elec", category: "elections", geo_admin0_iso3: "GHA",
  title: "Parliament approves electoral reform bill ahead of vote",
  summary: "The government and opposition debated the new law on election financing.",
};
const CEDI = {
  id: "cedi", category: "economic", geo_admin0_iso3: "GHA",
  title: "Cedi slides as inflation climbs and IMF reviews debt programme", summary: "",
};

const q = questionTerms("What can AICIS conclude about Ghana?", ["Ghana"]);
const admit = (domain, s) => scoreSignalForDomain({ domain, signal: s, qTerms: q, iso3List: ["GHA"] }).admitted;

const snap = (date, idx, mom = 0, vol = 0) => ({ id: date, iso3: "GHA", performance_index: idx, momentum_score: mom, volatility_index: vol, snapshot_date: date });
const FLAT = [snap("2026-09-28", 60), snap("2026-09-27", 60), snap("2026-08-31", 60), snap("2026-08-30", 60)];

test("question terms drop stopwords and resolved place names", () => {
  assert.deepEqual(q, []);
  assert.deepEqual(questionTerms("Are power outages hurting Ghana's economy?", ["Ghana"]), ["power", "outages", "hurting", "economy"]);
});

test("OneHealthEHR health-records story is rejected from security despite cybersecurity category", () => {
  const r = scoreSignalForDomain({ domain: "security", signal: EHR, qTerms: q, iso3List: ["GHA"] });
  assert.equal(r.admitted, false);
  assert.equal(r.reason, "off_topic");
  assert.equal(r.domain_score, 0);
});

test("genuine Ghana conflict story is retained for security", () => {
  assert.equal(admit("security", CLASH), true);
});

test("miscategorised drug-trafficking story is admitted to security on its text", () => {
  assert.equal(admit("security", DRUGS), true);
  assert.equal(admit("health", DRUGS), false);
});

test("finance, governance, energy and food examples route correctly", () => {
  assert.equal(admit("energy", GAS), true);
  assert.equal(admit("finance", GAS), true);
  assert.equal(admit("security", GAS), false);
  assert.equal(admit("governance", ELECTION), true);
  assert.equal(admit("finance", ELECTION), false);
  assert.equal(admit("finance", CEDI), true);
  assert.equal(admit("security", CEDI), false);
  assert.equal(admit("food", FOOD), true);
  assert.equal(admit("energy", FOOD), false);
});

test("geography mismatch is rejected", () => {
  const r = scoreSignalForDomain({ domain: "security", signal: { ...CLASH, geo_admin0_iso3: "NGA" }, qTerms: q, iso3List: ["GHA"] });
  assert.equal(r.admitted, false);
  assert.equal(r.reason, "geography_mismatch");
});

test("repeated unchanged internal snapshots collapse and are capped", () => {
  const thin = selectInternalSnapshots(FLAT, 0);
  assert.equal(thin.kept.length, 1);
  assert.equal(thin.collapsed_unchanged, 3);
  assert.equal(thin.kept[0]._unchanged_since, "2026-08-30");

  const moving = [snap("d4", 60), snap("d3", 59), snap("d2", 58), snap("d1", 57), snap("d0", 56)];
  assert.equal(selectInternalSnapshots(moving, 0).kept.length, 2);
  assert.equal(selectInternalSnapshots(moving, 1).kept.length, 1);
});

test("external evidence is prioritised and is at least 50% when it exists", () => {
  const moving = [snap("d4", 60), snap("d3", 59), snap("d2", 58), snap("d1", 57)];
  const sel = selectDomainEvidence({
    domain: "security", signals: [EHR, DRUGS, CLASH, GAS], snapshots: moving,
    qTerms: q, iso3List: ["GHA"], citationSource: signalCitationSource,
  });
  const ids = sel.external.map((e) => e.signal.id);
  assert.deepEqual(ids.sort(), ["clash", "ndlea"]);
  assert.ok(!ids.includes("ehr"));
  assert.ok(sel.meta.external_evidence_count >= sel.meta.internal_measurement_count);
  assert.equal(sel.meta.rejected_irrelevant_count, 1); // EHR claimed security by category
  assert.equal(sel.meta.evidence_sufficiency, "moderate");
  // Real article URL preserved; nothing inferred for rows without one.
  assert.equal(sel.external.find((e) => e.signal.id === "clash").cite.url, "https://www.ghanaweb.com/bawku-clash");
  assert.equal(sel.external.find((e) => e.signal.id === "ndlea").cite.url, null);
});

test("duplicate stories collapse at retrieval", () => {
  assert.equal(normalizeTitle(FOOD.title), normalizeTitle(FOOD_DUP.title));
  const sel = selectDomainEvidence({ domain: "food", signals: [FOOD, FOOD_DUP, FOOD], snapshots: [], qTerms: q, iso3List: ["GHA"], citationSource: signalCitationSource });
  assert.equal(sel.external.length, 1);
  assert.equal(sel.meta.deduplicated_count, 2);
});

test("thin external evidence is reported as thin, never padded or fabricated", () => {
  const sel = selectDomainEvidence({ domain: "security", signals: [EHR], snapshots: FLAT, qTerms: q, iso3List: ["GHA"], citationSource: signalCitationSource });
  assert.equal(sel.external.length, 0);
  assert.equal(sel.internal.length, 1);
  assert.equal(sel.meta.evidence_sufficiency, "thin");
  const agg = aggregateEvidenceQuality({ security: sel.meta });
  assert.equal(agg.mostly_internal, true);
  assert.equal(agg.overall_sufficiency, "thin");
});

test("orchestrator uses evidence-quality-v1 and returns evidence_quality", async () => {
  const src = await readFile("supabase/functions/orchestrate-multi-agent/index.ts", "utf8");
  assert.match(src, /from "\.\.\/_shared\/evidence-quality-v1\.mjs"/);
  assert.match(src, /selectDomainEvidence\(/);
  assert.match(src, /evidence_quality: evidenceQuality/);
  assert.match(src, /source_url: null,\s*\n\s*publisher: "AICIS internal measurement/);
  assert.doesNotMatch(src, /\.in\("category", DOMAIN_CATEGORIES\[domain\]\)/);
});

test("Ask panel shows the evidence mix", async () => {
  const src = await readFile("src/components/analysis/GovernedResearchPanel.tsx", "utf8");
  assert.match(src, /data-testid="evidence-quality"/);
  assert.match(src, /relies mostly on internal AICIS measurements/);
  assert.match(src, /no document link stored/);
});
