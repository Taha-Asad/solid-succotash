import { useEffect, useMemo, useState } from "react";
import { notifications } from "@mantine/notifications";
import type { DraftLineItem } from "../types";

export const INVOICE_DRAFT_STORAGE_KEY = "corbel_active_invoice_draft";

export function useInvoiceDraft() {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [customerId, setCustomerId] = useState<string>("");
  const [walkinName, setWalkinName] = useState<string>("");
  const [walkinPhone, setWalkinPhone] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>(todayIso);
  const [dueDate, setDueDate] = useState<string>(todayIso);
  const [poNumber, setPoNumber] = useState<string>("");
  const [referenceNote, setReferenceNote] = useState<string>("");

  const [items, setItems] = useState<DraftLineItem[]>([]);
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "partial" | "unpaid">("paid");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "card">("cash");
  const [amountTendered, setAmountTendered] = useState<number | "">("");
  const [paymentReference, setPaymentReference] = useState<string>("");

  const [draftRecoveredTime, setDraftRecoveredTime] = useState<string | null>(null);

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(INVOICE_DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.items) && parsed.items.length > 0) {
          setItems(parsed.items);
          if (parsed.customerId) setCustomerId(parsed.customerId);
          if (parsed.walkinName) setWalkinName(parsed.walkinName);
          if (parsed.walkinPhone) setWalkinPhone(parsed.walkinPhone);
          if (parsed.invoiceDate) setInvoiceDate(parsed.invoiceDate);
          if (parsed.dueDate) setDueDate(parsed.dueDate);
          if (parsed.poNumber) setPoNumber(parsed.poNumber);
          if (parsed.referenceNote) setReferenceNote(parsed.referenceNote);
          if (parsed.paymentStatus) {
            setPaymentStatus(parsed.paymentStatus);
          } else if (parsed.paymentMode === "credit") {
            setPaymentStatus("unpaid");
          } else if (parsed.paymentMode) {
            setPaymentStatus("paid");
            setPaymentMethod(
              parsed.paymentMode === "bank_transfer" || parsed.paymentMode === "card"
                ? parsed.paymentMode
                : "cash"
            );
          }
          if (parsed.paymentMethod) setPaymentMethod(parsed.paymentMethod);
          if (parsed.amountTendered !== undefined) setAmountTendered(parsed.amountTendered);
          if (parsed.paymentReference) setPaymentReference(parsed.paymentReference);
          setDraftRecoveredTime(parsed.savedAt || new Date().toLocaleTimeString());
        }
      }
    } catch (e) {
      console.error("Failed to load invoice draft from localStorage", e);
    }
  }, []);

  // Auto-save draft to localStorage whenever fields change
  useEffect(() => {
    try {
      if (items.length > 0) {
        const payload = {
          items,
          customerId,
          walkinName,
          walkinPhone,
          invoiceDate,
          dueDate,
          poNumber,
          referenceNote,
          paymentStatus,
          paymentMethod,
          amountTendered,
          paymentReference,
          savedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        localStorage.setItem(INVOICE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
      } else {
        localStorage.removeItem(INVOICE_DRAFT_STORAGE_KEY);
      }
    } catch (e) {
      console.error("Failed to save invoice draft to localStorage", e);
    }
  }, [
    items,
    customerId,
    walkinName,
    walkinPhone,
    invoiceDate,
    dueDate,
    poNumber,
    referenceNote,
    paymentStatus,
    paymentMethod,
    amountTendered,
    paymentReference,
  ]);

  const clearDraft = () => {
    localStorage.removeItem(INVOICE_DRAFT_STORAGE_KEY);
    setItems([]);
    setWalkinName("");
    setWalkinPhone("");
    setPoNumber("");
    setReferenceNote("");
    setPaymentStatus("paid");
    setPaymentMethod("cash");
    setAmountTendered("");
    setDraftRecoveredTime(null);
    notifications.show({
      title: "Draft Cleared",
      message: "Unsaved invoice draft cleared.",
      color: "gray",
    });
  };

  const removePersistedStorage = () => {
    localStorage.removeItem(INVOICE_DRAFT_STORAGE_KEY);
  };

  return {
    customerId,
    setCustomerId,
    walkinName,
    setWalkinName,
    walkinPhone,
    setWalkinPhone,
    invoiceDate,
    setInvoiceDate,
    dueDate,
    setDueDate,
    poNumber,
    setPoNumber,
    referenceNote,
    setReferenceNote,
    items,
    setItems,
    paymentStatus,
    setPaymentStatus,
    paymentMethod,
    setPaymentMethod,
    amountTendered,
    setAmountTendered,
    paymentReference,
    setPaymentReference,
    draftRecoveredTime,
    setDraftRecoveredTime,
    clearDraft,
    removePersistedStorage,
  };
}
