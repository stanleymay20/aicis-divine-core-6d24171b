# Forecast Task Registry Implementation Gate

The Forecast Task Registry, Forecast Ledger and Resolution Ledger are deliberately **not** implemented in this protocol PR.

They may be implemented only after `AICIS Scientific Forecasting Protocol v1` is merged and must bind every registered task to an exact protocol version.

The next controlled implementation must preserve these boundaries:

1. no production forecast writer is enabled merely by creating schema;
2. registered task definitions are versioned and immutable once used by a sealed forecast;
3. forecasts are append-only after sealing;
4. resolutions are separately versioned and retain ground-truth source/vintage evidence;
5. no retrospective forecast may be inserted into the prospective ledger as though it had been issued historically;
6. task validation must call or reproduce the executable protocol invariants without weakening them;
7. no causal claim is inferred from a predictive task registration;
8. no model is operationally promoted merely because the registry/ledger exists.

This file exists as an explicit phase boundary so schema work cannot silently outrun the scientific protocol.
