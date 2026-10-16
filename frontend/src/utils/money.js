// Amounts travel between frontend and backend as integer cents. These helpers
// convert at the edges of the UI (form inputs and display).

// Parses user input such as "12", "12.5", "12,50" or "-3.20" into integer
// cents, using string arithmetic so that no floating-point rounding can
// creep in (1.005 → 101, not 100). Returns null when the input is invalid.
export function parseAmountToCents(input, { allowNegative = false } = {}) {
  const normalized = String(input ?? "").trim().replace(",", ".");
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(normalized);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (sign && !allowNegative) return null;

  let cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  if (Number(fraction[2] ?? 0) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return sign && cents !== 0 ? -cents : cents;
}

// Integer cents → "12.50", the value format of <input type="number">, or
// with another decimal separator ("12,50") for text inputs. For display use
// formatMoney in utils/format.js.
export function formatCents(cents, separator = ".") {
  const value = Number(cents) || 0;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 100)}${separator}${String(abs % 100).padStart(2, "0")}`;
}
