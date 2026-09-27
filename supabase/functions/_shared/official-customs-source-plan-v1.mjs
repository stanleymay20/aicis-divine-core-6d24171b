
export const OFFICIAL_CUSTOMS_SOURCE_PLAN_VERSION = "aicis-official-customs-source-plan-v1";

const ISO3 = /^[A-Z]{3}$/;
const HS = /^[0-9]{6,10}$/;
const clean = (value) => String(value ?? "").trim();
const upper = (value) => clean(value).toUpperCase();
const normalizeHs = (value) => clean(value).replace(/[^0-9]/g, "");

const EU_ISO3 = new Set([
  "AUT","BEL","BGR","HRV","CYP","CZE","DNK","EST","FIN","FRA","DEU","GRC","HUN","IRL",
  "ITA","LVA","LTU","LUX","MLT","NLD","POL","PRT","ROU","SVK","SVN","ESP","SWE",
]);

const SOURCES = Object.freeze({
  eu_taric: {
    source_id: "eu_taric",
    authority: "European Commission — DG TAXUD",
    jurisdiction: "European Union",
    source_type: "official_customs_tariff",
    consultation_url: "https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp",
    overview_url: "https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-customs/eu-customs-tariff-taric_en",
    extraction_explanation_url: "https://circabc.europa.eu/sd/a/3d892b27-176f-4b8c-bbf5-4e0ee63f7e5a/Explanation%20for%20the%20Taric%20database%20extractions.pdf",
    covers: [
      "eu_common_customs_tariff",
      "third_country_duty",
      "tariff_preferences",
      "tariff_suspensions",
      "tariff_quotas",
      "trade_defence_measures",
      "eu_import_export_controls",
      "goods_nomenclature",
    ],
    landed_cost_categories: ["import_duty", "export_duty_tax", "export_customs"],
    explicitly_not_covered: ["national_vat", "national_excise"],
    freshness: {
      online_consultation: "official_current_view_updated_on_commission_working_days",
      raw_extractions: "monthly_reference_snapshot_plus_daily_update_files",
    },
    automated_rate_extraction_enabled: false,
    execution_eligible_by_itself: false,
    legal_interpretation_required: true,
  },
  de_ezt: {
    source_id: "de_ezt",
    authority: "German Customs Administration — Generalzolldirektion",
    jurisdiction: "Germany",
    source_type: "official_national_customs_tariff",
    consultation_url: "https://auskunft.ezt-online.de/ezto/",
    help_url: "https://auskunft.ezt-online.de/online_help_ezto/ezto/allgemeines.htm",
    covers: [
      "taric_based_customs_measures",
      "german_national_customs_rules",
      "german_import_vat_rate_display",
      "german_excise_information",
    ],
    landed_cost_categories: ["import_duty", "import_tax", "export_customs", "export_duty_tax"],
    explicitly_not_covered: [],
    freshness: {
      national_system: "uses_taric_updates_and_german_national_rules",
    },
    automated_rate_extraction_enabled: false,
    execution_eligible_by_itself: false,
    legal_interpretation_required: true,
  },
});

function sourceTask(source, categories, reason) {
  return {
    ...source,
    requested_categories: categories,
    reason,
    status: "ready_manual_official_source",
    research_only: true,
    transaction_eligible: false,
    rate_extracted: false,
    legal_determination_made: false,
  };
}

export function planOfficialCustomsSources(input = {}) {
  const origin = upper(input.origin_country);
  const destination = upper(input.destination_country);
  const hsCode = normalizeHs(input.hs_code);
  const reasons = [];

  if (!ISO3.test(origin)) reasons.push("origin_country_invalid");
  if (!ISO3.test(destination)) reasons.push("destination_country_invalid");

  const classificationReady = HS.test(hsCode);
  const sources = [];
  const blockers = [];

  if (!classificationReady) {
    blockers.push({
      kind: "verify_tariff_classification",
      priority: "blocking",
      reason: "A 6–10 digit HS/CN/TARIC-compatible goods classification is required before a tariff rate can be treated as applicable.",
      research_only: true,
      transaction_eligible: false,
      automatic_classification_allowed: false,
    });
  }

  const originInEu = EU_ISO3.has(origin);
  const destinationInEu = EU_ISO3.has(destination);

  if (destinationInEu) {
    sources.push(sourceTask(
      SOURCES.eu_taric,
      ["import_duty"],
      "EU common-tariff and trade-policy measures for imports into an EU Member State.",
    ));

    if (destination === "DEU") {
      sources.push(sourceTask(
        SOURCES.de_ezt,
        ["import_tax", "import_duty"],
        "German EZT augments TARIC with German national customs information, including import VAT/excise displays.",
      ));
    } else {
      blockers.push({
        kind: "national_import_tax_source_required",
        priority: "blocking",
        jurisdiction: destination,
        categories: ["import_tax"],
        reason: "TARIC does not contain national VAT/excise rates; an official destination-country source is required.",
        provider_status: "not_configured_for_this_member_state",
        research_only: true,
        transaction_eligible: false,
      });
    }
  }

  if (originInEu) {
    sources.push(sourceTask(
      SOURCES.eu_taric,
      ["export_customs", "export_duty_tax"],
      "EU TARIC contains export measures and controls relevant to goods leaving the EU.",
    ));
  } else if (!destinationInEu) {
    blockers.push({
      kind: "national_customs_source_required",
      priority: "blocking",
      jurisdiction: destination,
      categories: ["import_duty", "import_tax"],
      reason: "No official national tariff/tax adapter is configured for this non-EU destination.",
      provider_status: "not_configured",
      research_only: true,
      transaction_eligible: false,
    });
  }

  const uniqueSources = [...new Map(sources.map((source) => [source.source_id + ":" + source.requested_categories.join(","), source])).values()];

  return {
    plan_version: OFFICIAL_CUSTOMS_SOURCE_PLAN_VERSION,
    valid_request: reasons.length === 0,
    reasons,
    origin_country: ISO3.test(origin) ? origin : null,
    destination_country: ISO3.test(destination) ? destination : null,
    hs_code: classificationReady ? hsCode : null,
    classification_ready: classificationReady,
    sources: uniqueSources,
    blockers,
    automated_rate_extraction_performed: false,
    customs_rate: null,
    tax_rate: null,
    transaction_eligible: false,
    legal_determination_made: false,
    execution_boundary: {
      customs_declaration_filed: false,
      tariff_treatment_claimed: false,
      tax_recoverability_claimed: false,
      payment_made: false,
    },
    semantics: blockers.length
      ? "official_source_plan_with_unresolved_legal_or_provider_dependencies"
      : "official_source_plan_research_only_no_rate_extraction",
    scope_notice: "This plan identifies official research sources only. It does not determine classification, origin preference, tariff applicability, customs value, national tax treatment, or a payable duty amount.",
  };
}
