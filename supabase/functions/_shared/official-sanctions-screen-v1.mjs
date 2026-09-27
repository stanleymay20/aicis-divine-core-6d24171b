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


function ukFieldMap(header) {
  const normalized = header.map((value) => String(value).replace(/^\uFEFF/, "").trim());
  return new Map(normalized.map((value, index) => [value, index]));
}

function ukCell(row, fields, name) {
  const index = fields.get(name);
  return typeof index === "number" ? String(row[index] ?? "").trim() : "";
}

function xmlAttribute(tag, name) {
  const match = String(tag).match(new RegExp(name + "=['\\\"]([^'\\\"]*)['\\\"]", "i"));
  return match ? decodeXml(match[1]) : "";
}

export function parseEuFsfEntities(xml) {
  const source = String(xml ?? "");
  const blocks = source.match(/<sanctionEntity(?:\s[^>]*)?>[\s\S]*?<\/sanctionEntity>/gi) || [];
  const records = [];

  for (const block of blocks) {
    const openTag = block.match(/<sanctionEntity(?:\s[^>]*)?>/i)?.[0] || "";
    const subjectTag = block.match(/<subjectType(?:\s[^>]*)?\/?>/i)?.[0] || "";
    const subjectCode = xmlAttribute(subjectTag, "code").toLowerCase();
    const classificationCode = xmlAttribute(subjectTag, "classificationCode").toUpperCase();

    const looksLikeEntity =
      classificationCode === "E" ||
      ["enterprise", "entity", "organisation", "organization", "company"].includes(subjectCode);
    if (!looksLikeEntity) continue;

    const names = [];
    const nameTags = block.match(/<nameAlias(?:\s[^>]*)?\/?>/gi) || [];
    for (const nameTag of nameTags) {
      const wholeName = xmlAttribute(nameTag, "wholeName");
      const constructed = [
        xmlAttribute(nameTag, "firstName"),
        xmlAttribute(nameTag, "middleName"),
        xmlAttribute(nameTag, "lastName"),
      ].filter(Boolean).join(" ").trim();
      const name = wholeName || constructed;
      if (name) names.push(name);
    }

    const uniqueNames = unique(names);
    if (!uniqueNames.length) continue;

    const regulationTags = block.match(/<regulation(?:\s[^>]*)?>/gi) || [];
    const programs = unique(regulationTags.map((tag) => xmlAttribute(tag, "programme")).filter(Boolean));

    const euReferenceNumber = xmlAttribute(openTag, "euReferenceNumber");
    const unitedNationId = xmlAttribute(openTag, "unitedNationId");
    const logicalId = xmlAttribute(openTag, "logicalId");

    records.push({
      source: "eu_sanctions",
      source_authority: "European Commission",
      record_id: euReferenceNumber || logicalId || null,
      primary_name: uniqueNames[0],
      aliases: uniqueNames.slice(1),
      identifiers: unique([euReferenceNumber, unitedNationId]),
      programs,
    });
  }

  return records;
}

export function parseUkSanctionsCsv(csv) {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];

  const fields = ukFieldMap(rows[0]);
  const required = ["Unique ID", "Name 6", "Name type", "Individual, Entity, Ship"];
  if (required.some((field) => !fields.has(field))) return [];

  const grouped = new Map();

  for (const row of rows.slice(1)) {
    const kind = ukCell(row, fields, "Individual, Entity, Ship").toLowerCase();
    if (kind !== "entity") continue;

    const uniqueId = ukCell(row, fields, "Unique ID");
    const name = ukCell(row, fields, "Name 6");
    const nameType = ukCell(row, fields, "Name type").toLowerCase();
    if (!uniqueId || !name) continue;

    const existing = grouped.get(uniqueId) || {
      source: "uk_sanctions",
      source_authority: "UK Foreign, Commonwealth & Development Office",
      record_id: uniqueId,
      primary_name: "",
      aliases: [],
      identifiers: [],
      programs: [],
    };

    if (nameType === "primary name" || (!existing.primary_name && !nameType)) {
      existing.primary_name = name;
    } else if (nameType === "alias" || nameType === "primary name variation") {
      existing.aliases.push(name);
    } else if (!existing.primary_name) {
      existing.primary_name = name;
    }

    const businessRegistration = ukCell(row, fields, "Business registration number (s)");
    const nationalIdentifier = ukCell(row, fields, "National Identifier number");
    const regime = ukCell(row, fields, "Regime Name");
    if (businessRegistration) existing.identifiers.push(businessRegistration);
    if (nationalIdentifier) existing.identifiers.push(nationalIdentifier);
    if (regime) existing.programs.push(regime);

    grouped.set(uniqueId, existing);
  }

  return [...grouped.values()]
    .filter((record) => record.primary_name)
    .map((record) => ({
      ...record,
      aliases: unique(record.aliases),
      identifiers: unique(record.identifiers),
      programs: unique(record.programs),
    }));
}

function parseCsvRows(csv) {
  const source = String(csv ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => String(value).length > 0)) rows.push(row);
  return rows;
}

function rowObject(headers, values) {
  const record = {};
  for (let index = 0; index < headers.length; index += 1) {
    record[String(headers[index] ?? "").trim()] = String(values[index] ?? "").trim();
  }
  return record;
}

export function parseUkSanctionsCsv(csv) {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];

  const headers = rows[0].map((value) => String(value).trim());
  const required = ["Unique ID", "Name 6", "Name type", "Individual, Entity, Ship"];
  if (!required.every((field) => headers.includes(field))) return [];

  const grouped = new Map();

  for (const values of rows.slice(1)) {
    const row = rowObject(headers, values);
    if (String(row["Individual, Entity, Ship"] || "").trim().toLowerCase() !== "entity") continue;

    const id = String(row["Unique ID"] || "").trim();
    const name = String(row["Name 6"] || "").trim();
    const nameType = String(row["Name type"] || "").trim().toLowerCase();
    if (!id || !name) continue;

    const existing = grouped.get(id) || {
      source: "uk_sanctions",
      source_authority: "UK Foreign, Commonwealth & Development Office",
      record_id: id,
      primary_name: null,
      aliases: [],
      identifiers: [],
      programs: [],
    };

    if (nameType === "primary name" || nameType === "primary name variation") {
      if (!existing.primary_name || nameType === "primary name") existing.primary_name = name;
      if (nameType === "primary name variation" && existing.primary_name !== name) existing.aliases.push(name);
    } else if (nameType === "alias") {
      existing.aliases.push(name);
    } else if (!existing.primary_name) {
      existing.primary_name = name;
    }

    const businessRegistration = String(row["Business registration number (s)"] || "").trim();
    if (businessRegistration) existing.identifiers.push(businessRegistration);

    const unRef = String(row["UN Reference Number"] || "").trim();
    if (unRef) existing.identifiers.push(unRef);

    const regime = String(row["Regime Name"] || "").trim();
    if (regime) existing.programs.push(regime);

    grouped.set(id, existing);
  }

  return [...grouped.values()]
    .filter((record) => record.primary_name)
    .map((record) => ({
      ...record,
      aliases: unique(record.aliases),
      identifiers: unique(record.identifiers),
      programs: unique(record.programs),
    }));
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
