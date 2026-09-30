import {
  formatPaisa as fmtPaisa,
  displayToPaisa as dtp,
  roundToCurrency,
} from "../../../utils/currency";
import type { CurrencyConfig } from "../../../types/backend";

export function paisaToDisplay(
  paisa: number,
  config?: CurrencyConfig | null,
): string {
  return fmtPaisa(paisa, config);
}

export function displayToPaisa(
  display: string | number,
  config?: CurrencyConfig | null,
): number {
  return dtp(display, config);
}

// Rounds paisa to the nearest whole currency unit (matches the backend).
export function roundToRupee(paisa: number): number {
  return roundToCurrency(paisa);
}

// Mirrors the backend's line item math so the modal preview matches the saved values.
export function computeLinePreview(input: {
  quantity: number;
  unitPricePaisa: number;
  taxRateBp: number;
  discountType: string;
  discountValue: number;
}): { subtotal: number; discount: number; tax: number; total: number } {
  const subtotal = input.quantity * input.unitPricePaisa;
  const discount =
    input.discountType === "amount"
      ? Math.min(Math.max(input.discountValue, 0), subtotal)
      : (subtotal * Math.max(input.discountValue, 0)) / 10000;
  const afterDiscount = subtotal - discount;
  const tax = (afterDiscount * Math.max(input.taxRateBp, 0)) / 10000;
  return {
    subtotal,
    discount,
    tax,
    total: roundToRupee(afterDiscount + tax),
  };
}

export const STATUS_COLORS: Record<string, string> = {
  draft: "yellow",
  finalized: "blue",
  paid: "green",
  cancelled: "red",
};

export const FBR_STATUS_COLORS: Record<string, string> = {
  not_submitted: "gray",
  pending: "yellow",
  queued: "blue",
  submitting: "blue",
  validated: "green",
  failed: "orange",
  dead: "red",
};
