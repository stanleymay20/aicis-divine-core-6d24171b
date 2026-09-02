import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertScientificForecastLedgerSchema,
  auditScientificForecastLedgerSchema,
} from "../scripts/audit-scientific-forecast-ledger-schema-v1.mjs";
import {
  evaluateScientificForecastEvidenceChronology,
  scientificIssuanceTime,
} from "../scripts/scientific-forecast-evidence-semantics-v1.mjs";

const CANDIDATE_PATH = new URL(
  "../scripts/sql/forecast-task-registry-ledgers-v1.candidate.sql",
  import.meta.url,
);

async function candidateSql() {
  return readFile(CANDIDATE_PATH, "utf8");
}

test("controlled forecast registry/ledger schema candidate passes the static truth floor", async () => {
  const sql = await candidateSql();
  assert.deepEqual(auditScientificForecastLedgerSchema(sql), { ok: true, reasons: [] });
  assert.equal(assertScientificForecastLedgerSchema(sql), true);
});

test("candidate remains outside supabase/migrations until generated through the required workflow", () => {
  assert.equal(CANDIDATE_PATH.pathname.includes("/scripts/sql/"), true);
  assert.equal(CANDIDATE_PATH.pathname.includes("/supabase/migrations/"), false);
});

test("prospective scientific issuance time is the database seal, never caller historical origin", () => {
  const record = {
    evidence_class: "prospective_shadow",
    forecast_origin: "2026-08-01T00:00:00.000Z",
    sealed_at: "2026-09-02T04:20:00.000Z",
    knowledge_cutoff: "2026-08-01T00:00:00.000Z",
    target_window_start: "2026-09-02T05:00:00.000Z",
    target_window_end: "2026-10-02T05:00:00.000Z",
  };

  assert.equal(scientificIssuanceTime(record), record.sealed_at);
  assert.deepEqual(evaluateScientificForecastEvidenceChronology(record), { valid: true, reasons: [] });
});

test("retrospective scientific issuance time remains the historical forecast origin", () => {
  const record = {
    evidence_class: "retrospective_backtest",
    forecast_origin: "2025-01-01T00:00:00.000Z",
    sealed_at: "2026-09-02T04:20:00.000Z",
    knowledge_cutoff: "2024-12-31T23:59:59.000Z",
    target_window_start: "2025-01-01T00:00:00.000Z",
    target_window_end: "2025-01-31T00:00:00.000Z",
  };

  assert.equal(scientificIssuanceTime(record), record.forecast_origin);
  assert.deepEqual(evaluateScientificForecastEvidenceChronology(record), { valid: true, reasons: [] });
});

test("prospective evidence fails closed without a database seal timestamp", () => {
  assert.throws(
    () => scientificIssuanceTime({
      evidence_class: "prospective_shadow",
      forecast_origin: "2020-01-01T00:00:00.000Z",
    }),
    (error) => {
      assert.equal(error.code, "AICIS_FORECAST_EVIDENCE_SEMANTICS_REJECTED");
      assert.equal(error.reason, "prospective_database_seal_time_missing_or_invalid");
      return true;
    },
  );
});

test("prospective chronology rejects sealing after the target window starts", () => {
  const result = evaluateScientificForecastEvidenceChronology({
    evidence_class: "prospective_shadow",
    forecast_origin: "2026-09-02T04:00:00.000Z",
    knowledge_cutoff: "2026-09-02T03:59:00.000Z",
    sealed_at: "2026-09-02T05:01:00.000Z",
    target_window_start: "2026-09-02T05:00:00.000Z",
    target_window_end: "2026-10-02T05:00:00.000Z",
  });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("scientific_issuance_after_target_window_start"));
});

test("rejects SECURITY DEFINER in executable schema code", async () => {
  const sql = (await candidateSql()).replace(
    "LANGUAGE plpgsql\nIMMUTABLE",
    "LANGUAGE plpgsql\nSECURITY DEFINER\nIMMUTABLE",
  );
  const result = auditScientificForecastLedgerSchema(sql);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("security_definer_forbidden"));
});

test("rejects Data API privileges for authenticated users", async () => {
  const sql = `${await candidateSql()}\nGRANT SELECT ON TABLE public.scientific_forecast_ledger_v1 TO authenticated;\n`;
  const result = auditScientificForecastLedgerSchema(sql);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("anon_or_authenticated_grant_forbidden"));
});

test("rejects mutation grants on the sealed forecast ledger", async () => {
  const sql = `${await candidateSql()}\nGRANT UPDATE ON TABLE public.scientific_forecast_ledger_v1 TO service_role;\n`;
  const result = auditScientificForecastLedgerSchema(sql);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("sealed_ledger_mutation_grant_forbidden"));
});

test("rejects removal of the database-authoritative prospective seal guard", async () => {
  const sql = (await candidateSql()).replace(
    "IF NEW.sealed_at > NEW.target_window_start THEN",
    "IF false THEN",
  );
  const result = auditScientificForecastLedgerSchema(sql);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("prospective_pre_target_seal_guard_missing"));
});

test("rejects removal of exact registered horizon enforcement", async () => {
  const sql = (await candidateSql()).replace(
    "v_expected_end := CASE v_task.horizon_unit",
    "v_expected_end_disabled := CASE v_task.horizon_unit",
  );
  const result = auditScientificForecastLedgerSchema(sql);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("registered_horizon_calculation_missing"));
});

test("rejects caller-controlled resolution time", async () => {
  const sql = (await candidateSql()).replace(
    "NEW.resolved_at := clock_timestamp();",
    "NEW.resolved_at := NEW.resolved_at;",
  );
  const result = auditScientificForecastLedgerSchema(sql);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("database_authoritative_resolution_time_missing"));
});

test("rejects removal of consecutive resolution version enforcement", async () => {
  const sql = (await candidateSql()).replace(
    "IF NEW.resolution_version <> v_last_version + 1 THEN",
    "IF false THEN",
  );
  const result = auditScientificForecastLedgerSchema(sql);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("consecutive_resolution_version_guard_missing"));
});

test("rejects removal of RLS from a governance table", async () => {
  const sql = (await candidateSql()).replace(
    "ALTER TABLE public.scientific_forecast_ledger_v1 ENABLE ROW LEVEL SECURITY;",
    "",
  );
  const result = auditScientificForecastLedgerSchema(sql);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("rls_missing:public.scientific_forecast_ledger_v1"));
});

test("rejects a task registry that stops enforcing the database protocol validator", async () => {
  const sql = (await candidateSql()).replace(
    "AND public.validate_scientific_forecast_task_spec_v1(task_spec)",
    "AND true",
  );
  const result = auditScientificForecastLedgerSchema(sql);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("registry_does_not_enforce_database_protocol_validator"));
});

test("throws rather than silently accepting a weakened schema", async () => {
  const sql = `${await candidateSql()}\nGRANT ALL ON TABLE public.scientific_forecast_ledger_v1 TO service_role;\n`;
  assert.throws(
    () => assertScientificForecastLedgerSchema(sql),
    (error) => {
      assert.equal(error.code, "AICIS_SCIENTIFIC_FORECAST_LEDGER_SCHEMA_REJECTED");
      assert.ok(error.reasons.includes("grant_all_forbidden"));
      return true;
    },
  );
});
