// Lightweight i18n scaffold. Real translation lives in /src/lib/i18n/<locale>.ts.
// Phase A: extract strings via t(). Phase B: wire to react-i18next or similar.

import { en } from "./en";

export type Locale = "en" | "fr" | "de" | "it" | "ja";

const STORAGE_KEY = "aicis:locale";

const dictionaries: Record<Locale, Record<string, string>> = {
  en,
  fr: {}, // stub — falls back to en
  de: {},
  it: {},
  ja: {},
};

export function getLocale(): Locale {
  if (typeof window === "undefined") return "en";
  return (localStorage.getItem(STORAGE_KEY) as Locale) || "en";
}

export function setLocale(loc: Locale) {
  try { localStorage.setItem(STORAGE_KEY, loc); } catch {}
  document.documentElement.lang = loc;
}

export function t(key: string, fallback?: string): string {
  const loc = getLocale();
  return dictionaries[loc]?.[key] || dictionaries.en[key] || fallback || key;
}

export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
];
