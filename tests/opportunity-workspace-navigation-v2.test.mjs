import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navPath = new URL("../src/components/opportunities/OpportunityWorkspaceNav.tsx", import.meta.url);
const pagePath = new URL("../src/pages/OpportunityRadar.tsx", import.meta.url);

test("Opportunity workspace exposes one coherent research sequence", async () => {
  const source = await readFile(navPath, "utf8");

  for (const label of [
    "Profile",
    "Hypotheses",
    "Research",
    "Verification",
    "Transaction",
    "Signals",
  ]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
});

test("Opportunity workspace section navigation scrolls within the existing page instead of adding routes", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /scrollIntoView/);
  assert.match(source, /IntersectionObserver/);
  assert.doesNotMatch(source, /useNavigate/);
});

test("Opportunity workspace preserves shared Intelligence Inspector and Ask context", async () => {
  const source = await readFile(navPath, "utf8");

  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /selectedEntity/);
  assert.match(source, /openAsk/);
  assert.match(source, /selectedEntity\?\.type === "opportunity"/);
});

test("Opportunity Radar provides stable anchors for the workspace sections", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /<OpportunityWorkspaceNav \/>/);
  assert.match(source, /id="opportunity-profile"/);
  assert.match(source, /id="opportunity-hypotheses"/);
  assert.match(source, /id="opportunity-verification"/);
  assert.match(source, /id="opportunity-research-queue"/);
  assert.match(source, /<TransactionPathLab \/>/);
});
