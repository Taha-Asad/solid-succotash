// ==========================================
// INVOICE CREATE PAGE (Dedicated Billing Studio)
// ==========================================
//
// Full-page, zero-modal invoice creation and single-screen checkout:
//   - Quick barcode scanner & product typeahead fast-path
//   - Inline spreadsheet-style editable line item grid
//   - Instant Walk-in Customer (Cash) shortcut
//   - Integrated right-hand checkout & cash change calculator
//   - Atomic "Complete Sale & Print" in a single action
//   - Decoupled WhatsApp quote & receipt dispatch

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Grid,
  Group,
  Kbd,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  AlertTriangle,
  ArrowLeft,
  ReceiptText,
  RotateCcw,
  Trash2,
} from "lucide-react";

import {
  addInvoiceItem,
  createCustomer,
  createInvoice,
  finalizeInvoice,
  generateInvoiceHtml,
  getCompanyCurrency,
  getErrorMessage,
  listCustomers,
  listInvoices,
  listProducts,
  recordPayment,
} from "../../api/backend";
import { reportOnboardingEvent } from "../../onboarding/bus";
import { INK } from "../../theme";
import type {
  CurrencyConfig,
  PublicCustomer,
  PublicInvoice,
  PublicProduct,
} from "../../types/backend";
import { printHtmlContent } from "../../utils/printInvoice";
import { buildInvoiceShareLink, launchWhatsAppUrl } from "../../utils/whatsapp";

import { computeLineMath, type DraftLineItem, type DraftTotals } from "./types";
import { InvoiceCustomerSection } from "./components/InvoiceCustomerSection";
import { InvoiceLineItemsTable } from "./components/InvoiceLineItemsTable";
import { InvoicePaymentSection } from "./components/InvoicePaymentSection";
import { NewCustomerModal } from "./components/NewCustomerModal";
import {
  INVOICE_DRAFT_STORAGE_KEY,
  useInvoiceDraft,
} from "./hooks/useInvoiceDraft";
import { shareWhatsAppQuote } from "./utils/shareQuote";

interface InvoiceCreatePageProps {
  onBack: () => void;
  onInvoiceCreated: (invoiceId: string) => void;
}

export default function InvoiceCreatePage({
  onBack,
  onInvoiceCreated,
}: InvoiceCreatePageProps) {
  // Master data
  const [customers, setCustomers] = useState<PublicCustomer[]>([]);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [invoices, setInvoices] = useState<PublicInvoice[]>([]);
  const [currencyConfig, setCurrencyConfig] = useState<CurrencyConfig | null>(null);

  // Draft persistence hook
  const {
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
  } = useInvoiceDraft();

  // Scanner & Modal State
  const [scannerQuery, setScannerQuery] = useState("");
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    async function loadInitial() {
      try {
        const [cList, pList, invList, curr] = await Promise.all([
          listCustomers(),
          listProducts(),
          listInvoices(),
          getCompanyCurrency().catch(() => null),
        ]);
        setCustomers(cList);
        setProducts(pList);
        setInvoices(invList);
        setCurrencyConfig(curr);

        // Auto-select Walk-in Customer if available and not restored from draft
        const walkIn = cList.find(
          (c) =>
            c.name.toLowerCase().includes("walk-in") ||
            c.name.toLowerCase().includes("cash customer") ||
            c.name.toLowerCase().includes("counter")
        );
        if (walkIn && !localStorage.getItem(INVOICE_DRAFT_STORAGE_KEY)) {
          setCustomerId(walkIn.id);
        }
      } catch (err) {
        setGeneralError(getErrorMessage(err));
      }
    }
    loadInitial();
  }, [setCustomerId]);

  // Selected customer object & Walk-in detection
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId),
    [customers, customerId]
  );

  const isWalkinCustomer = useMemo(() => {
    if (!customerId || !selectedCustomer) return false;
    const name = selectedCustomer.name.toLowerCase();
    return (
      name.includes("walk-in") ||
      name.includes("walk in") ||
      name.includes("cash customer") ||
      name.includes("counter")
    );
  }, [customerId, selectedCustomer]);

  // Customer options
  const customerOptions = useMemo(
    () =>
      customers
        .filter((c) => c.isActive)
        .map((c) => ({
          value: c.id,
          label: `${c.name}${c.phone ? ` (${c.phone})` : ""}`,
        })),
    [customers]
  );

  // Previous Khata / Udhaar balance for selected customer
  const customerPendingDue = useMemo(() => {
    if (!customerId || isWalkinCustomer) return 0;
    return invoices
      .filter(
        (inv) =>
          inv.customerId === customerId &&
          inv.status !== "cancelled" &&
          inv.status !== "draft"
      )
      .reduce((sum, inv) => sum + (inv.balanceDue || 0), 0);
  }, [customerId, invoices, isWalkinCustomer]);

  // Product lookup options
  const productOptions = useMemo(
    () =>
      products
        .filter((p) => p.isActive)
        .map((p) => ({
          value: p.id,
          label: `${p.name} [${p.sku}] — Rs ${(p.sellPrice / 100).toLocaleString()} (Stock: ${p.quantityInStock})`,
        })),
    [products]
  );

  // Calculations for all items
  const totals: DraftTotals = useMemo(() => {
    let subtotalPaisa = 0;
    let discountPaisa = 0;
    let taxPaisa = 0;
    let grandTotalPaisa = 0;
    let totalQuantity = 0;

    items.forEach((item) => {
      const math = computeLineMath(item);
      subtotalPaisa += math.subtotalPaisa;
      discountPaisa += math.discountPaisa;
      taxPaisa += math.taxPaisa;
      grandTotalPaisa += math.totalPaisa;
      totalQuantity += item.quantity;
    });

    return {
      subtotalPaisa,
      discountPaisa,
      taxPaisa,
      grandTotalPaisa,
      grandTotalRupees: grandTotalPaisa / 100,
      totalQuantity,
      itemCount: items.length,
    };
  }, [items]);

  // Keep tendered amount in sync with grand total when in Paid in Full mode
  useEffect(() => {
    if (paymentStatus === "paid") {
      setAmountTendered(totals.grandTotalRupees);
    } else if (paymentStatus === "unpaid") {
      setAmountTendered(0);
    }
  }, [totals.grandTotalRupees, paymentStatus, setAmountTendered]);

  // Change Return Calculation
  const tenderedRupees = typeof amountTendered === "number" ? amountTendered : 0;
  const changeDueRupees = Math.max(0, tenderedRupees - totals.grandTotalRupees);
  const remainingDueRupees = Math.max(0, totals.grandTotalRupees - tenderedRupees);

  // Add product to lines
  const addProductToInvoice = useCallback((product: PublicProduct) => {
    setItems((prev) => {
      const existingIdx = prev.findIndex((i) => i.productId === product.id);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: updated[existingIdx].quantity + 1,
        };
        return updated;
      }
      const newLine: DraftLineItem = {
        clientId: Math.random().toString(36).substring(2, 9),
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unit: product.unit || "unit",
        quantity: 1,
        unitPrice: product.sellPrice / 100,
        taxRate: product.taxRate / 100,
        discountType: "percentage",
        discountValue: 0,
        stockAvailable: product.quantityInStock,
      };
      return [...prev, newLine];
    });
  }, [setItems]);

  const updateItem = useCallback((clientId: string, updates: Partial<DraftLineItem>) => {
    setItems((prev) =>
      prev.map((i) => (i.clientId === clientId ? { ...i, ...updates } : i))
    );
  }, [setItems]);

  const removeItem = useCallback((clientId: string) => {
    setItems((prev) => prev.filter((i) => i.clientId !== clientId));
  }, [setItems]);

  // Scanner query handler
  const handleScannerSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = scannerQuery.trim().toLowerCase();
    if (!query) return;

    const found = products.find(
      (p) =>
        p.isActive &&
        (p.sku.toLowerCase() === query ||
          (p.barcode && p.barcode.toLowerCase() === query) ||
          p.name.toLowerCase() === query ||
          p.name.toLowerCase().includes(query))
    );

    if (found) {
      addProductToInvoice(found);
      setScannerQuery("");
      notifications.show({
        title: "Product Added",
        message: `${found.name} added to invoice.`,
        color: "teal",
        autoClose: 1500,
      });
    } else {
      notifications.show({
        title: "Not Found",
        message: `No active product found matching "${query}"`,
        color: "orange",
        autoClose: 2500,
      });
    }
  };

  // Quick Walk-in Customer Selection
  const handleSelectWalkin = async () => {
    const existing = customers.find(
      (c) =>
        c.name.toLowerCase().includes("walk-in") ||
        c.name.toLowerCase().includes("cash customer") ||
        c.name.toLowerCase().includes("counter")
    );
    if (existing) {
      setCustomerId(existing.id);
      notifications.show({
        title: "Walk-in Selected",
        message: "Customer set to Walk-in Customer (Cash).",
        color: "teal",
        autoClose: 1500,
      });
      return;
    }
    try {
      const created = await createCustomer({
        name: "Walk-in Customer",
        phone: "",
        email: "",
        address: "Cash Counter",
        buyerType: "unregistered",
        cnic: "",
        ntn: "",
        strn: "",
      });
      setCustomers((prev) => [created, ...prev]);
      setCustomerId(created.id);
      notifications.show({
        title: "Walk-in Customer Ready",
        message: "Created default cash walk-in profile.",
        color: "teal",
        autoClose: 1800,
      });
    } catch (err) {
      notifications.show({
        title: "Error",
        message: getErrorMessage(err),
        color: "red",
      });
    }
  };

  // Pure WhatsApp Share: Share draft estimate without mutating state or deducting stock
  const handleShareWhatsAppQuote = () => {
    if (items.length === 0) {
      setGeneralError("Please add items to share an estimate quote.");
      return;
    }
    const phone = isWalkinCustomer
      ? walkinPhone.trim()
      : customers.find((c) => c.id === customerId)?.phone || "";
    const custName = isWalkinCustomer
      ? walkinName.trim() || "Walk-in Customer"
      : customers.find((c) => c.id === customerId)?.name || "Valued Customer";

    shareWhatsAppQuote({
      items,
      totals,
      customerName: custName,
      customerPhone: phone,
    });

    notifications.show({
      title: "WhatsApp Quote Opened",
      message: "Estimate summary transferred to WhatsApp.",
      color: "teal",
    });
  };

  // Execute Complete Sale, Save Draft, or WhatsApp Bill
  const handleExecuteCheckout = async (
    andPrint: boolean,
    asDraft: boolean = false,
    andWhatsApp: boolean = false
  ) => {
    setGeneralError(null);

    if (!customerId) {
      setGeneralError("Please select a customer or click '⚡ Cash / Walk-in'.");
      return;
    }
    if (items.length === 0) {
      setGeneralError("Please add at least one product before processing the invoice.");
      scannerInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      let effectiveReferenceNote = referenceNote.trim();
      if (isWalkinCustomer && (walkinName.trim() || walkinPhone.trim())) {
        const parts: string[] = [];
        if (walkinName.trim()) parts.push(`Walk-in: ${walkinName.trim()}`);
        if (walkinPhone.trim()) parts.push(`Tel: ${walkinPhone.trim()}`);
        const memo = `[${parts.join(" | ")}]`;
        effectiveReferenceNote = effectiveReferenceNote
          ? `${memo} ${effectiveReferenceNote}`
          : memo;
      }

      // Step 1: Create Invoice Header
      const invoice = await createInvoice({
        customerId,
        invoiceDate,
        dueDate,
        poNumber: poNumber.trim(),
        referenceNote: effectiveReferenceNote,
      });

      // Step 2: Add Line Items sequentially
      for (const item of items) {
        await addInvoiceItem({
          invoiceId: invoice.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: Math.round(item.unitPrice * 100),
          taxRate: Math.round(item.taxRate * 100),
          discountType: item.discountType,
          discountValue: Math.round(item.discountValue * 100),
        });
      }

      reportOnboardingEvent({ type: "invoice-created" });

      // If user chose "Save as Draft", handle draft save
      if (asDraft) {
        if (andWhatsApp) {
          const phone = isWalkinCustomer
            ? walkinPhone.trim()
            : customers.find((c) => c.id === customerId)?.phone || "";
          const custName = isWalkinCustomer
            ? walkinName.trim() || "Walk-in Customer"
            : customers.find((c) => c.id === customerId)?.name || "Valued Customer";
          const link = buildInvoiceShareLink(
            custName,
            phone,
            `${invoice.invoiceNumber} (Estimate / Draft)`,
            totals.grandTotalPaisa,
            totals.grandTotalPaisa,
            "Corbel ERP"
          );
          void launchWhatsAppUrl(link);
        }

        removePersistedStorage();
        notifications.show({
          title: andWhatsApp ? "Estimate Saved & Sent" : "Invoice Draft Saved",
          message: andWhatsApp
            ? `Invoice ${invoice.invoiceNumber} saved as draft and WhatsApp estimate opened.`
            : `Invoice ${invoice.invoiceNumber} saved as draft.`,
          color: "blue",
        });
        onInvoiceCreated(invoice.id);
        return;
      }

      // Step 3: Finalize Invoice (commits stock deduction and accounting)
      const finalized = await finalizeInvoice(invoice.id);
      reportOnboardingEvent({ type: "invoice-finalized" });

      // Step 4: Record Payment if not unpaid
      if (paymentStatus !== "unpaid") {
        const tenderedPaisa = Math.round(tenderedRupees * 100);
        const payablePaisa =
          paymentStatus === "paid"
            ? finalized.grandTotal
            : Math.min(tenderedPaisa, finalized.grandTotal);

        if (payablePaisa > 0) {
          await recordPayment({
            invoiceId: invoice.id,
            amount: payablePaisa,
            paymentMethod: paymentMethod,
            paymentDate: invoiceDate,
            reference: paymentReference.trim(),
            notes:
              tenderedRupees > totals.grandTotalRupees
                ? `Customer tendered Rs ${tenderedRupees.toLocaleString()}. Change returned: Rs ${changeDueRupees.toLocaleString()}`
                : paymentReference.trim(),
          });
        }
      }

      // Step 5: Optional Instant Print
      if (andPrint) {
        try {
          const html = await generateInvoiceHtml(invoice.id);
          if (html) {
            printHtmlContent(html);
          }
        } catch (printErr) {
          console.error("Print generation error:", printErr);
        }
      }

      // Step 6: Optional WhatsApp Dispatch for finalized bill
      if (andWhatsApp) {
        const phone = isWalkinCustomer
          ? walkinPhone.trim()
          : customers.find((c) => c.id === customerId)?.phone || "";
        const custName = isWalkinCustomer
          ? walkinName.trim() || "Walk-in Customer"
          : customers.find((c) => c.id === customerId)?.name || "Valued Customer";
        const effectivePaidPaisa =
          paymentStatus === "paid"
            ? finalized.grandTotal
            : paymentStatus === "unpaid"
            ? 0
            : Math.min(Math.round(tenderedRupees * 100), finalized.grandTotal);
        const effectiveBalancePaisa = Math.max(
          0,
          finalized.grandTotal - effectivePaidPaisa
        );

        const link = buildInvoiceShareLink(
          custName,
          phone,
          invoice.invoiceNumber,
          finalized.grandTotal,
          effectiveBalancePaisa,
          "Corbel ERP"
        );
        void launchWhatsAppUrl(link);
      }

      // Clear draft auto-save
      removePersistedStorage();

      notifications.show({
        title: "Invoice Completed",
        message: `Invoice ${invoice.invoiceNumber} processed successfully!`,
        color: "teal",
      });

      onInvoiceCreated(invoice.id);
    } catch (err) {
      setGeneralError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard Shortcuts (F2, F3, F10)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        handleSelectWalkin();
      } else if (e.key === "F3") {
        e.preventDefault();
        scannerInputRef.current?.focus();
      } else if (e.key === "F10" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        if (!submitting) {
          handleExecuteCheckout(true, false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [customers, items, customerId, totals, paymentStatus, paymentMethod, amountTendered, submitting]);

  return (
    <Box p="md" style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* ── HEADER WITH ACTIONS & SHORTCUTS ── */}
      <Group justify="space-between" align="center" mb="md" wrap="wrap">
        <Group gap="sm">
          <Button
            variant="subtle"
            color="gray"
            size="sm"
            leftSection={<ArrowLeft size={16} />}
            onClick={onBack}
          >
            Invoices List
          </Button>
          <Divider orientation="vertical" />
          <Group gap="xs">
            <ReceiptText size={22} color="var(--app-accent, #C9952A)" />
            <Title order={3} style={{ color: INK.text, letterSpacing: -0.3 }}>
              New Sales Invoice
            </Title>
            <Badge color="blue" variant="light" size="sm">
              Single-Screen Studio
            </Badge>
          </Group>
        </Group>

        <Group gap="xs">
          <Badge variant="outline" color="gray" size="sm">
            <Kbd size="xs">F2</Kbd> Cash Walk-in
          </Badge>
          <Badge variant="outline" color="gray" size="sm">
            <Kbd size="xs">F3</Kbd> Scan Barcode
          </Badge>
          <Badge variant="outline" color="gray" size="sm">
            <Kbd size="xs">F10</Kbd> Complete & Print
          </Badge>
        </Group>
      </Group>

      {draftRecoveredTime && (
        <Alert
          color="cyan"
          variant="light"
          radius="md"
          mb="md"
          icon={<RotateCcw size={18} />}
          withCloseButton
          onClose={() => setDraftRecoveredTime(null)}
        >
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="sm">
              <strong>Auto-Saved Draft Restored</strong> (saved at {draftRecoveredTime}). Your unsaved items and entries were recovered after app closure.
            </Text>
            <Button
              size="xs"
              variant="subtle"
              color="red"
              leftSection={<Trash2 size={14} />}
              onClick={clearDraft}
            >
              Discard Draft & Reset
            </Button>
          </Group>
        </Alert>
      )}

      {generalError && (
        <Alert
          color="red"
          variant="light"
          radius="md"
          mb="md"
          icon={<AlertTriangle size={18} />}
          withCloseButton
          onClose={() => setGeneralError(null)}
        >
          {generalError}
        </Alert>
      )}

      {/* ── TWO-COLUMN DOCUMENT & CHECKOUT LAYOUT ── */}
      <Grid>
        {/* ── LEFT COLUMN (70%): DOCUMENT DETAILS & SPREADSHEET ── */}
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="md">
            <InvoiceCustomerSection
              customerOptions={customerOptions}
              customerId={customerId}
              onCustomerIdChange={setCustomerId}
              invoiceDate={invoiceDate}
              onInvoiceDateChange={setInvoiceDate}
              dueDate={dueDate}
              onDueDateChange={setDueDate}
              isWalkinCustomer={isWalkinCustomer}
              walkinName={walkinName}
              onWalkinNameChange={setWalkinName}
              walkinPhone={walkinPhone}
              onWalkinPhoneChange={setWalkinPhone}
              customerPendingDue={customerPendingDue}
              poNumber={poNumber}
              onPoNumberChange={setPoNumber}
              referenceNote={referenceNote}
              onReferenceNoteChange={setReferenceNote}
              currencyConfig={currencyConfig}
              onSelectWalkin={handleSelectWalkin}
              onOpenNewCustomerModal={() => setNewCustomerModalOpen(true)}
            />

            <InvoiceLineItemsTable
              items={items}
              onUpdateItem={updateItem}
              onRemoveItem={removeItem}
              onClearAllItems={() => {
                setItems([]);
                removePersistedStorage();
              }}
              onAddProduct={addProductToInvoice}
              scannerQuery={scannerQuery}
              onScannerQueryChange={setScannerQuery}
              onScannerSubmit={handleScannerSubmit}
              scannerInputRef={scannerInputRef}
              products={products}
              productOptions={productOptions}
              currencyConfig={currencyConfig}
            />
          </Stack>
        </Grid.Col>

        {/* ── RIGHT COLUMN (30%): STICKY CHECKOUT & PAYMENT STUDIO ── */}
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <InvoicePaymentSection
            totals={totals}
            customerPendingDue={customerPendingDue}
            currencyConfig={currencyConfig}
            paymentStatus={paymentStatus}
            onPaymentStatusChange={setPaymentStatus}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            amountTendered={amountTendered}
            onAmountTenderedChange={setAmountTendered}
            tenderedRupees={tenderedRupees}
            changeDueRupees={changeDueRupees}
            remainingDueRupees={remainingDueRupees}
            paymentReference={paymentReference}
            onPaymentReferenceChange={setPaymentReference}
            isWalkinCustomer={isWalkinCustomer}
            submitting={submitting}
            hasItems={items.length > 0}
            hasCustomer={Boolean(customerId)}
            onExecuteCheckout={handleExecuteCheckout}
            onShareWhatsAppQuote={handleShareWhatsAppQuote}
            onDiscard={() => {
              if (items.length > 0) {
                clearDraft();
              }
              onBack();
            }}
          />
        </Grid.Col>
      </Grid>

      {/* ── INLINE NEW CUSTOMER MODAL ── */}
      <NewCustomerModal
        opened={newCustomerModalOpen}
        onClose={() => setNewCustomerModalOpen(false)}
        onCustomerCreated={(customer) => {
          setCustomers((prev) => [customer, ...prev]);
          setCustomerId(customer.id);
        }}
      />
    </Box>
  );
}
