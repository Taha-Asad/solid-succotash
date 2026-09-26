// ==========================================
// WHATSAPP INTEGRATION UTILITY (Zero-Cost Intent Protocol)
// ==========================================
//
// Formats customer/company phone numbers for Pakistan (+92)
// and opens native WhatsApp Desktop / Web with pre-filled
// professional invoice & Khata payment reminders.

import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Normalizes any Pakistani or international phone number into
 * standard WhatsApp format (digits only, e.g. 923001234567).
 *
 * Examples:
 *   "0300-1234567"  -> "923001234567"
 *   "0300 1234567"  -> "923001234567"
 *   "+92 300 1234567" -> "923001234567"
 *   "03211234567"   -> "923211234567"
 *   "3001234567"    -> "923001234567"
 */
export function formatWhatsAppNumber(rawPhone: string): string {
  if (!rawPhone) return "";
  // Strip all non-digit characters
  let digits = rawPhone.replace(/\D/g, "");

  // If local Pakistani format starting with 03 (e.g. 03001234567 -> 11 digits)
  if (digits.startsWith("03") && digits.length === 11) {
    digits = "92" + digits.slice(1);
  } else if (digits.startsWith("3") && digits.length === 10) {
    digits = "92" + digits;
  } else if (digits.startsWith("0092")) {
    digits = digits.slice(2);
  }

  return digits;
}

/**
 * Checks if a phone number is valid for WhatsApp dispatch.
 */
export function isValidWhatsAppNumber(rawPhone: string): boolean {
  const formatted = formatWhatsAppNumber(rawPhone);
  return formatted.length >= 10 && formatted.length <= 15;
}

/**
 * Builds a WhatsApp URL for an outstanding Khata payment reminder.
 */
export function buildKhataReminderLink(
  customerName: string,
  rawPhone: string,
  balanceDuePaisa: number,
  companyName: string = "Corbel ERP"
): string {
  const number = formatWhatsAppNumber(rawPhone);
  const rupees = (balanceDuePaisa / 100).toLocaleString();

  const message = [
    `Assalam-o-Alaikum *${customerName.trim()}*,`,
    ``,
    `This is a friendly payment reminder from *${companyName.trim()}*.`,
    `Your current outstanding balance is: *Rs ${rupees}*.`,
    ``,
    `Kindly arrange payment or review your ledger statement at your convenience.`,
    `Thank you for your business!`,
  ].join("\n");

  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * Builds a WhatsApp URL to share an invoice summary.
 */
export function buildInvoiceShareLink(
  customerName: string,
  rawPhone: string,
  invoiceNumber: string,
  grandTotalPaisa: number,
  balanceDuePaisa: number,
  companyName: string = "Corbel ERP"
): string {
  const number = formatWhatsAppNumber(rawPhone);
  const totalRupees = (grandTotalPaisa / 100).toLocaleString();
  const balanceRupees = (balanceDuePaisa / 100).toLocaleString();

  const message = [
    `Assalam-o-Alaikum *${customerName.trim()}*,`,
    ``,
    `Here are the details for invoice *${invoiceNumber}* from *${companyName.trim()}*:`,
    `• *Grand Total:* Rs ${totalRupees}`,
    balanceDuePaisa > 0
      ? `• *Balance Due:* Rs ${balanceRupees}`
      : `• *Status:* Fully Paid (Thank you!)`,
    ``,
    `Thank you for shopping with us!`,
  ].join("\n");

  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * Dispatches the WhatsApp intent to the OS (opens WhatsApp Desktop or Web).
 */
export async function launchWhatsAppUrl(url: string): Promise<boolean> {
  try {
    await openUrl(url);
    return true;
  } catch (err) {
    console.warn("Failed to open WhatsApp via Tauri opener plugin, falling back to window.open", err);
    window.open(url, "_blank");
    return true;
  }
}
