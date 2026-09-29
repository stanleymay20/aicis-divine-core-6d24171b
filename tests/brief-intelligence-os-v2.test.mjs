import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const hookPath = new URL("../src/components/morning-brief/usePrioritySignals.ts", import.meta.url);
const dashboardPath = new URL("../src/components/morning-brief/MorningBriefDashboard.tsx", import.meta.url);

test("Brief priority signals use stored metrics instead of frontend-invented financial values", async () => {
  const source = await readFile(hookPath, "utf8");

  assert.doesNotMatch(source, /estimateImpactValue/);
  assert.doesNotMatch(source, /estimateROI/);
  assert.doesNotMatch(source, /derivePrecedent/);
  assert.doesNotMatch(source, /Loss avoided/);
  assert.match(source, /impact_score/);
  assert.match(source, /urgency_score/);
  assert.match(source, /confidence_score/);
  assert.match(source, /source_count/);
});

test("Brief priority signals prefer the recent window before falling back to older records", async () => {
  const source = await readFile(hookPath, "utf8");

  assert.match(source, /RECENT_WINDOW_DAYS/);
  assert.match(source, /first_detected_at", windowStart|gte\("first_detected_at", windowStart\)/);
  assert.match(source, /stale: true/);
  assert.match(source, /stale: false/);
});

test("Brief featured signal exposes evidence context and shared inspector selection", async () => {
  const source = await readFile(dashboardPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectEntity/);
  assert.match(source, /type: "signal"/);
  assert.match(source, /source_trust_tier/);
  assert.match(source, /primary_source/);
  assert.match(source, /Inspect signal/);
});

test("Brief does not mark a proposed action as executed from the briefing surface", async () => {
  const source = await readFile(dashboardPath, "utf8");

  assert.doesNotMatch(source, /action_taken:\s*true/);
  assert.doesNotMatch(source, /Execute This Action/);
  assert.match(source, /not recorded as executed\s*from the brief|not recorded as executed/);
  assert.match(source, /Open in Decisions/);
});

test("Morning Brief uses the magazine hero structure with an honest staleness warning", async () => {
  const source = await readFile(dashboardPath, "utf8");

  assert.match(source, /Top Priority/);
  assert.match(source, /Why it matters/);
  assert.match(source, /No high-impact signals in the last 14 days/);
  assert.match(source, /formatSignalAge/);
});
