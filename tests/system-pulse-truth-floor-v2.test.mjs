import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pulsePath = new URL("../src/pages/SystemPulse.tsx", import.meta.url);

test("System Pulse surfaces telemetry errors instead of rendering them as healthy", async () => {
  const source = await readFile(pulsePath, "utf8");

  assert.match(source, /loadError/);
  assert.match(source, /System health telemetry unavailable/);
  assert.match(source, /heartbeatResult\.error\?\.message/);
  assert.match(source, /layerResult\.error\?\.message/);
  assert.match(source, /canaryResult\.error\?\.message/);
});

test("Empty telemetry sets are unavailable rather than healthy", async () => {
  const source = await readFile(pulsePath, "utf8");

  assert.match(source, /heartbeats\.length === 0\s*\? "—"/);
  assert.match(source, /layers\.length === 0 \? "—"/);
  assert.match(source, /canaries\.length === 0 \? "—"/);
  assert.match(source, /No heartbeat records/);
  assert.match(source, /No layer-health records/);
  assert.match(source, /No canary probe records/);
});

test("Watchdog schedule is configuration and not colored as a healthy result", async () => {
  const source = await readFile(pulsePath, "utf8");

  assert.match(source, /label="Watchdog schedule"/);
  assert.match(source, /sub="auto-restart configured"/);
  assert.match(source, /tone="neutral"/);
});

test("Watchdog execution remains operator-only and reports action failure", async () => {
  const source = await readFile(pulsePath, "utf8");

  assert.match(source, /if \(!isOperator\) return/);
  assert.match(source, /watchdogError/);
  assert.match(source, /Watchdog action failed/);
});
