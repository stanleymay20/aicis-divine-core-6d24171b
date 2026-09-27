import { convertVerifiedAmount } from "./verified-fx-v1.mjs";

export const TRANSACTION_PATH_BUILDER_VERSION = "aicis-transaction-path-builder-v1";

const ALLOWED_EVIDENCE_STATUSES = new Set([
  "verified_quote",
  "observed_market",
  "contractually_indicated",
]);

const SHA256 = /^[a-f0-9]{64}$/i;

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const normalize = (value) => String(value ?? "").trim().toLowerCase();

function evidenceRefValid(ref) {
  if (!ref || typeof ref !== "object") return false;
  if (!ref.source_id || !ref.observed_at) return false;
  const observed = Date.parse(ref.observed_at);
  if (!Number.isFinite(observed)) return false;
  if (ref.citation_id) return true;
  if (typeof ref.sha256 === "string" && SHA256.test(ref.sha256)) return true;
  return false;
}

function evidenceSetValid(refs) {
  return Array.isArray(refs) && refs.length > 0 && refs.every(evidenceRefValid);
}

function quoteEvidenceValid(offer, asOfMs) {
  if (!offer || !ALLOWED_EVIDENCE_STATUSES.has(offer.evidence_status)) return false;
  if (!evidenceSetValid(offer.evidence_refs)) return false;
  if (!finite(offer.unit_price) || offer.unit_price < 0) return false;
  if (!offer.currency || !offer.name || !offer.id) return false;
  if (offer.quote_valid_until) {
    const validUntil = Date.parse(offer.quote_valid_until);
    if (!Number.isFinite(validUntil) || validUntil < asOfMs) return false;
  }
  return true;
}

function routeEvidenceValid(route, asOfMs) {
  if (!route?.id || !route.origin_country || !route.destination_country) return false;
  if (!ALLOWED_EVIDENCE_STATUSES.has(route.evidence_status)) return false;
  if (!evidenceSetValid(route.evidence_refs)) return false;
  if (!finite(route.transit_days) || route.transit_days < 0) return false;
  if (route.quote_valid_until) {
    const validUntil = Date.parse(route.quote_valid_until);
    if (!Number.isFinite(validUntil) || validUntil < asOfMs) return false;
  }
  if (!Array.isArray(route.costs)) return false;
  return route.costs.every((cost) =>
    cost &&
    cost.type &&
    finite(cost.amount) &&
    cost.amount >= 0 &&
    (cost.basis === "fixed" || cost.basis === "per_unit") &&
    Boolean(cost.currency) &&
    evidenceSetValid(cost.evidence_refs)
  );
}

function scenarioEvidenceValid(scenario) {
  if (!scenario || scenario.calibration_status !== "validated_input") return false;
  if (!evidenceSetValid(scenario.evidence_refs)) return false;
  if (!finite(scenario.probability_of_completion)) return false;
  if (scenario.probability_of_completion < 0 || scenario.probability_of_completion > 100) return false;
  if (!finite(scenario.downside_loss) || scenario.downside_loss < 0) return false;
  if (!finite(scenario.cycle_days) || scenario.cycle_days <= 0) return false;
  if (scenario.upside_profit != null && (!finite(scenario.upside_profit) || scenario.upside_profit < 0)) return false;
  return true;
}

function structureValid(structure) {
  if (!structure?.transaction_type) return false;
  if (!["full_landed_cost", "explicit"].includes(structure.capital_model)) return false;
  if (structure.capital_model === "explicit" && (!finite(structure.capital_required) || structure.capital_required < 0)) return false;
  if (!Array.isArray(structure.costs)) return false;
  return structure.costs.every((cost) =>
    cost &&
    cost.type &&
    finite(cost.amount) &&
    cost.amount >= 0 &&
    (cost.basis === "fixed" || cost.basis === "per_unit") &&
    Boolean(cost.currency) &&
    evidenceSetValid(cost.evidence_refs)
  );
}

function costValue(cost, quantity) {
  return cost.basis === "per_unit" ? cost.amount * quantity : cost.amount;
}

function sumCosts(costs, quantity, currency, fxRates, asOfIso) {
  let total = 0;
  const breakdown = [];
  const fxConversions = [];
  for (const cost of costs || []) {
    const originalValue = costValue(cost, quantity);
    const converted = convertVerifiedAmount(originalValue, cost.currency, currency, fxRates, asOfIso);
    if (!converted.ok) {
      return { compatible: false, total: null, breakdown: [], fx_conversions: [] };
    }
    total += converted.amount;
    const fxConversion = converted.direction === "identity" ? null : {
      from_currency: converted.from_currency,
      to_currency: converted.to_currency,
      rate: converted.rate,
      direction: converted.direction,
      fx_rate_id: converted.fx_rate_id,
      provider: converted.provider ?? null,
      observed_at: converted.observed_at ?? null,
      evidence_status: converted.evidence_status ?? null,
      execution_eligible_fx: converted.execution_eligible_fx === true,
      evidence_refs: converted.evidence_refs ?? [],
    };
    if (fxConversion) fxConversions.push(fxConversion);
    breakdown.push({
      type: cost.type,
      amount: round(converted.amount),
      currency,
      original_amount: round(originalValue),
      original_currency: cost.currency,
      fx_conversion: fxConversion,
      evidence_refs: cost.evidence_refs,
    });
  }
  return { compatible: true, total: round(total), breakdown, fx_conversions: fxConversions };
}

function quantityFeasible(offer, quantity) {
  if (!finite(quantity) || quantity <= 0) return false;
  if (finite(offer.min_quantity) && quantity < offer.min_quantity) return false;
  if (finite(offer.max_quantity) && quantity > offer.max_quantity) return false;
  return true;
}

function complianceStatus(...items) {
  const statuses = items.map((item) => normalize(item?.compliance_status || "unknown"));
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("unknown") || statuses.includes("")) return "unknown";
  if (statuses.includes("review")) return "review";
  return statuses.every((status) => status === "clear") ? "clear" : "unknown";
}

function economicsStatus(source, buyer, route) {
  const statuses = [source.evidence_status, buyer.evidence_status, route.evidence_status];
  if (statuses.every((status) => status === "verified_quote")) return "verified_quotes";
  if (statuses.includes("contractually_indicated")) return "contractually_indicated";
  if (statuses.every((status) => ALLOWED_EVIDENCE_STATUSES.has(status))) return "observed_market";
  return "insufficient";
}

function minFinite(values, fallback = 50) {
  const numbers = values.filter(finite);
  return numbers.length ? Math.min(...numbers) : fallback;
}

function candidateEvidenceScore(source, buyer, route, scenario, structure) {
  return minFinite([
    source.evidence_score,
    buyer.evidence_score,
    route.evidence_score,
    scenario.evidence_score,
    structure.evidence_score,
  ], 0);
}

function buildContacts(source, buyer, route) {
  return [source.contact, buyer.contact, route.contact]
    .filter((contact) => contact && contact.company && contact.channel)
    .map((contact) => ({
      company: contact.company,
      channel: contact.channel,
      value: contact.value ?? null,
      source: contact.source ?? "public_or_licensed_business_channel",
    }));
}

function routeCompatible(source, buyer, route) {
  return normalize(route.origin_country) === normalize(source.country) &&
    normalize(route.destination_country) === normalize(buyer.country);
}

function identity(source, buyer, route, structure, quantity) {
  return [
    "tx",
    source.id,
    buyer.id,
    route.id,
    structure.transaction_type,
    String(quantity),
  ].map((value) => String(value).replace(/[^a-zA-Z0-9._-]+/g, "-")).join(":");
}

function strategicAlternativeApplies(option, source, buyer, route, structure) {
  if (!option || typeof option !== "object") return false;
  if (option.source_id && String(option.source_id) !== String(source?.id)) return false;
  if (option.buyer_id && String(option.buyer_id) !== String(buyer?.id)) return false;
  if (option.route_id && String(option.route_id) !== String(route?.id)) return false;
  if (option.transaction_type && normalize(option.transaction_type) !== normalize(structure?.transaction_type)) return false;
  return true;
}

function scopedStrategicAlternatives(input, key, source, buyer, route, structure) {
  const values = Array.isArray(input?.[key]) ? input[key] : [];
  return values.filter((option) => strategicAlternativeApplies(option, source, buyer, route, structure));
}

function sourceOfferSummary(source, quantity) {
  return {
    id: source.id,
    name: source.name,
    country: source.country,
    region: source.region ?? null,
    unit_price: source.unit_price,
    currency: source.currency,
    quantity,
    incoterm: source.incoterm ?? null,
    quote_valid_until: source.quote_valid_until ?? null,
    evidence_status: source.evidence_status,
    evidence_refs: source.evidence_refs,
  };
}

function saleOfferSummary(buyer, quantity) {
  return {
    id: buyer.id,
    name: buyer.name,
    country: buyer.country,
    region: buyer.region ?? null,
    unit_price: buyer.unit_price,
    currency: buyer.currency,
    quantity,
    incoterm: buyer.incoterm ?? null,
    quote_valid_until: buyer.quote_valid_until ?? null,
    evidence_status: buyer.evidence_status,
    evidence_refs: buyer.evidence_refs,
  };
}

function nextActions(source, buyer, route, compliance) {
  const actions = [
    `Reconfirm supplier quote ${source.id} before commitment.`,
    `Reconfirm buyer quote ${buyer.id} before commitment.`,
    `Reconfirm route quote ${route.id} and capacity before commitment.`,
  ];
  if (compliance === "review") actions.push("Complete outstanding compliance review before execution.");
  actions.push("Recalculate economics immediately before approval.");
  actions.push("Require explicit human approval before any order, contract, payment, or broker instruction.");
  return actions;
}

export function buildTransactionPaths(input = {}) {
  const asOf = input.as_of ? Date.parse(input.as_of) : Date.now();
  if (!Number.isFinite(asOf)) {
    return {
      builder_version: TRANSACTION_PATH_BUILDER_VERSION,
      candidates: [],
      rejected_paths: [{ reason: "invalid_as_of" }],
      build_warnings: ["Input as_of timestamp is invalid."],
    };
  }

  const product = input.product || {};
  const quantity = Number(input.quantity);
  const sources = Array.isArray(input.source_offers) ? input.source_offers : [];
  const buyers = Array.isArray(input.sale_offers) ? input.sale_offers : [];
  const routes = Array.isArray(input.routes) ? input.routes : [];
  const structures = Array.isArray(input.structures) ? input.structures : [];
  const scenario = input.scenario || null;
  const fxRates = Array.isArray(input.fx_rates) ? input.fx_rates : [];
  const requestedComparisonCurrency = String(input.comparison_currency || "").trim().toUpperCase();
  const asOfIso = new Date(asOf).toISOString();

  const candidates = [];
  const rejected = [];
  const warnings = [];

  if (!product.id || !product.name || !product.unit) warnings.push("Product identity/unit is incomplete.");
  if (!finite(quantity) || quantity <= 0) warnings.push("Quantity must be a positive number.");
  if (!scenarioEvidenceValid(scenario)) warnings.push("Scenario inputs are not validated; no path can be rankable.");

  for (const source of sources) {
    for (const buyer of buyers) {
      for (const route of routes) {
        for (const structure of structures) {
          const pathKey = [source?.id, buyer?.id, route?.id, structure?.transaction_type].join("|");
          const reasons = [];

          if (!product.id || !product.name || !product.unit) reasons.push("product_incomplete");
          if (!finite(quantity) || quantity <= 0) reasons.push("quantity_invalid");
          if (!quoteEvidenceValid(source, asOf)) reasons.push("source_offer_not_verified_or_expired");
          if (!quoteEvidenceValid(buyer, asOf)) reasons.push("sale_offer_not_verified_or_expired");
          if (!routeEvidenceValid(route, asOf)) reasons.push("route_not_verified_or_expired");
          if (!structureValid(structure)) reasons.push("structure_invalid");
          if (!scenarioEvidenceValid(scenario)) reasons.push("scenario_not_validated");
          if (!quantityFeasible(source, quantity)) reasons.push("source_quantity_infeasible");
          if (!quantityFeasible(buyer, quantity)) reasons.push("buyer_quantity_infeasible");
          if (!routeCompatible(source, buyer, route)) reasons.push("route_geography_mismatch");

          const pathCurrencies = [
            source?.currency,
            buyer?.currency,
            ...(Array.isArray(route?.costs) ? route.costs.map((cost) => cost?.currency) : []),
            ...(Array.isArray(structure?.costs) ? structure.costs.map((cost) => cost?.currency) : []),
          ].filter(Boolean).map((value) => String(value).trim().toUpperCase());
          const uniqueCurrencies = [...new Set(pathCurrencies)];
          const currency = requestedComparisonCurrency || (uniqueCurrencies.length === 1 ? uniqueCurrencies[0] : "");
          if (!currency) reasons.push("comparison_currency_required_for_mixed_currency_path");

          const sourceGross = finite(source?.unit_price) ? source.unit_price * quantity : NaN;
          const buyerGross = finite(buyer?.unit_price) ? buyer.unit_price * quantity : NaN;
          const sourceConversion = currency
            ? convertVerifiedAmount(sourceGross, source?.currency, currency, fxRates, asOfIso)
            : { ok: false };
          const buyerConversion = currency
            ? convertVerifiedAmount(buyerGross, buyer?.currency, currency, fxRates, asOfIso)
            : { ok: false };
          if (!sourceConversion.ok) reasons.push("source_fx_missing_or_unverified");
          if (!buyerConversion.ok) reasons.push("buyer_fx_missing_or_unverified");

          const routeCosts = routeEvidenceValid(route, asOf) && currency
            ? sumCosts(route.costs, quantity, currency, fxRates, asOfIso)
            : { compatible: false };
          if (!routeCosts.compatible) reasons.push("route_cost_fx_missing_or_unverified");

          const structureCosts = structureValid(structure) && currency
            ? sumCosts(structure.costs, quantity, currency, fxRates, asOfIso)
            : { compatible: false };
          if (!structureCosts.compatible) reasons.push("structure_cost_fx_missing_or_unverified");

          const explicitCapitalConversion = structure?.capital_model === "explicit" && currency
            ? convertVerifiedAmount(
                structure.capital_required,
                structure.capital_currency || currency,
                currency,
                fxRates,
                asOfIso,
              )
            : null;
          if (structure?.capital_model === "explicit" && !explicitCapitalConversion?.ok) {
            reasons.push("explicit_capital_fx_missing_or_unverified");
          }

          if (reasons.length) {
            rejected.push({ path_key: pathKey, reasons: [...new Set(reasons)] });
            continue;
          }

          const purchaseCost = sourceConversion.amount;
          const expectedRevenue = buyerConversion.amount;
          const expectedCost = purchaseCost + routeCosts.total + structureCosts.total;
          const capitalRequired = structure.capital_model === "explicit"
            ? explicitCapitalConversion.amount
            : expectedCost;
          const fxConversions = [
            sourceConversion,
            buyerConversion,
            ...(routeCosts.fx_conversions || []),
            ...(structureCosts.fx_conversions || []),
            ...(explicitCapitalConversion ? [explicitCapitalConversion] : []),
          ].filter((conversion) => conversion?.direction && conversion.direction !== "identity")
            .map((conversion) => ({
              from_currency: conversion.from_currency,
              to_currency: conversion.to_currency,
              rate: conversion.rate,
              direction: conversion.direction,
              fx_rate_id: conversion.fx_rate_id ?? null,
              provider: conversion.provider ?? null,
              observed_at: conversion.observed_at ?? null,
              evidence_status: conversion.evidence_status ?? null,
              execution_eligible_fx: conversion.execution_eligible_fx === true,
              evidence_refs: conversion.evidence_refs ?? [],
            }));
          const compliance = complianceStatus(source, buyer, route, structure);
          const evidenceScore = candidateEvidenceScore(source, buyer, route, scenario, structure);
          const contacts = buildContacts(source, buyer, route);
          const routeLabels = Array.isArray(route.stops) && route.stops.length
            ? route.stops
            : [source.country, buyer.country];

          candidates.push({
            id: identity(source, buyer, route, structure, quantity),
            source_signal_id: input.signal?.id ?? null,
            title: `${product.name}: ${source.name} → ${buyer.name}`,
            summary: `${quantity} ${product.unit} via ${route.name || route.id}; generated only from supplied verified inputs.`,
            transaction_type: structure.transaction_type,
            domain: input.signal?.domain ?? product.domain ?? "trade",
            sectors: product.sectors ?? input.signal?.sectors ?? [],
            countries: [...new Set([source.country, buyer.country].filter(Boolean))],
            regions: [...new Set([source.region, buyer.region].filter(Boolean))],
            entities: [source.name, buyer.name, route.name].filter(Boolean),
            tags: product.tags ?? [],
            quantity,
            unit: product.unit,
            currency,
            capital_required: round(capitalRequired),
            expected_revenue: round(expectedRevenue),
            expected_cost: round(expectedCost),
            downside_loss: scenario.downside_loss,
            upside_profit: scenario.upside_profit ?? null,
            cycle_days: scenario.cycle_days,
            probability_of_completion: scenario.probability_of_completion,
            evidence_score: round(evidenceScore, 1),
            counterparty_quality_score: round(minFinite([
              source.counterparty_quality_score,
              buyer.counterparty_quality_score,
            ]), 1),
            liquidity_score: round(minFinite([
              source.liquidity_score,
              buyer.liquidity_score,
              route.capacity_score,
            ]), 1),
            compliance_status: compliance,
            economics_status: economicsStatus(source, buyer, route),
            market_freshness_minutes: finite(input.market_freshness_minutes)
              ? input.market_freshness_minutes
              : null,
            source_offer: sourceOfferSummary(source, quantity),
            sale_offer: saleOfferSummary(buyer, quantity),
            counterparties: [
              {
                role: "supplier",
                id: source.id,
                name: source.name,
                country: source.country,
                compliance_status: source.compliance_status,
                official_website: source.official_website ?? null,
              },
              {
                role: "buyer",
                id: buyer.id,
                name: buyer.name,
                country: buyer.country,
                compliance_status: buyer.compliance_status,
                official_website: buyer.official_website ?? null,
              },
            ],
            route: routeLabels,
            logistics: {
              route_id: route.id,
              route_name: route.name ?? null,
              transit_days: route.transit_days,
              provider: route.provider ?? null,
              quote_valid_until: route.quote_valid_until ?? null,
              evidence_refs: route.evidence_refs,
            },
            settlement: structure.settlement ?? null,
            timing: {
              as_of: asOfIso,
    comparison_currency: requestedComparisonCurrency || null,
    fx_rates_supplied: fxRates.length,
              supplier_quote_valid_until: source.quote_valid_until ?? null,
              buyer_quote_valid_until: buyer.quote_valid_until ?? null,
              route_quote_valid_until: route.quote_valid_until ?? null,
              expected_cycle_days: scenario.cycle_days,
            },
            contacts,
            next_actions: nextActions(source, buyer, route, compliance),
            cost_breakdown: [
              {
                type: "purchase",
                amount: round(purchaseCost),
                currency,
                original_amount: round(sourceGross),
                original_currency: source.currency,
                fx_conversion: sourceConversion.direction === "identity" ? null : {
                  from_currency: sourceConversion.from_currency,
                  to_currency: sourceConversion.to_currency,
                  rate: sourceConversion.rate,
                  direction: sourceConversion.direction,
                  fx_rate_id: sourceConversion.fx_rate_id ?? null,
                  provider: sourceConversion.provider ?? null,
                  observed_at: sourceConversion.observed_at ?? null,
                  evidence_status: sourceConversion.evidence_status ?? null,
                  execution_eligible_fx: sourceConversion.execution_eligible_fx === true,
                  evidence_refs: sourceConversion.evidence_refs ?? [],
                },
                evidence_refs: source.evidence_refs,
              },
              ...routeCosts.breakdown,
              ...structureCosts.breakdown,
            ],
            evidence_manifest: {
              source_offer: source.evidence_refs,
              sale_offer: buyer.evidence_refs,
              route: route.evidence_refs,
              scenario: scenario.evidence_refs,
              structure: structure.evidence_refs ?? [],
              fx: fxConversions.flatMap((conversion) => conversion.evidence_refs || []),
            },
            fx_conversions: fxConversions,
            fx_execution_ready: fxConversions.every((conversion) => conversion.execution_eligible_fx === true),
            required_capabilities: Array.isArray(structure.required_capabilities) ? structure.required_capabilities : [],
            invalidation_rules: [
              ...(Array.isArray(input.invalidation_rules) ? input.invalidation_rules : []),
              ...(Array.isArray(structure.invalidation_rules) ? structure.invalidation_rules : []),
            ],
            switching_rules: [
              ...(Array.isArray(input.switching_rules) ? input.switching_rules : []),
              ...(Array.isArray(structure.switching_rules) ? structure.switching_rules : []),
            ],
            scenarios: Array.isArray(input.strategic_scenarios) ? input.strategic_scenarios : [],
            no_action_scenarios: Array.isArray(input.no_action_scenarios) ? input.no_action_scenarios : [],
            indirect_strategies: scopedStrategicAlternatives(input, "indirect_strategies", source, buyer, route, structure),
            position_options: scopedStrategicAlternatives(input, "position_options", source, buyer, route, structure),
            information_actions: scopedStrategicAlternatives(input, "information_actions", source, buyer, route, structure),
            builder_version: TRANSACTION_PATH_BUILDER_VERSION,
            candidate_scope_notice: "Constructed only from the supplied source offers, sale offers, routes and transaction structures.",
          });
        }
      }
    }
  }

  return {
    builder_version: TRANSACTION_PATH_BUILDER_VERSION,
    as_of: new Date(asOf).toISOString(),
    product: {
      id: product.id ?? null,
      name: product.name ?? null,
      unit: product.unit ?? null,
    },
    requested_quantity: finite(quantity) ? quantity : null,
    supplied_counts: {
      source_offers: sources.length,
      sale_offers: buyers.length,
      routes: routes.length,
      structures: structures.length,
    },
    candidates,
    rejected_paths: rejected,
    build_warnings: warnings,
    scope_notice: "Candidate generation is exhaustive only across the supplied inputs, not across all companies, routes or markets worldwide.",
  };
}
