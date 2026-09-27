
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalStrategicJson,
  hashStrategicSnapshot,
} from "../supabase/functions/_shared/strategic-audit-v1.mjs";

test("canonical strategic JSON is stable across object key ordering", () => {
  const a = {
    primary: { id: "broker", expected_value: 2800 },
    state: { capital: 20000, capabilities: ["brokerage"] },
  };
  const b = {
    state: { capabilities: ["brokerage"], capital: 20000 },
    primary: { expected_value: 2800, id: "broker" },
  };

  assert.equal(canonicalStrategicJson(a), canonicalStrategicJson(b));
});

test("strategic snapshot hash is deterministic", async () => {
  const snapshot = {
    engine_version: "aicis-strategic-doctrine-v1",
    primary_strategy: { id: "broker", expected_value: 2800 },
    learning_packet: { comparator_strategy_id: "no-action" },
  };

  const first = await hashStrategicSnapshot(snapshot);
  const second = await hashStrategicSnapshot(snapshot);

  assert.equal(first.hash, second.hash);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(first.algorithm, "SHA-256");
});

test("substantive strategic changes alter the fingerprint", async () => {
  const base = {
    primary_strategy: { id: "broker", expected_value: 2800 },
    learning_packet: { comparator_strategy_id: "no-action" },
  };
  const changed = {
    primary_strategy: { id: "broker", expected_value: 3200 },
    learning_packet: { comparator_strategy_id: "no-action" },
  };

  const left = await hashStrategicSnapshot(base);
  const right = await hashStrategicSnapshot(changed);

  assert.notEqual(left.hash, right.hash);
});

test("array order remains meaningful in the strategic fingerprint", async () => {
  const a = await hashStrategicSnapshot({ sequence: ["verify buyer", "verify supplier"] });
  const b = await hashStrategicSnapshot({ sequence: ["verify supplier", "verify buyer"] });

  assert.notEqual(a.hash, b.hash);
});
