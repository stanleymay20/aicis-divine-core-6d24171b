export const OFFICIAL_SANCTIONS_SCREEN_VERSION = "aicis-official-sanctions-screen-v1";

function decodeXml(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function tagText(block, tag) {
  const match = String(block).match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + ">", "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, " ")) : "";
}

function tagTexts(block, tag) {
  const values = [];
  const regex = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + ">", "gi");
  for (const match of String(block).matchAll(regex)) {
    values.push(decodeXml(match[1].replace(/<[^>]+>/g, " ")));
  }
  return values.filter(Boolean);
}

export function normalizeSanctionsName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function parseOfacSdnEntities(xml) {
  const source = String(xml ?? "");
  const blocks = source.match(/<sdnEntry(?:\s[^>]*)?>[\s\S]*?<\/sdnEntry>/gi) || [];
  const records = [];

  for (const block of blocks) {
    const type = tagText(block, "sdnType");
    if (!/entity|organization|company|group/i.test(type)) continue;

    const firstName = tagText(block, "firstName");
    const lastName = tagText(block, "lastName");
    const primaryName = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!primaryName) continue;

    const aliases = [];
    const akaBlocks = block.match(/<aka(?:\s[^>]*)?>[\s\S]*?<\/aka>/gi) || [];
    for (const aka of akaBlocks) {
      const alias = [tagText(aka, "firstName"), tagText(aka, "lastName")].filter(Boolean).join(" ").trim();
      if (alias) aliases.push(alias);
    }

    const identifiers = [];
    const idBlocks = block.match(/<id(?:\s[^>]*)?>[\s\S]*?<\/id>/gi) || [];
    for (const idBlock of idBlocks) {
      const number = tagText(idBlock, "idNumber");
      if (number) identifiers.push(number);
    }

    records.push({
      source: "ofac_sdn",
      source_authority: "Office of Foreign Assets Control",
      record_id: tagText(block, "uid") || null,
      primary_name: primaryName,
      aliases: unique(aliases),
      identifiers: unique(identifiers),
      programs: unique(tagTexts(block, "program")),
    });
  }

  return records;
}

export function parseUnConsolidatedEntities(xml) {
  const source = String(xml ?? "");
  const blocks = source.match(/<ENTITY(?:\s[^>]*)?>[\s\S]*?<\/ENTITY>/gi) || [];
  const records = [];

  for (const block of blocks) {
    const primaryName = tagText(block, "FIRST_NAME");
    if (!primaryName) continue;

    const aliases = unique(tagTexts(block, "ALIAS_NAME"));
    const identifiers = unique([
      ...tagTexts(block, "NUMBER"),
      ...tagTexts(block, "NOTE"),
    ].filter((value) => /[A-Z0-9]/i.test(value)));

    records.push({
      source: "un_consolidated",
      source_authority: "United Nations Security Council",
      record_id: tagText(block, "REFERENCE_NUMBER") || tagText(block, "DATAID") || null,
      primary_name: primaryName,
      aliases,
      identifiers,
      programs: unique([tagText(block, "UN_LIST_TYPE")]),
    });
  }

  return records;
}

function recordNames(record) {
  return unique([record.primary_name, ...(record.aliases || [])]);
}

function exactNameMatch(queryNames, record) {
  const normalizedRecordNames = recordNames(record).map(normalizeSanctionsName).filter(Boolean);
  return queryNames.some((query) => normalizedRecordNames.includes(query));
}

function identifierMatch(identifier, record) {
  if (!identifier) return false;
  const target = String(identifier).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!target) return false;
  return (record.identifiers || []).some((value) =>
    String(value).replace(/[^A-Z0-9]/gi, "").toUpperCase() === target
  );
}

export function screenEntityAgainstOfficialSnapshots(input = {}) {
  const legalName = normalizeSanctionsName(input.legal_name);
  const aliases = Array.isArray(input.aliases) ? input.aliases.map(normalizeSanctionsName).filter(Boolean) : [];
  const queryNames = unique([legalName, ...aliases]);
  const registrationId = input.registration_id ?? null;
  const snapshots = Array.isArray(input.snapshots) ? input.snapshots : [];
  const matches = [];
  const coveredSources = [];

  if (!legalName) {
    return {
      screen_version: OFFICIAL_SANCTIONS_SCREEN_VERSION,
      status: "invalid_input",
      transaction_eligible: false,
      matches: [],
      covered_sources: [],
      reasons: ["legal_name_required"],
    };
  }

  for (const snapshot of snapshots) {
    if (!snapshot?.source || !Array.isArray(snapshot.records)) continue;
    coveredSources.push(snapshot.source);
    for (const record of snapshot.records) {
      const nameMatched = exactNameMatch(queryNames, record);
      const idMatched = identifierMatch(registrationId, record);
      if (!nameMatched && !idMatched) continue;
      matches.push({
        source: snapshot.source,
        source_authority: record.source_authority,
        record_id: record.record_id,
        primary_name: record.primary_name,
        aliases: record.aliases,
        programs: record.programs,
        name_match: nameMatched,
        identifier_match: idMatched,
        evidence_refs: snapshot.evidence_refs ?? [],
      });
    }
  }

  const requiredSources = Array.isArray(input.required_sources) && input.required_sources.length
    ? input.required_sources
    : ["ofac_sdn", "un_consolidated", "eu_sanctions", "uk_sanctions"];
  const missingSources = requiredSources.filter((source) => !coveredSources.includes(source));

  if (matches.length) {
    return {
      screen_version: OFFICIAL_SANCTIONS_SCREEN_VERSION,
      status: "review_required_potential_match",
      transaction_eligible: false,
      matches,
      covered_sources: unique(coveredSources),
      missing_sources: missingSources,
      reasons: ["official_sanctions_candidate_match_requires_review"],
      compliance_status: "review",
    };
  }

  if (missingSources.length) {
    return {
      screen_version: OFFICIAL_SANCTIONS_SCREEN_VERSION,
      status: "partial_screen_no_match",
      transaction_eligible: false,
      matches: [],
      covered_sources: unique(coveredSources),
      missing_sources: missingSources,
      reasons: ["required_sanctions_sources_not_fully_covered"],
      compliance_status: "review",
    };
  }

  return {
    screen_version: OFFICIAL_SANCTIONS_SCREEN_VERSION,
    status: "complete_screen_no_match",
    transaction_eligible: false,
    matches: [],
    covered_sources: unique(coveredSources),
    missing_sources: [],
    reasons: ["no_exact_match_on_required_official_sources_human_compliance_approval_still_required"],
    compliance_status: "review",
  };
}
