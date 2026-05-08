import isoCountries from "./iso-countries.json";

const ISO3_TO_ISO2: Record<string, string> = (isoCountries as any[]).reduce(
  (acc, c) => {
    if (c.iso3 && c.iso2) acc[c.iso3.toUpperCase()] = c.iso2.toUpperCase();
    return acc;
  },
  {} as Record<string, string>
);

// Utility to get country flag emoji from ISO2 code
export function getCountryFlag(iso2: string): string {
  if (!iso2 || iso2.length !== 2) return "🌍";
  const codePoints = iso2
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function getCountryFlagFromIso3(iso3: string | null | undefined): string {
  if (!iso3) return "🌍";
  const iso2 = ISO3_TO_ISO2[iso3.toUpperCase()];
  return iso2 ? getCountryFlag(iso2) : "🌍";
}

// Get flag URL (fallback for systems that don't support flag emojis)
export function getCountryFlagUrl(iso2: string): string {
  if (!iso2 || iso2.length !== 2) return "";
  return `https://flagcdn.com/w40/${iso2.toLowerCase()}.png`;
}
