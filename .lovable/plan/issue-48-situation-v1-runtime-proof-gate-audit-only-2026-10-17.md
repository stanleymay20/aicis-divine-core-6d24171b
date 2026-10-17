# Issue #48 — Situation v1 runtime proof gate (audit only)

Audit time: 2026-10-17 14:19 UTC. No code, migrations, auth/RLS changes or deploys were made.

## Blocking finding
The live database was **unreachable for the whole audit window**. Every read query, including `select 1`, returned "connection pooler unavailable (544)". This means the backend is paused or still waking up. As a result, none of the database points (2–10) can be proven from the live system right now.

Version note: the sandbox is at `67130939…`. `f9e36656…` (Merge PR #47) is in its history, so the Situation v1 code below is present at or after the canonical SHA. I did not check whether `67130939` adds any Situation-related changes on top.

## Results

| # | Point | Result | Evidence |
|---|---|---|---|
| 1 | `/situations` exists and sits behind the auth boundary | PASS (code) / UNKNOWN (runtime) | `src/App.tsx:177` has `<Route path="/situations" element={<Shell><Situations/></Shell>}>`; `Shell` is the protected app shell; `src/pages/Situations.tsx` exists; it is registered in `src/lib/aicis-workspaces.ts:42`. I did not load it in a browser: without a database the page can only show its error state. |
| 2 | The three tables exist | UNKNOWN | The database could not be reached. Code only shows that the client queries them (`useSituationsV1.ts`). |
| 3 | Relevant columns exist | UNKNOWN | The database could not be reached. In code, the identity columns (`canonical_event_id`, `duplicate_of_signal_id`, `duplicate_match_status`) are loaded in a separate, optional query. If that query fails, a data gap is recorded and duplicates stay separate (fail-safe). |
| 4 | 7-day row count vs the 300-row cap | UNKNOWN (count) / FAIL-risk (design) | The hook defaults to `days=7, limit=300`, newest `first_detected_at` first. Earlier this session about 35k signals arrived per week (about 5k/day). If that still holds, the cap would cover only about 1.4 hours, so the page would be a recent sample, not a 7-day view. This must be re-measured live. |
| 5 | Verified vs candidate duplicates | UNKNOWN | The database could not be reached. |
| 6 | Source count vs governed independent corroboration | PASS (logic) / UNKNOWN (data) | The read model counts `sourceIdentifiers` for description only. Corroboration is "established" only when `multi_source_confirmed=true` and `corroboration_count` is set (tests in `tests/situation-read-model-v1.test.mjs`). Whether the live fields are ever filled is unproven. Earlier this session `source_independence_status` / `independent_origin_count` did not exist live. |
| 7 | Conflicting routing feedback | PASS (logic) / UNKNOWN (data) | The rule that keeps conflicts marked "conflicted" is covered by tests. Live conflict counts are unproven. |
| 8 | Linked outcomes kept separate from forecast resolutions | PASS (logic) / UNKNOWN (data) | `operational.semantics` carries `not_scientific_forecast_resolution`, and `forecast.state` is always `not_linked`, probability null. Live linked-row counts are unproven. |
| 9 | Read-only query latency | UNKNOWN | Not measurable. Earlier this session a 900-row wide `global_signals` select took about 5.7 s (Opportunities work), so it is only an indication. |
| 10 | Access limits for ordinary vs analyst/operator users | UNKNOWN (partial earlier evidence) | Earlier this session `global_signals` was readable by any signed-in user (qual `true`) with service-role-only writes. Policies for `signal_routing_feedback` and `decision_outcome_log` were not checked. The hook handles read errors as data gaps, so a blocked read would show "unreviewed" / "not recorded" rather than real absence. This is an important ambiguity to resolve. |

## What is needed to close issue #48
Run these steps once the backend is reachable. All are read-only.
1. Bring the backend back up from the Lovable Cloud panel, then confirm `select 1` works.
2. Schema: `information_schema.columns` for the three tables and the columns listed in point 3.
3. Counts:
   - 7-day `global_signals` count using `first_detected_at`.
   - `duplicate_match_status` / `canonical_event_status` breakdown, including how many have `duplicate_of_signal_id` set.
   - A few verified duplicate pairs, showing ids and titles only.
   - How many rows have `multi_source_confirmed=true` with `corroboration_count` not null, against rows that only have a high `source_count`.
   - Number of `signal_id`s in routing feedback that have both confirmed and rejected.
   - Number of `decision_outcome_log` rows with `signal_id` set and with `outcome_success` set.
4. Policies: `pg_policies` for `signal_routing_feedback` and `decision_outcome_log`.
5. Speed: `EXPLAIN ANALYZE` of the hook's exact queries (300 rows, then the `in(id)` lookups).
6. Runtime: load `/situations` once signed in and capture its data-gap banner. Also load it with a non-analyst account if one exists. A blocked read and a truly empty table look the same in the hook today.

Decisions needed before the gate can pass (not acted on):
- The 300-row cap vs real 7-day volume: is a recent sample acceptable, or must it be labelled as one?
- The hook should tell apart "can't read because of permissions" from "really empty". This is a later code change, not part of this audit.

No persistent Situation table is proposed.
