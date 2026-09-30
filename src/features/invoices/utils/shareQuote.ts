import { formatWhatsAppNumber, launchWhatsAppUrl } from "../../../utils/whatsapp";
import type { DraftLineItem, DraftTotals } from "../types";

interface ShareWhatsAppQuoteOptions {
  items: DraftLineItem[];
  totals: DraftTotals;
  customerName?: string;
  customerPhone?: string;
  companyName?: string;
}

export function shareWhatsAppQuote({
  items,
  totals,
  customerName = "Valued Customer",
  customerPhone = "",
  companyName = "Corbel ERP",
}: ShareWhatsAppQuoteOptions): void {
  const lineItemsSummary = items
    .map(
      (i) =>
        `• ${i.productName} (${i.quantity} ${i.unit}) — Rs ${(
          i.quantity * i.unitPrice
        ).toLocaleString()}`
    )
    .join("\n");

  const message = [
    `Assalam-o-Alaikum *${customerName.trim()}*,`,
    ``,
    `Here is your estimated quotation from *${companyName.trim()}*:`,
    `────────────────────────`,
    lineItemsSummary,
    `────────────────────────`,
    `*Total Estimate:* Rs ${totals.grandTotalRupees.toLocaleString()}`,
    ``,
    `Valid upon stock availability. Please let us know if you wish to confirm this order!`,
  ].join("\n");

  const formatted = formatWhatsAppNumber(customerPhone);
  const url = formatted
    ? `https://wa.me/${formatted}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  void launchWhatsAppUrl(url);
}
