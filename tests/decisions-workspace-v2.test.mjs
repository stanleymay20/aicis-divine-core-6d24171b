import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navPath = new URL("../src/components/decisions/DecisionWorkspaceNav.tsx", import.meta.url);
const opsPath = new URL("../src/pages/DecisionOperations.tsx", import.meta.url);
const recordsPath = new URL("../src/pages/Decisions.tsx", import.meta.url);
const watchlistPath = new URL("../src/pages/Watchlist.tsx", import.meta.url);
const reviewPath = new URL("../src/components/decision-engine/DecisionReviewQueue.tsx", import.meta.url);
const watchPanelPath = new URL("../src/components/watchlist/WatchlistPanel.tsx", import.meta.url);

test("Decisions workspace unifies operations, records, and watchlist", async () => {
  const source = await readFile(navPath, "utf8");

  for (const label of ["Operations", "Records", "Watchlist"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectedEntity\?\.type === "decision"/);
});

test("All decisions surfaces render the shared workspace navigation", async () => {
  for (const path of [opsPath, recordsPath, watchlistPath]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /DecisionWorkspaceNav/);
    assert.match(source, /<DecisionWorkspaceNav \/>/);
  }
});

test("Human review rows open typed decision entities with stored review context", async () => {
  const source = await readFile(reviewPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /type: "decision"/);
  assert.match(source, /severityScore: item\.severity_score/);
  assert.match(source, /reviewStatus: "needs_review"/);
  assert.match(source, /reasoning: item\.reasoning_md/);
  assert.doesNotMatch(source, /as any/);
});

test("Watchlist inspection preserves underlying entity type and measured state", async () => {
  const source = await readFile(watchPanelPath, "utf8");

  assert.match(source, /item\.watch_type === "country"/);
  assert.match(source, /item\.watch_type === "region"/);
  assert.match(source, /: "risk"/);
  assert.match(source, /lastRiskValue: item\.last_risk_value/);
  assert.match(source, /currentStatus: item\.current_status/);
  assert.match(source, /alertEnabled: item\.alert_enabled/);
  assert.doesNotMatch(source, /icon: any/);
});
