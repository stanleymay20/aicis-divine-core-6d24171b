import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navPath = new URL("../src/components/data-trust/DataTrustWorkspaceNav.tsx", import.meta.url);
const evidencePath = new URL("../src/pages/EvidenceCommand.tsx", import.meta.url);
const validationPath = new URL("../src/pages/SignalValidation.tsx", import.meta.url);
const truthPath = new URL("../src/pages/OperationalTruth.tsx", import.meta.url);
const coveragePath = new URL("../src/pages/CoverageEquity.tsx", import.meta.url);
const governancePath = new URL("../src/pages/GovernanceHub.tsx", import.meta.url);
const integrityPath = new URL("../src/pages/DataIntegrity.tsx", import.meta.url);
const evidenceOpsPath = new URL("../src/pages/DailyEvidenceOps.tsx", import.meta.url);

test("Data & Trust workspace consolidates evidence, validation, truth, coverage, governance, and integrity", async () => {
  const source = await readFile(navPath, "utf8");

  for (const label of ["Evidence", "Validation", "Truth", "Coverage", "Governance", "Integrity"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }

  assert.match(source, /aliases: \["\/daily-evidence-ops"\]/);
  assert.match(source, /aliases: \["\/pilot-truth"\]/);
  assert.match(source, /operatorOnly: true/);
  assert.match(source, /useIntelligenceOS/);
  assert.match(source, /persistedTrustSearch/);
});

test("Primary Data & Trust surfaces render the shared workspace navigation", async () => {
  for (const path of [
    evidencePath,
    validationPath,
    truthPath,
    coveragePath,
    governancePath,
    integrityPath,
    evidenceOpsPath,
  ]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /DataTrustWorkspaceNav/);
    assert.match(source, /<DataTrustWorkspaceNav \/>/);
  }
});

test("Operator-only Data Integrity now renders inside the AICIS application shell", async () => {
  const source = await readFile(integrityPath, "utf8");

  assert.match(source, /AICISLayout/);
  assert.match(source, /<AICISLayout>/);
  assert.match(source, /<DataTrustWorkspaceNav \/>/);
  assert.match(source, /overflow-y-auto h-full/);
});
