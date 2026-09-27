
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const initiate = fs.readFileSync(
  new URL("../supabase/functions/gov-initiate-trade/index.ts", import.meta.url),
  "utf8",
);
const execute = fs.readFileSync(
  new URL("../supabase/functions/gov-execute-trade/index.ts", import.meta.url),
  "utf8",
);

test("legacy governance initiation is quarantined and cannot lock wallet funds", () => {
  assert.match(initiate, /legacy_governance_trade_disabled/);
  assert.match(initiate, /replacement:\s*"preview-execution"/);
  assert.doesNotMatch(initiate, /const\s+price\s*=\s*100/);
  assert.doesNotMatch(initiate, /\.from\("sc_wallets"\)\.update/);
  assert.doesNotMatch(initiate, /\.from\("governance_trades"\)\.insert/);
});

test("legacy governance execution is quarantined and cannot debit wallet or write execution ledger", () => {
  assert.match(execute, /legacy_governance_execution_disabled/);
  assert.match(execute, /replacement:\s*"preview-execution"/);
  assert.doesNotMatch(execute, /balance:\s*Number\(wallet\.balance\)/);
  assert.doesNotMatch(execute, /\.from\("sc_ledger"\)\.insert/);
  assert.doesNotMatch(execute, /status:\s*"executed"/);
});
