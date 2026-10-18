// Navigation contract: use real ISO3 country identities; region strings are hints,
// never silently promoted into persisted administrative-region IDs.
export const iso3Of = (value) =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value.trim().toUpperCase())
    ? value.trim().toUpperCase() : null;

export const countryDeepDivePath = (iso3) => {
  const code = iso3Of(iso3);
  return code ? `/deepdive/${code}` : null;
};

export const resolutionCountryPath = (iso3) => {
  const code = iso3Of(iso3);
  return code ? `/resolution?country=${encodeURIComponent(code)}` : null;
};

export const resolutionRegionPath = (iso3, regionName) => {
  const country = iso3Of(iso3);
  if (!country || typeof regionName !== "string") return null;
  const region = regionName.trim();
  if (!region || region.length > 120) return null;
  return `/resolution?country=${encodeURIComponent(country)}&regionName=${encodeURIComponent(region)}`;
};
