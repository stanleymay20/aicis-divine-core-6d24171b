import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSanctionsName,
  parseOfacSdnEntities,
  parseUnConsolidatedEntities,
  parseUkSanctionsCsv,
  parseEuFsfEntities,
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


const UK_CSV = [
  '"Last Updated","Unique ID","OFSI Group ID","UN Reference Number","Name 6","Name 1","Name 2","Name 3","Name 4","Name 5","Name type","Alias strength","Title","Name non-latin script","Non-latin script type","Non-latin script language","Regime Name","Individual, Entity, Ship","Designation source","Sanctions Imposed","Other Information","UK Statement of Reasons","Business registration number (s)"',
  '"21/09/2026","UKS123","","","ACME UK TRADING LTD","","","","","","Primary Name","","","","","","Russia","Entity","UK","Asset freeze","","","BR-UK-9"',
  '"21/09/2026","UKS123","","","ACME EXPORTS UK","","","","","","Alias","","","","","","Russia","Entity","UK","Asset freeze","","","BR-UK-9"',
  '"21/09/2026","UKS999","","","JANE DOE","","","","","","Primary Name","","","","","","Russia","Individual","UK","Asset freeze","","",""',
].join("\n");

test("parses UK entity primary names, aliases and business registration numbers", () => {
  const records = parseUkSanctionsCsv(UK_CSV);
  assert.equal(records.length, 1);
  assert.equal(records[0].record_id, "UKS123");
  assert.equal(records[0].primary_name, "ACME UK TRADING LTD");
  assert.deepEqual(records[0].aliases, ["ACME EXPORTS UK"]);
  assert.deepEqual(records[0].identifiers, ["BR-UK-9"]);
  assert.deepEqual(records[0].programs, ["Russia"]);
});

test("UK CSV parser fails closed when required headers are missing", () => {
  assert.deepEqual(parseUkSanctionsCsv("name,id\nAcme,1"), []);
});

test("UK official snapshot participates in exact-name sanctions review", () => {
  const uk = parseUkSanctionsCsv(UK_CSV);
  const result = screenEntityAgainstOfficialSnapshots({
    legal_name: "ACME UK TRADING LTD",
    snapshots: [{ source: "uk_sanctions", records: uk }],
    required_sources: ["uk_sanctions"],
  });
  assert.equal(result.status, "review_required_potential_match");
  assert.equal(result.matches[0].source, "uk_sanctions");
});


const EU_XML = `<?xml version="1.0"?>
<export xmlns="http://eu.europa.ec/fpi/fsd/export">
  <sanctionEntity euReferenceNumber="EU.123.45" unitedNationId="" logicalId="77">
    <regulation programme="RUS" logicalId="1"></regulation>
    <subjectType code="enterprise" classificationCode="E"/>
    <nameAlias wholeName="ACME EUROPE LTD" nameLanguage="EN" strong="true" logicalId="1"/>
    <nameAlias wholeName="ACME EU EXPORTS" nameLanguage="EN" strong="true" logicalId="2"/>
  </sanctionEntity>
  <sanctionEntity euReferenceNumber="EU.999.1" logicalId="88">
    <subjectType code="person" classificationCode="P"/>
    <nameAlias wholeName="JANE DOE" logicalId="3"/>
  </sanctionEntity>
</export>`;

test("parses EU FSF entity records and excludes persons", () => {
  const records = parseEuFsfEntities(EU_XML);
  assert.equal(records.length, 1);
  assert.equal(records[0].record_id, "EU.123.45");
  assert.equal(records[0].primary_name, "ACME EUROPE LTD");
  assert.deepEqual(records[0].aliases, ["ACME EU EXPORTS"]);
  assert.deepEqual(records[0].identifiers, ["EU.123.45"]);
  assert.deepEqual(records[0].programs, ["RUS"]);
});

test("EU official snapshot participates in exact-name sanctions review", () => {
  const eu = parseEuFsfEntities(EU_XML);
  const result = screenEntityAgainstOfficialSnapshots({
    legal_name: "ACME EU EXPORTS",
    snapshots: [{ source: "eu_sanctions", records: eu }],
    required_sources: ["eu_sanctions"],
  });
  assert.equal(result.status, "review_required_potential_match");
  assert.equal(result.matches[0].source, "eu_sanctions");
});
