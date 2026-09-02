const REQUIRED_TABLES = [
  "public.scientific_forecast_tasks_v1",
  "public.scientific_forecast_ledger_v1",
  "public.scientific_forecast_resolution_ledger_v1",
];

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ");
}

function normalize(sql) {
  return stripSqlComments(sql).replace(/\s+/g, " ").trim().toLowerCase();
}

function has(normalized, fragment) {
  return normalized.includes(fragment.toLowerCase().replace(/\s+/g, " ").trim());
}

function requireFragment(normalized, fragment, reason, reasons) {
  if (!has(normalized, fragment)) reasons.push(reason);
}

export function auditScientificForecastLedgerSchema(sql) {
  if (typeof sql !== "string" || sql.trim() === "") {
    return { ok: false, reasons: ["schema_candidate_missing"] };
  }

  const reasons = [];
  const stripped = stripSqlComments(sql);
  const normalized = normalize(sql);

  if (/\bsecurity\s+definer\b/i.test(stripped)) {
    reasons.push("security_definer_forbidden");
  }
  if (/\bgrant\s+all\b/i.test(stripped)) {
    reasons.push("grant_all_forbidden");
  }
  if (/\bgrant\s+[^;]+\s+to\s+(anon|authenticated)\b/i.test(stripped)) {
    reasons.push("anon_or_authenticated_grant_forbidden");
  }
  if (/\bgrant\s+[^;]*(update|delete)[^;]*on\s+table\s+public\.scientific_forecast_(ledger|resolution_ledger)_v1\b/i.test(stripped)) {
    reasons.push("sealed_ledger_mutation_grant_forbidden");
  }

  requireFragment(
    normalized,
    "aicis-scientific-forecasting-protocol-v1",
    "protocol_binding_missing",
    reasons,
  );
  const validatorSignature =
    "create or replace function public.validate_scientific_forecast_task_spec_v1(p_spec jsonb)";
  requireFragment(
    normalized,
    validatorSignature,
    "database_protocol_validator_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "public.validate_scientific_forecast_task_spec_v1(task_spec)",
    "registry_does_not_enforce_database_protocol_validator",
    reasons,
  );
  requireFragment(
    normalized,
    "is distinct from 'aicis-scientific-forecasting-protocol-v1'",
    "protocol_validator_not_null_safe",
    reasons,
  );
  requireFragment(
    normalized,
    "retrospective_rolling_origin\",\"prospective_sealed",
    "required_evaluation_modes_missing_from_database_validator",
    reasons,
  );
  requireFragment(
    normalized,
    "minimum_resolved_forecasts_for_claim",
    "calibration_sample_floor_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "minimum_resolved_forecasts_for_operational_use",
    "promotion_sample_floor_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "knowledge_time_unverified\",\"source_coverage_insufficient\",\"calibration_insufficient\",\"severe_distribution_shift\",\"excessive_model_disagreement",
    "required_abstention_triggers_missing",
    reasons,
  );

  // The effective (last) validator override must preserve JSON scalar types.
  const lastValidatorIndex = normalized.lastIndexOf(validatorSignature);
  const strictTypeFragments = [
    ["jsonb_typeof(p_spec#>'{horizon,value}') is distinct from 'number'", "horizon_json_number_type_guard_missing"],
    ["jsonb_typeof(p_spec#>'{evaluation,minimum_forecast_origins}') is distinct from 'number'", "evaluation_min_origins_json_number_type_guard_missing"],
    ["jsonb_typeof(p_spec#>'{calibration,required}') is distinct from 'boolean'", "calibration_required_json_boolean_type_guard_missing"],
    ["p_spec#>'{calibration,required}' is distinct from 'true'::jsonb", "calibration_required_strict_true_guard_missing"],
    ["jsonb_typeof(p_spec#>'{calibration,minimum_resolved_forecasts_for_claim}') is distinct from 'number'", "calibration_sample_json_number_type_guard_missing"],
    ["jsonb_typeof(p_spec#>'{abstention,enabled}') is distinct from 'boolean'", "abstention_enabled_json_boolean_type_guard_missing"],
    ["jsonb_typeof(p_spec#>'{promotion,no_auto_promotion}') is distinct from 'boolean'", "promotion_no_auto_json_boolean_type_guard_missing"],
    ["jsonb_typeof(p_spec#>'{promotion,minimum_resolved_forecasts_for_operational_use}') is distinct from 'number'", "promotion_sample_json_number_type_guard_missing"],
    ["jsonb_typeof(p_spec#>'{ledger,immutable_after_seal}') is distinct from 'boolean'", "ledger_immutable_json_boolean_type_guard_missing"],
    ["jsonb_typeof(p_spec#>'{ledger,seal_before_target_period_evidence}') is distinct from 'boolean'", "ledger_seal_policy_json_boolean_type_guard_missing"],
  ];
  for (const [fragment, reason] of strictTypeFragments) {
    const index = normalized.lastIndexOf(fragment);
    if (index < lastValidatorIndex) reasons.push(reason);
  }

  const validatorGrant =
    "grant execute on function public.validate_scientific_forecast_task_spec_v1(jsonb) to service_role";
  requireFragment(
    normalized,
    validatorGrant,
    "validator_service_role_execute_grant_missing",
    reasons,
  );
  const validatorRevoke =
    "revoke all on function public.validate_scientific_forecast_task_spec_v1(jsonb) from public, anon, authenticated, service_role";
  const lastValidatorRevokeIndex = normalized.lastIndexOf(validatorRevoke);
  const lastValidatorGrantIndex = normalized.lastIndexOf(validatorGrant);
  if (lastValidatorGrantIndex <= lastValidatorRevokeIndex) {
    reasons.push("validator_service_role_execute_not_effective_after_revoke");
  }

  for (const table of REQUIRED_TABLES) {
    requireFragment(normalized, `create table ${table}`, `table_missing:${table}`, reasons);
    requireFragment(normalized, `alter table ${table} enable row level security`, `rls_missing:${table}`, reasons);
    requireFragment(
      normalized,
      `revoke all on table ${table} from public, anon, authenticated, service_role`,
      `explicit_revoke_missing:${table}`,
      reasons,
    );
  }

  requireFragment(
    normalized,
    "grant select, insert, update on table public.scientific_forecast_tasks_v1 to service_role",
    "task_registry_service_grant_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "grant select, insert on table public.scientific_forecast_ledger_v1 to service_role",
    "forecast_ledger_append_only_service_grant_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "grant select, insert on table public.scientific_forecast_resolution_ledger_v1 to service_role",
    "resolution_ledger_append_only_service_grant_missing",
    reasons,
  );

  requireFragment(
    normalized,
    "before insert or update or delete on public.scientific_forecast_tasks_v1",
    "task_lifecycle_trigger_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "scientific forecast tasks must be inserted as unapproved drafts",
    "approved_task_insert_bypass_not_blocked",
    reasons,
  );
  requireFragment(
    normalized,
    "approved/retired scientific forecast task definitions and approval evidence are immutable",
    "approved_task_immutability_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "scientific forecast tasks are versioned records; retire instead of delete",
    "task_delete_guard_missing",
    reasons,
  );

  requireFragment(
    normalized,
    "new.sealed_at := clock_timestamp()",
    "database_authoritative_seal_time_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "new.sealed_at > new.target_window_start",
    "prospective_pre_target_seal_guard_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "retrospective backtests require a target window that has already ended",
    "retrospective_completed_window_guard_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "prospective operational evidence is quarantined until a separate operational-promotion control is implemented",
    "prospective_operational_quarantine_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "v_expected_end := case v_task.horizon_unit",
    "registered_horizon_calculation_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "new.target_window_end is distinct from v_expected_end",
    "exact_registered_horizon_enforcement_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "sealed scientific forecasts are append-only and cannot be updated or deleted",
    "forecast_append_only_trigger_missing",
    reasons,
  );

  requireFragment(
    normalized,
    "new.resolved_at := clock_timestamp()",
    "database_authoritative_resolution_time_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "pg_advisory_xact_lock(hashtextextended(new.forecast_id::text, 0))",
    "resolution_advisory_serialization_lock_missing",
    reasons,
  );
  const advisoryLockIndex = normalized.lastIndexOf(
    "pg_advisory_xact_lock(hashtextextended(new.forecast_id::text, 0))",
  );
  const rowUpdateLockIndex = normalized.lastIndexOf("for update");
  if (rowUpdateLockIndex > advisoryLockIndex) {
    reasons.push("row_update_lock_reintroduced_after_advisory_hardening");
  }
  requireFragment(
    normalized,
    "new.resolution_version <> v_last_version + 1",
    "consecutive_resolution_version_guard_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "new.resolved_at < v_forecast.target_window_end",
    "post_horizon_resolution_guard_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "new.ground_truth_authority <> v_task.resolution_authority",
    "resolution_authority_binding_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "new.revision_policy <> v_task.resolution_revision_policy",
    "resolution_revision_policy_binding_missing",
    reasons,
  );
  requireFragment(
    normalized,
    "scientific forecast resolutions are append-only; create a new resolution version",
    "resolution_append_only_trigger_missing",
    reasons,
  );

  const createPolicyForGovernanceTables = /create\s+policy[^;]+on\s+public\.scientific_forecast_(tasks|ledger|resolution_ledger)_v1/i.test(stripped);
  if (createPolicyForGovernanceTables) reasons.push("data_api_policy_for_governance_tables_forbidden_v1");

  return { ok: reasons.length === 0, reasons };
}

export function assertScientificForecastLedgerSchema(sql) {
  const result = auditScientificForecastLedgerSchema(sql);
  if (!result.ok) {
    const error = new Error(`Scientific forecast ledger schema rejected: ${result.reasons.join(", ")}`);
    error.code = "AICIS_SCIENTIFIC_FORECAST_LEDGER_SCHEMA_REJECTED";
    error.reasons = result.reasons;
    throw error;
  }
  return true;
}
