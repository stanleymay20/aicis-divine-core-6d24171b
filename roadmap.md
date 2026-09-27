# Roadmap

- [x] Fix all current preview/typecheck errors reported in `/tmp/observability/build-errors.log`.
- [x] Verify the preview build is clean.
- [x] Restore password-reset link acceptance without weakening recovery authorization.
- [x] Verify invalid reset-screen behavior and authentication regression checks; fresh emailed-link end-to-end requires the recipient to open it.
- [x] Fix cross-browser recovery email generation; verified the request omits the browser-bound code challenge and invalid links remain blocked. Fresh emailed-link completion requires recipient access.
