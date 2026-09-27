import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("../supabase/functions/preview-execution-ibkr/index.ts", import.meta.url),
  "utf8",
);

test("IBKR adapter calls what-if preview and never the place-order endpoint", () => {
  assert.match(source, /\/orders\/whatif/);
  assert.match(source, /\/iserver\/marketdata\/snapshot/);
  assert.match(source, /\/iserver\/auth\/status/);
  assert.doesNotMatch(source, /place-order/);
  assert.doesNotMatch(source, /\/orders["'`]/);
  assert.match(source, /place_order_endpoint_called:\s*false/);
  assert.match(source, /order_submitted:\s*false/);
  assert.match(source, /money_moved:\s*false/);
});

test("IBKR client request cannot supply provider credentials or account id", () => {
  assert.match(source, /Deno\.env\.get\("IBKR_WEB_API_BEARER_TOKEN"\)/);
  assert.match(source, /Deno\.env\.get\("IBKR_ACCOUNT_ID"\)/);
  assert.doesNotMatch(source, /body\.bearer_token/);
  assert.doesNotMatch(source, /body\.account_id/);
});
