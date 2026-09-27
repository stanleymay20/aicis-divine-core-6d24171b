import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSanctionsName,
  parseOfacSdnEntities,
  parseUnConsolidatedEntities,
  screenEntityAgainstOfficialSnapshots,
} from "../supabase/functions/_shared/official-sanctions-screen-v1.mjs";

const OFAC = `<sdnList><sdnEntry><uid>123</uid><firstName>ACME</firstName><lastName>TRADING LTD</lastName><sdnType>Entity</sdnType><programList><program>TEST</program></programList><akaList><aka><lastName>ACME EXPORTS</lastName></aka></akaList><idList><id><idNumber>REG-9</idNumber></id></idList></sdnEntry><sdnEntry><uid>456</uid><firstName>JANE</firstName><lastName>DOE</lastName><sdnType>Individual</sdnType></sdnEntry></sdnList>`;

const UN = `<CONSOLIDATED_LIST><ENTITIES><ENTITY><DATAID>999</DATAID><FIRST_NAME>GLOBAL TEST COMPANY</FIRST_NAME><UN_LIST_TYPE>Test Regime</UN_LIST_TYPE><REFERENCE_NUMBER>QDe.999</REFERENCE_NUMBER><ENTITY_ALIAS><ALIAS_NAME>GTC</ALIAS_NAME></ENTITY_ALIAS></ENTITY></ENTITIES></CONSOLIDATED_LIST>`;

test("normalizes names without fuzzy inference", () => {
  assert.equal(normalizeSanctionsName("Acme & Trading, Ltd."), "ACME AND TRADING LTD");
});

test("parses OFAC entity records and skips individuals", () => {
  const records = parseOfacSdnEntities(OFAC);
  assert.equal(records.length, 1);
  assert.equal(records[0].primary_name, "ACME TRADING LTD");
  assert.deepEqual(records[0].aliases, ["ACME EXPORTS"]);
  assert.deepEqual(records[0].identifiers, ["REG-9"]);
});

test("parses UN consolidated entity names and aliases", () => {
  const records = parseUnConsolidatedEntities(UN);
  assert.equal(records.length, 1);
  assert.equal(records[0].record_id, "QDe.999");
  assert.deepEqual(records[0].aliases, ["GTC"]);
});

test("exact official-list name hit requires review and blocks transaction eligibility", () => {
  const result = screenEntityAgainstOfficialSnapshots({
    legal_name: "Acme Trading Ltd",
    snapshots: [
      { source: "ofac_sdn", records: parseOfacSdnEntities(OFAC), evidence_refs: [] },
      { source: "un_consolidated", records: parseUnConsolidatedEntities(UN), evidence_refs: [] },
    ],
    required_sources: ["ofac_sdn", "un_consolidated"],
  });
  assert.equal(result.status, "review_required_potential_match");
  assert.equal(result.transaction_eligible, false);
  assert.equal(result.matches.length, 1);
});

test("registration identifier hit also requires review", () => {
  const result = screenEntityAgainstOfficialSnapshots({
    legal_name: "Different Legal Name",
    registration_id: "REG9",
    snapshots: [{ source: "ofac_sdn", records: parseOfacSdnEntities(OFAC) }],
    required_sources: ["ofac_sdn"],
  });
  assert.equal(result.status, "review_required_potential_match");
  assert.equal(result.matches[0].identifier_match, true);
});

test("missing required official sources never produces a clear result", () => {
  const result = screenEntityAgainstOfficialSnapshots({
    legal_name: "No Match Company",
    snapshots: [{ source: "ofac_sdn", records: parseOfacSdnEntities(OFAC) }],
  });
  assert.equal(result.status, "partial_screen_no_match");
  assert.equal(result.transaction_eligible, false);
  assert.ok(result.missing_sources.includes("un_consolidated"));
});

test("complete no-match screen still requires human compliance approval", () => {
  const result = screenEntityAgainstOfficialSnapshots({
    legal_name: "No Match Company",
    snapshots: [
      { source: "ofac_sdn", records: parseOfacSdnEntities(OFAC) },
      { source: "un_consolidated", records: parseUnConsolidatedEntities(UN) },
    ],
    required_sources: ["ofac_sdn", "un_consolidated"],
  });
  assert.equal(result.status, "complete_screen_no_match");
  assert.equal(result.compliance_status, "review");
  assert.equal(result.transaction_eligible, false);
});
