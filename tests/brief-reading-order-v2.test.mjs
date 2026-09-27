import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const exposurePath = new URL("../src/components/morning-brief/BusinessExposureStrip.tsx", import.meta.url);
const askPath = new URL("../src/components/morning-brief/PersistentAskBar.tsx", import.meta.url);
const dashboardPath = new URL("../src/components/morning-brief/MorningBriefDashboard.tsx", import.meta.url);

test("Brief situation strip contains measured counts and no synthetic euro exposure", async () => {
  const source = await readFile(exposurePath, "utf8");

  assert.doesNotMatch(source, /totalExposure/);
  assert.doesNotMatch(source, /Cost exposure/);
  assert.doesNotMatch(source, /2_000_000|500_000|200_000/);
  assert.match(source, /totalHighSignals/);
  assert.match(source, /criticalSignals/);
  assert.match(source, /pendingDecisions/);
  assert.match(source, /highVulnerabilityCountries/);
});

test("Brief Ask uses the canonical intelligence engine and carries entity context", async () => {
  const source = await readFile(askPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectedEntity/);
  assert.match(source, /\/intelligence-engine\?/);
  assert.match(source, /params\.set\("entity"/);
  assert.doesNotMatch(source, /navigate\(`\/app\?q=/);
  assert.doesNotMatch(source, /\bas any\b/);
});

test("Brief reading order is what changed, why it matters, then what needs attention", async () => {
  const source = await readFile(dashboardPath, "utf8");

  const changed = source.indexOf("What changed");
  const matters = source.indexOf("Why it matters");
  const attention = source.indexOf("What needs attention");

  assert.ok(changed >= 0);
  assert.ok(matters > changed);
  assert.ok(attention > matters);
});

test("Brief UTC label is backed by an ISO UTC timestamp", async () => {
  const source = await readFile(dashboardPath, "utf8");

  assert.match(source, /toISOString\(\)/);
  assert.match(source, /UTC/);
  assert.doesNotMatch(source, /format\(new Date\(\).*UTC/);
});
