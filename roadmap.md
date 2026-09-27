# Roadmap

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
- [ ] Missing command-center views + trust-score/accumulation timeouts — need per-file migration review
