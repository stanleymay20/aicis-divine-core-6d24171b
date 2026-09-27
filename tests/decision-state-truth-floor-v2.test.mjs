import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../src/pages/DecisionOperations.tsx", import.meta.url);
const dailyPath = new URL("../src/components/decision-engine/DailyTaskPanel.tsx", import.meta.url);
const kpiPath = new URL("../src/components/decision-engine/DecisionOpsKPIStrip.tsx", import.meta.url);

test("Decision page does not make an unverified live-health claim", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /Operational views · refresh up to 30s/);
  assert.doesNotMatch(source, /Live · auto-refresh 30s/);
});

test("Daily decision counts throw query failures instead of converting them to zero", async () => {
  const source = await readFile(dailyPath, "utf8");

  assert.match(source, /todayRecs\.error\?\.message/);
  assert.match(source, /pendingExec\.error\?\.message/);
  assert.match(source, /missingOutcome\.error\?\.message/);
  assert.match(source, /overdueReviews\.error\?\.message/);
  assert.match(source, /Daily operation counts unavailable/);
  assert.match(source, /not represented as zero pending work/);
});

test("Decision KPI strip exposes query failure and removes unsupported derived claims", async () => {
  const source = await readFile(kpiPath, "utf8");

  assert.match(source, /Decision KPIs unavailable/);
  assert.match(source, /Successful-outcome net value \(30d\)/);
  assert.doesNotMatch(source, /Margin protected/);
  assert.doesNotMatch(source, /Execution rate/);
  assert.doesNotMatch(source, /:\s*any\b/);
});

test("Recommendation-generation toast does not assume a fixed seven-domain universe", async () => {
  const source = await readFile(dailyPath, "utf8");

  assert.doesNotMatch(source, /7 - \(data\?\.failed_domains/);
  assert.match(source, /failedDomains/);
});
