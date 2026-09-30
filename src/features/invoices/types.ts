// ==========================================
// INVOICE MODULE TYPES & MATH HELPERS
// ==========================================

import { roundToCurrency } from "../../utils/currency";

export interface DraftLineItem {
  clientId: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  unitPrice: number; // in rupees
  taxRate: number; // in percent e.g. 18 for 18%
  discountType: "percentage" | "amount";
  discountValue: number; // % or rupees
  stockAvailable: number;
}

export interface DraftLineMath {
  subtotalPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
}

export function computeLineMath(line: DraftLineItem): DraftLineMath {
  const qty = Math.max(1, line.quantity);
  const unitPricePaisa = Math.max(0, Math.round(line.unitPrice * 100));
  const subtotal = qty * unitPricePaisa;

  const discountPaisa =
    line.discountType === "amount"
      ? Math.min(Math.max(0, Math.round(line.discountValue * 100)), subtotal)
      : (subtotal * Math.max(0, Math.round(line.discountValue * 100))) / 10000;

  const afterDiscount = subtotal - discountPaisa;
  const taxRateBp = Math.max(0, Math.round(line.taxRate * 100));
  const taxPaisa = (afterDiscount * taxRateBp) / 10000;
  const totalPaisa = roundToCurrency(afterDiscount + taxPaisa);

  return {
    subtotalPaisa: subtotal,
    discountPaisa,
    taxPaisa,
    totalPaisa,
  };
}

export interface DraftTotals {
  subtotalPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  grandTotalPaisa: number;
  grandTotalRupees: number;
  totalQuantity: number;
  itemCount: number;
}
