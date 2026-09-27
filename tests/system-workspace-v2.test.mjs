import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const navPath = new URL("../src/components/system/SystemWorkspaceNav.tsx", import.meta.url);
const pulsePath = new URL("../src/pages/SystemPulse.tsx", import.meta.url);
const statusPath = new URL("../src/pages/SystemStatus.tsx", import.meta.url);
const catalogPath = new URL("../src/pages/SystemCatalog.tsx", import.meta.url);
const infraPath = new URL("../src/pages/InfraOps.tsx", import.meta.url);
const pipelinePath = new URL("../src/pages/DataPipeline.tsx", import.meta.url);
const developerPath = new URL("../src/pages/DeveloperPortal.tsx", import.meta.url);
const exportPath = new URL("../src/pages/ExportCenter.tsx", import.meta.url);
const registerPath = new URL("../src/pages/RegisterNode.tsx", import.meta.url);
const federationPath = new URL("../src/pages/FederationAdmin.tsx", import.meta.url);
const adminPath = new URL("../src/pages/AdminDashboard.tsx", import.meta.url);

test("System workspace consolidates seventeen routes behind six visible modes", async () => {
  const source = await readFile(navPath, "utf8");

  for (const label of ["Status", "Operations", "Developers", "Exports", "Federation", "Admin"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }

  assert.match(source, /aliases: \["\/system-status", "\/system-catalog"\]/);
  assert.match(source, /aliases: \["\/data-pipeline"\]/);
  assert.match(source, /operatorOnly: true/);
  assert.match(source, /adminOnly: true/);
  assert.match(source, /persistedSystemSearch/);
});

test("Core System surfaces render the shared workspace navigation", async () => {
  for (const path of [
    pulsePath,
    statusPath,
    catalogPath,
    infraPath,
    pipelinePath,
    developerPath,
    exportPath,
    registerPath,
    federationPath,
    adminPath,
  ]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /SystemWorkspaceNav/);
    assert.match(source, /<SystemWorkspaceNav \/>/);
  }
});

test("Standalone admin federation surface now enters the AICIS shell", async () => {
  const source = await readFile(federationPath, "utf8");

  assert.match(source, /AICISLayout/);
  assert.match(source, /<AICISLayout>/);
  assert.match(source, /<SystemWorkspaceNav \/>/);
  assert.doesNotMatch(source, /\bany\b/);
});

test("Touched System surfaces do not reintroduce explicit any debt", async () => {
  for (const path of [
    pulsePath,
    statusPath,
    catalogPath,
    infraPath,
    pipelinePath,
    developerPath,
    registerPath,
    federationPath,
    adminPath,
  ]) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /:\s*any\b|as\s+any\b|<any>/);
  }
});
