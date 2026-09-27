import test from "node:test";
import assert from "node:assert/strict";
import { parseEcbReferenceXml } from "../supabase/functions/_shared/ecb-reference-fx-v1.mjs";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope>
  <Cube>
    <Cube time='2026-09-25'>
      <Cube currency='USD' rate='1.1403'/>
      <Cube currency='GBP' rate='0.86045'/>
      <Cube currency='JPY' rate='179.70'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const evidence = {
  retrieved_at: "2026-09-27T06:00:00Z",
  evidence_refs: [{
    source_id: "ecb:eurofxref-daily",
    observed_at: "2026-09-27T06:00:00Z",
    sha256: "d".repeat(64),
  }],
};

test("parses ECB euro-base reference rates with provenance", () => {
  const result = parseEcbReferenceXml(XML, evidence);
  assert.equal(result.ok, true);
  assert.equal(result.effective_date, "2026-09-25");
  assert.equal(result.rates.length, 3);
  const usd = result.rates.find((rate) => rate.quote_currency === "USD");
  assert.equal(usd.rate, 1.1403);
  assert.equal(usd.base_currency, "EUR");
  assert.equal(usd.evidence_status, "official_reference");
  assert.equal(usd.execution_eligible_fx, false);
  assert.equal(usd.transaction_use_status, "reference_only_not_execution_quote");
});

test("fails closed when ECB effective date is absent", () => {
  const result = parseEcbReferenceXml("<Envelope><Cube currency='USD' rate='1.2'/></Envelope>", evidence);
  assert.equal(result.ok, false);
  assert.equal(result.error, "ecb_effective_date_missing_or_invalid");
  assert.deepEqual(result.rates, []);
});

test("ignores malformed or nonpositive rates", () => {
  const xml = `<Envelope><Cube time="2026-09-25"><Cube currency="USD" rate="0"/><Cube currency="GBP" rate="0.86"/></Cube></Envelope>`;
  const result = parseEcbReferenceXml(xml, evidence);
  assert.equal(result.rates.length, 1);
  assert.equal(result.rates[0].quote_currency, "GBP");
});
