// AICIS market evidence comparator v1 — observation-only, never an MPI or forecast.
// Do not infer market attractiveness, causal effects, source independence, or probability.
const PERIOD = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?(?:-(?:0[1-9]|[12]\d|3[01]))?$/;
const iso = (value) => typeof value === "string" ? value.trim().toUpperCase() : "";
const clean = (value) => typeof value === "string" ? value.trim() : "";
const keyOf = (row) => clean(row.metric_name).toLocaleLowerCase("en");
const alignedKey = (row) => [clean(row.period), clean(row.provider_name).toLocaleLowerCase("en"), clean(row.unit)].join("\u0000");
const valid = (row) => !!row && typeof row.value === "number" && Number.isFinite(row.value)
  && PERIOD.test(clean(row.period)) && !!clean(row.unit)
  && !!clean(row.provider_name) && !/^(unknown|unverified|n\/a)$/i.test(clean(row.provider_name))
  && !!keyOf(row);

function observation(row) {
  return {
    value: row.value,
    unit: clean(row.unit) || null,
    period: clean(row.period),
    provider: clean(row.provider_name),
    provenance: clean(row.provenance_source) || null,
    observedAt: clean(row.provenance_observed_at) || null,
    verifiedAt: clean(row.last_verified_at) || null,
  };
}

// Note: a row exists without an authoritative source identity if provider_name is absent.
// The comparable state must then remain unavailable, not silently scored.
export function buildMarketEvidenceComparison({ countryA, countryB, rowsA = [], rowsB = [], maxIndicators = 8 }) {
  const a = iso(countryA), b = iso(countryB);
  if (!/^[A-Z]{3}$/.test(a) || !/^[A-Z]{3}$/.test(b) || a === b) {
    throw new Error("Two distinct ISO3 countries are required");
  }
  const selected = (rows, country) => Array.isArray(rows)
    ? rows.filter((r) => r && iso(r.iso3) === country && keyOf(r))
    : [];
  const left = selected(rowsA, a), right = selected(rowsB, b);
  const groups = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const key = keyOf(row);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  };
  const A = groups(left), B = groups(right);
  const names = [...new Set([...A.keys(), ...B.keys()])].sort();
  const result = names.map((name) => {
    const aa = A.get(name) || [], bb = B.get(name) || [];
    const label = [...aa, ...bb].map((r) => clean(r.metric_name)).sort()[0] || name;
    const goodA = aa.filter(valid), goodB = bb.filter(valid);
    const indexB = new Map();
    for (const row of goodB) {
      const k = alignedKey(row);
      if (!indexB.has(k)) indexB.set(k, []);
      indexB.get(k).push(row);
    }
    const matches = [];
    for (const row of goodA) {
      const hits = indexB.get(alignedKey(row)) || [];
      for (const other of hits) matches.push([row, other]);
    }
    matches.sort((x, y) => y[0].period.localeCompare(x[0].period)
      || alignedKey(x[0]).localeCompare(alignedKey(y[0])));
    const first = matches[0];
    // Multiple records for the latest shared vintage+provider+unit are not silently resolved.
    const newestMatches = first ? matches.filter((pair) => alignedKey(pair[0]) === alignedKey(first[0])) : [];
    const state = first
      ? newestMatches.length === 1 ? "comparable" : "ambiguous"
      : !aa.length || !bb.length ? "missing_country"
      : !goodA.length || !goodB.length ? "invalid_evidence" : "not_aligned";
    return {
      metric: label,
      state,
      // Values are exposed only for an unambiguous same-provider, same-period, same-unit pair.
      countryA: state === "comparable" ? observation(first[0]) : null,
      countryB: state === "comparable" ? observation(first[1]) : null,
      note: {
        comparable: "Matched provider, period and unit; descriptive observation only.",
        ambiguous: "Multiple records match the latest shared vintage; verification required.",
        missing_country: "One country has no visible observation in the sampled rows.",
        invalid_evidence: "A value, period or provider identity is missing or invalid.",
        not_aligned: "No matching provider, period and unit in the visible samples.",
      }[state],
    };
  });
  const capped = Math.min(Math.max(Number.isInteger(maxIndicators) ? maxIndicators : 8, 1), 20);
  // Prioritize comparable indicators but always show failures: coverage is part of the result.
  const rows = result.sort((x, y) => Number(y.state === "comparable") - Number(x.state === "comparable")
    || x.metric.localeCompare(y.metric)).slice(0, capped);
  return {
    countryA: a,
    countryB: b,
    indicators: rows,
    availableIndicatorGroups: result.length,
    displayedIndicatorGroups: rows.length,
    // Never describe this as a complete country assessment or a market-potential index.
    method: "same metric + same reporting period + same provider + same unit; descriptive only",
    hasMarketPotentialScore: false,
    hasForecast: false,
  };
}
