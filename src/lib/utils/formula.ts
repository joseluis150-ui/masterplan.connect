import { evaluate } from "mathjs";

/**
 * Evaluates a math formula string and returns the numeric result.
 * If the input is already a plain number, returns it directly.
 * Returns null if the formula is invalid.
 */
export function evaluateFormula(input: string): number | null {
  if (!input || input.trim() === "") return null;

  const trimmed = input.trim();

  // If it's just a number, return it
  const asNumber = Number(trimmed);
  if (!isNaN(asNumber)) return asNumber;

  try {
    const result = evaluate(trimmed);
    if (typeof result === "number" && isFinite(result)) {
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Formats a number for display with the specified decimal places.
 */
export function formatNumber(
  value: number | null | undefined,
  decimals: number = 2,
  thousandsSeparator: string = ",",
  decimalSeparator: string = "."
): string {
  if (value == null) return "";

  const fixed = value.toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");

  const withThousands = intPart.replace(
    /\B(?=(\d{3})+(?!\d))/g,
    thousandsSeparator
  );

  if (decimals === 0) return withThousands;
  return `${withThousands}${decimalSeparator}${decPart}`;
}

/**
 * Converts between local currency and USD.
 */
export function convertCurrency(
  value: number,
  exchangeRate: number,
  direction: "local_to_usd" | "usd_to_local"
): number {
  if (exchangeRate <= 0) return 0;
  if (direction === "local_to_usd") return value / exchangeRate;
  return value * exchangeRate;
}
