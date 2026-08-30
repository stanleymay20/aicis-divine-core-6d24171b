import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260830220000_security_truth_floor_v1.sql",
  import.meta.url,
);
const authPath = new URL("../supabase/functions/_shared/auth.ts", import.meta.url);
const ciPath = new URL("../.github/workflows/ci.yml", import.meta.url);

test("security readiness is evidence-derived and fails closed", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(source, /aicis_security_control_catalog/);
  assert.match(source, /aicis_security_control_evidence/);
  assert.match(source, /aicis_security_control_effective_state_v1/);
  assert.match(source, /aicis_security_production_readiness_v1/);
  assert.match(source, /ELSE 'unverified'/);
  assert.match(source, /effective_status IN \('behaviorally_verified','runtime_verified'\)/);
  assert.match(source, /production_security_ready/);
  assert.match(source, /No PASS evidence is seeded/i);
  assert.doesNotMatch(source, /INSERT INTO public\.aicis_security_control_evidence[\s\S]*'pass'/i);
});

test("security evidence is append-only and human declarations cannot establish readiness", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(source, /aicis_security_evidence_immutable_v1/);
  assert.match(source, /BEFORE UPDATE OR DELETE ON public\.aicis_security_control_evidence/);
  assert.match(source, /append-only/i);
  assert.match(source, /Human assessment is useful context, but never the authority for readiness/i);
  assert.doesNotMatch(source, /aicis_security_control_assessments[\s\S]*aicis_security_production_readiness_v1/);
});

test("P0 catalog covers identity, least privilege, audit, incident, recovery, scanning, boundaries and monitoring", async () => {
  const source = await readFile(migrationPath, "utf8");

  for (const control of ["AC-5", "AC-6", "IA-2", "AU-9", "IR-4", "CP-9", "RA-5", "SC-7", "SI-4"]) {
    assert.match(source, new RegExp(`'${control}'`));
  }
});

test("shared auth does not trust user-editable metadata for admin authority", async () => {
  const source = await readFile(authPath, "utf8");

  assert.match(source, /user_metadata.*intentionally[\s\S]*excluded/i);
  assert.match(source, /app_metadata\?\.role === "admin"/);
  assert.match(source, /userHasDatabaseRole\(data\.user\.id, "admin"\)/);
  assert.doesNotMatch(source, /user_metadata\?\.role === "admin"/);
});

test("current CI has explicit privileged-auth and secret inventory gates", async () => {
  const source = await readFile(ciPath, "utf8");

  assert.match(source, /Privileged Edge Function auth/);
  assert.match(source, /Secret-name inventory/);
  assert.match(source, /audit-edge-function-auth\.py/);
  assert.match(source, /aicis-secret-inventory\.py/);
});
