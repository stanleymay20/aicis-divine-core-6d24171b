# compute-trust-metrics recovery audit — 2026-08-28

## Source mapping

Observed live source cron identity: `compute-trust-metrics-daily` -> `compute-trust-metrics`.

The exact source schedule is still unproven because live Lovable SQL access remains unavailable. No target scheduler activation is authorized by this note.

## Canonical hardening completed

The canonical worker now uses `requireAdminOrTrustedWorker`, preserves missing evidence as `NULL`, and records explicit epistemic semantics and evidence counts.

Specific truth-floor changes:

- no valid `ai_decision_logs.confidence` observations -> `metric_value = NULL`, not `0`;
- zero stored consent records -> active-consent ratio is `NULL`, not `0%`;
- no valid SDG progress observations -> SDG mean is `NULL`, not `0%`;
- no completed automation runs in the 24-hour observation window -> success rate is `NULL`, not `0%`;
- absence of a ledger root is retained as an observed binary absence (`0`) because the backing query succeeded and the absence itself is evidence;
- SHA-256 is labelled an integrity digest, not an authenticity signature;
- no metric is represented as a legal, security, accuracy, integrity, GDPR, or certification attestation beyond its explicit semantics.

## Historical migration defect found

`20251024184439_1b87a0e4-d097-4916-9e36-d6455a3c8192.sql` seeded fixed public trust values including `92.5`, `99.9`, `100`, and `68.3`. These are constants, not measurements. It also created an INSERT policy with `WITH CHECK (true)` for `trust_metrics`.

`20260828173000_trust_metrics_truth_floor_v1.sql` now:

- makes `metric_value` nullable;
- adds `observation_status`, `metric_semantics`, and `evidence_count`;
- quarantines the exact historical seed rows by nulling their values while retaining them for auditability;
- removes the unrestricted INSERT policy;
- permits governed authenticated-admin inserts while service-role workers continue through RLS bypass.

## Remaining blockers

- exact source cron schedule not recovered;
- target database has intentionally not been restored/migrated yet;
- target function has not been deployed;
- source/target behavior and row parity are not yet proven;
- target writer remains OFF.
