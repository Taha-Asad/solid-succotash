// ==========================================
// CURRENCY FORMATTING UTILITIES
// ==========================================
//
// Replaces the hardcoded paisaToDisplay / p() helpers
// with currency-aware formatting that uses the company's
// currency config from the backend.

import type { CurrencyConfig } from "../types/backend";

// Default PKR config (fallback when company config not loaded)
const DEFAULT_CONFIG: CurrencyConfig = {
  code: "PKR",
  symbol: "Rs",
  name: "Pakistani Rupee",
  decimalPlaces: 2,
  thousandsSep: ",",
  decimalSep: ".",
};

/**
 * Formats a paisa (smallest currency unit) amount for display.
 * E.g., formatPaisa(123456, usdConfig) -> "1,234.56"
 */
export function formatPaisa(paisa: number, config?: CurrencyConfig | null): string {
  const c = config ?? DEFAULT_CONFIG;
  const value = paisa / Math.pow(10, c.decimalPlaces);
  return formatValue(value, c);
}

/**
 * Formats a paisa amount with currency symbol.
 * E.g., formatPaisaWithSymbol(123456, usdConfig) -> "$ 1,234.56"
 */
export function formatPaisaWithSymbol(paisa: number, config?: CurrencyConfig | null): string {
  const c = config ?? DEFAULT_CONFIG;
  const formatted = formatPaisa(paisa, c);
  return `${c.symbol} ${formatted}`;
}

/**
 * Parses a display string back to paisa.
 * E.g., parseDisplayToPaisa("1,234.56", usdConfig) -> 123456
 */
export function parseDisplayToPaisa(display: string, config?: CurrencyConfig | null): number {
  const c = config ?? DEFAULT_CONFIG;
  // Remove everything except digits, decimal sep, thousands sep, and minus
  const cleaned = display.replace(/[^\d\-.,]/g, "");
  // Remove thousands separator
  const withoutThousands = cleaned.split(c.thousandsSep).join("");
  // Replace decimal separator with dot
  const normalized = withoutThousands.replace(c.decimalSep, ".");
  const num = parseFloat(normalized);
  if (isNaN(num)) return 0;
  return Math.round(num * Math.pow(10, c.decimalPlaces));
}

/**
 * Converts a display string to paisa for backend submission.
 * Same as parseDisplayToPaisa but returns 0 for empty/invalid input.
 */
export function displayToPaisa(display: string | number, config?: CurrencyConfig | null): number {
  if (typeof display === "number") return Math.round(display * 100);
  if (!display || display.trim() === "") return 0;
  return parseDisplayToPaisa(display, config);
}

/**
 * Rounds a paisa amount to the nearest whole currency unit.
 * For PKR/USD (2 decimals): rounds to nearest 100 paisa.
 * For JPY (0 decimals): no change.
 */
export function roundToCurrency(paisa: number, decimalPlaces?: number): number {
  const dp = decimalPlaces ?? 2;
  if (dp >= 2) {
    return Math.round(paisa / 100) * 100;
  }
  return paisa;
}

// Internal: format a raw f64 value with thousands separators
function formatValue(value: number, config: CurrencyConfig): string {
  const precision = Math.max(config.decimalPlaces, 0);
  const absVal = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  // Format with fixed precision
  const formatted = absVal.toFixed(precision);
  const [intPart, decPart] = formatted.split(".");

  // Add thousands separators
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, config.thousandsSep);

  if (precision > 0) {
    return `${sign}${withThousands}${config.decimalSep}${decPart}`;
  }
  return `${sign}${withThousands}`;
}

/**
 * Returns the company's currency config code for badge display.
 * E.g., getCurrencyBadge({ code: "USD", ... }) -> "USD"
 */
export function getCurrencyCode(config?: CurrencyConfig | null): string {
  return config?.code ?? "PKR";
}
