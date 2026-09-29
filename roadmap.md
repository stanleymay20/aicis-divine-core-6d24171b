# Roadmap

- [x] Diagnose published sign-in failure: published browser bundle lacks the Cloud connection while the local preview and backend are healthy; fail closed with a clear message instead of attempting a nonexistent service. Published site requires a fresh publish with its connection included.
- [x] Fix all current preview/typecheck errors reported in `/tmp/observability/build-errors.log`.
- [x] Verify the preview build is clean.
- [x] Restore password-reset link acceptance without weakening recovery authorization.
- [x] Verify invalid reset-screen behavior and authentication regression checks; fresh emailed-link end-to-end requires the recipient to open it.
- [x] Fix cross-browser recovery email generation; verified the request omits the browser-bound code challenge and invalid links remain blocked. Fresh emailed-link completion requires recipient access.

## GA audit (2026-09-27)
- [x] Fix world-map refresh loop (incident markers)
- [x] Header audit-ledger counter timing out on every page
- [x] Server-function rejections missing browser headers (200 functions)
- [x] Opportunities page crash on missing research-run storage
- [ ] Latest-signals / citations indexes — scheduled 01:10/01:40 UTC tonight
- [x] Command-center views: telemetry/intervention/agent/memory/enterprise backbone tables do not exist live (only planetary_causal_command_view). Page now reports "not deployed" per stage instead of erroring or polling 404s. Deploying the backbone would require replaying the unapplied truth-floor migration set — not done (repo/live schema drift risk).
- [ ] Trust-score + forecast accumulation timeouts — still blocked on the same unapplied migration set (per-file review required)
- [ ] One Question -> One Decision: code wired to orchestrate-multi-agent (done); BLOCKED on AICIS_MODEL_* secrets + production test; function is admin(+MFA)-only.
