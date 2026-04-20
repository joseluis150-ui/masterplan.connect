// User-level UX preference for number formatting.
// Stored in localStorage so renders pick it up synchronously without
// waiting for the project record to hydrate.
//
//   "es" → 1.234,56  (dot thousands, comma decimal — Spanish/Latam)
//   "en" → 1,234.56  (comma thousands, dot decimal — English)

type NumberLocale = "es" | "en";
const KEY = "numberLocale";
const DEFAULT: NumberLocale = "es";

export function setNumberLocale(locale: NumberLocale) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, locale);
  // Notify listeners in the same tab (storage event only fires cross-tab)
  window.dispatchEvent(new CustomEvent("number-locale-changed", { detail: locale }));
}

export function getNumberLocale(): NumberLocale {
  if (typeof window === "undefined") return DEFAULT;
  const stored = localStorage.getItem(KEY);
  return stored === "es" || stored === "en" ? stored : DEFAULT;
}

// Convenience helpers that honor the current locale
export function fmtNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(getNumberLocale(), opts);
}

export function fmtInt(n: number): string {
  return fmtNumber(n, { maximumFractionDigits: 0 });
}

export function fmtMoney(n: number, decimals = 2): string {
  return fmtNumber(n, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
