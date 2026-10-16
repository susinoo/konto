// Locale-aware display formatting. The language comes from i18next, the
// currency from the instance configuration (/api/config). Amounts are integer
// cents and dates ISO "YYYY-MM-DD" strings everywhere else in the app.
import i18n from "../i18n";

let currency = "EUR";

// Called once at startup with the currency from /api/config.
export function setCurrency(code) {
  if (code) currency = code;
}

function language() {
  return i18n.resolvedLanguage || "en";
}

const formatterCache = new Map();
function cached(kind, options, create) {
  const key = `${kind}|${language()}|${currency}|${JSON.stringify(options)}`;
  if (!formatterCache.has(key)) formatterCache.set(key, create());
  return formatterCache.get(key);
}

// Integer cents → "€1,234.50" (en) / "1.234,50 €" (it).
// `wholeUnits` drops the decimals (used by the yearly Analytics view).
// useGrouping "always": Italian would otherwise skip the separator below
// 10,000 ("3200,00 €" next to "22.778,31 €").
export function formatMoney(cents, { wholeUnits = false } = {}) {
  const options = {
    style: "currency",
    currency,
    useGrouping: "always",
    ...(wholeUnits && { maximumFractionDigits: 0 }),
  };
  const formatter = cached("money", options, () => new Intl.NumberFormat(language(), options));
  return formatter.format((Number(cents) || 0) / 100);
}

// "." or "," in the UI language, for amounts shown in text inputs.
export function decimalSeparator() {
  const formatter = cached("decimal", {}, () => new Intl.NumberFormat(language()));
  return formatter.formatToParts(1.5).find((part) => part.type === "decimal")?.value ?? ".";
}

// "€", "$", "CHF"... for input labels.
export function currencySymbol() {
  const formatter = cached("symbol", {}, () =>
    new Intl.NumberFormat(language(), { style: "currency", currency }),
  );
  return formatter.formatToParts(0).find((part) => part.type === "currency")?.value ?? currency;
}

// Today as a local "YYYY-MM-DD" (the default date of new transactions).
export function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Short date style per language: "Oct 15, 2026" (en) / "15/10/26" (it).
const DATE_STYLES = {
  en: { month: "short", day: "numeric", year: "numeric" },
  it: { day: "2-digit", month: "2-digit", year: "2-digit" },
};

// "2026-10-15" → localized date. Parsed as a local date (not UTC), so the day
// never shifts with the time zone.
export function formatDate(isoDate) {
  const [year, month, day] = String(isoDate ?? "").split("-").map(Number);
  if (!year || !month || !day) return isoDate ?? "";
  const options = DATE_STYLES[language()] ?? DATE_STYLES.en;
  const formatter = cached("date", options, () => new Intl.DateTimeFormat(language(), options));
  return formatter.format(new Date(year, month - 1, day));
}

// Month 1-12 → "October" / "Oct" / "O" (width: "long" | "short" | "narrow"),
// capitalized (Italian month names are lowercase by default).
export function monthName(month, width = "long") {
  const options = { month: width };
  const formatter = cached("month", options, () => new Intl.DateTimeFormat(language(), options));
  const name = formatter.format(new Date(2000, month - 1, 1)).replace(/\.$/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}
