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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Kbd,
  Menu,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useForm } from "@mantine/form";
import {
  ArrowLeft,
  Barcode,
  CheckCircle2,
  ChevronDown,
  Printer,
  ReceiptText,
  Save,
  Search,
  Trash2,
  UserPlus,
  Zap,
  AlertTriangle,
  RotateCcw,
  MessageSquare,
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
import { AppDateInput } from "../../components/AppDateInput";
import { reportOnboardingEvent } from "../../onboarding/bus";
import { INK } from "../../theme";
import type {
  CurrencyConfig,
  PublicCustomer,
  PublicInvoice,
  PublicProduct,
} from "../../types/backend";
import {
  formatPaisa as fmtPaisa,
  roundToCurrency,
} from "../../utils/currency";
import { printHtmlContent } from "../../utils/printInvoice";
import {
  buildInvoiceShareLink,
  launchWhatsAppUrl,
} from "../../utils/whatsapp";

// ==========================================
// TYPES & MATH HELPERS
// ==========================================

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

function computeLineMath(line: DraftLineItem) {
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

  // Form State: Header
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [customerId, setCustomerId] = useState<string>("");
  const [walkinName, setWalkinName] = useState<string>("");
  const [walkinPhone, setWalkinPhone] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>(todayIso);
  const [dueDate, setDueDate] = useState<string>(todayIso);
  const [poNumber, setPoNumber] = useState<string>("");
  const [referenceNote, setReferenceNote] = useState<string>("");

  // Line items state
  const [items, setItems] = useState<DraftLineItem[]>([]);
  const [scannerQuery, setScannerQuery] = useState("");
  const scannerInputRef = useRef<HTMLInputElement>(null);

  // Auto-save & Power Outage Recovery
  const STORAGE_KEY = "corbel_active_invoice_draft";
  const [draftRecoveredTime, setDraftRecoveredTime] = useState<string | null>(null);

  // Inline Customer Creation
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerModalError, setCustomerModalError] = useState<string | null>(null);

  // Payment & Settlement State
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "partial" | "unpaid">("paid");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "card">("cash");
  const [amountTendered, setAmountTendered] = useState<number | "">("");
  const [paymentReference, setPaymentReference] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Restore draft from localStorage on mount (Power Outage / Crash Recovery)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
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
            setPaymentMethod(parsed.paymentMode === "bank_transfer" || parsed.paymentMode === "card" ? parsed.paymentMode : "cash");
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.error("Failed to save invoice draft to localStorage", e);
    }
  }, [items, customerId, walkinName, walkinPhone, invoiceDate, dueDate, poNumber, referenceNote, paymentStatus, paymentMethod, amountTendered, paymentReference]);

  const handleClearDraft = () => {
    localStorage.removeItem(STORAGE_KEY);
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
        if (walkIn && !localStorage.getItem(STORAGE_KEY)) {
          setCustomerId(walkIn.id);
        }
      } catch (err) {
        setGeneralError(getErrorMessage(err));
      }
    }
    loadInitial();
  }, []);

  // Format paisa helper
  const fmt = useCallback(
    (paisa: number) => fmtPaisa(paisa, currencyConfig),
    [currencyConfig]
  );

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
  // (NEVER shared across walk-in customers: walk-in customers are independent cash buyers)
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
  const totals = useMemo(() => {
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
  }, [totals.grandTotalRupees, paymentStatus]);

  // Change Return Calculation
  const tenderedRupees = typeof amountTendered === "number" ? amountTendered : 0;
  const changeDueRupees = Math.max(0, tenderedRupees - totals.grandTotalRupees);
  const remainingDueRupees = Math.max(0, totals.grandTotalRupees - tenderedRupees);

  // Add product to lines
  const addProductToInvoice = useCallback(
    (product: PublicProduct) => {
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
          taxRate: product.taxRate / 100, // e.g. 1800 bp -> 18%
          discountType: "percentage",
          discountValue: 0,
          stockAvailable: product.quantityInStock,
        };
        return [...prev, newLine];
      });
    },
    []
  );

  // Scanner query handler
  const handleScannerSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = scannerQuery.trim().toLowerCase();
    if (!query) return;

    // Match by exact SKU, barcode or case-insensitive name
    const found = products.find(
      (p) =>
        p.isActive &&
        (p.sku.toLowerCase() === query ||
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
    // Create one if none exists
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
          handleExecuteCheckout(true);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [customers, items, customerId, totals, paymentStatus, paymentMethod, amountTendered, submitting]);

  // Execute Complete Sale, Save Draft, or WhatsApp Bill
  const handleExecuteCheckout = async (
    andPrint: boolean,
    asDraft: boolean = false,
    andWhatsApp: boolean = false,
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
      // Build effective reference note (attach walk-in buyer memo if applicable)
      let effectiveReferenceNote = referenceNote.trim();
      if (isWalkinCustomer && (walkinName.trim() || walkinPhone.trim())) {
        const parts: string[] = [];
        if (walkinName.trim()) parts.push(`Walk-in: ${walkinName.trim()}`);
        if (walkinPhone.trim()) parts.push(`Tel: ${walkinPhone.trim()}`);
        const memo = `[${parts.join(" | ")}]`;
        effectiveReferenceNote = effectiveReferenceNote ? `${memo} ${effectiveReferenceNote}` : memo;
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
          discountValue:
            item.discountType === "amount"
              ? Math.round(item.discountValue * 100)
              : Math.round(item.discountValue * 100),
        });
      }

      reportOnboardingEvent({ type: "invoice-created" });

      // If user chose "Save as Draft", handle draft save (and optional draft WhatsApp estimate)
      if (asDraft) {
        if (andWhatsApp) {
          const phone = isWalkinCustomer
            ? walkinPhone.trim()
            : (customers.find((c) => c.id === customerId)?.phone || "");
          const custName = isWalkinCustomer
            ? (walkinName.trim() || "Walk-in Customer")
            : (customers.find((c) => c.id === customerId)?.name || "Valued Customer");
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

        localStorage.removeItem(STORAGE_KEY);
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
          : (customers.find((c) => c.id === customerId)?.phone || "");
        const custName = isWalkinCustomer
          ? (walkinName.trim() || "Walk-in Customer")
          : (customers.find((c) => c.id === customerId)?.name || "Valued Customer");
        const effectivePaidPaisa =
          paymentStatus === "paid"
            ? finalized.grandTotal
            : paymentStatus === "unpaid"
            ? 0
            : Math.min(Math.round(tenderedRupees * 100), finalized.grandTotal);
        const effectiveBalancePaisa = Math.max(0, finalized.grandTotal - effectivePaidPaisa);

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
      localStorage.removeItem(STORAGE_KEY);

      notifications.show({
        title: "Invoice Completed",
        message: `Invoice ${invoice.invoiceNumber} processed successfully!`,
        color: "teal",
        icon: <CheckCircle2 size={16} />,
      });

      onInvoiceCreated(invoice.id);
    } catch (err) {
      setGeneralError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Inline New Customer Form
  const newCustomerForm = useForm({
    initialValues: {
      name: "",
      phone: "",
      email: "",
      address: "",
      cnic: "",
      ntn: "",
      strn: "",
      buyerType: "unregistered",
    },
    validate: {
      name: (v) => (v.trim().length === 0 ? "Customer name is required" : null),
    },
  });

  const handleCreateCustomerSubmit = async (values: typeof newCustomerForm.values) => {
    setCustomerModalError(null);
    setCreatingCustomer(true);
    try {
      const created = await createCustomer({
        name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        address: values.address.trim(),
        cnic: values.cnic.trim(),
        ntn: values.ntn.trim(),
        strn: values.strn.trim(),
        buyerType: values.buyerType,
      });
      setCustomers((prev) => [created, ...prev]);
      setCustomerId(created.id);
      setNewCustomerModalOpen(false);
      newCustomerForm.reset();
      notifications.show({
        title: "Customer Registered",
        message: `${created.name} registered and selected.`,
        color: "teal",
      });
    } catch (err) {
      setCustomerModalError(getErrorMessage(err));
    } finally {
      setCreatingCustomer(false);
    }
  };

  return (
    <Box p="md" style={{ maxWidth: 1440, margin: "0 auto" }}>
      {/* ── TOP HEADER / BREADCRUMBS ── */}
      <Group justify="space-between" align="center" mb="lg" wrap="wrap">
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
              onClick={handleClearDraft}
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
            {/* 1. CUSTOMER & TERMS CARD */}
            <Card withBorder radius="md" padding="md" shadow="xs" style={{ background: "var(--app-surface)" }}>
              <Group justify="space-between" align="center" mb="xs">
                <Text size="xs" fw={700} c="dimmed" style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                  1. Customer & Billing Terms
                </Text>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="light"
                    color="teal"
                    leftSection={<Zap size={14} />}
                    onClick={handleSelectWalkin}
                  >
                    ⚡ Cash / Walk-in
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    leftSection={<UserPlus size={14} />}
                    onClick={() => setNewCustomerModalOpen(true)}
                  >
                    + New Customer
                  </Button>
                </Group>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Select
                  label="Select Customer"
                  placeholder="Search name, phone, or company"
                  required
                  searchable
                  clearable
                  data={customerOptions}
                  value={customerId}
                  onChange={(v) => setCustomerId(v || "")}
                />
                <SimpleGrid cols={2} spacing="xs">
                  <AppDateInput
                    label="Invoice Date"
                    value={invoiceDate}
                    onChange={setInvoiceDate}
                  />
                  <AppDateInput
                    label="Due Date"
                    value={dueDate}
                    onChange={setDueDate}
                  />
                </SimpleGrid>
              </SimpleGrid>

              {/* Optional Walk-in Customer Memo Details */}
              {isWalkinCustomer && (
                <Paper
                  withBorder
                  p="xs"
                  radius="md"
                  mt="xs"
                  style={{
                    background: "rgba(16, 185, 129, 0.05)",
                    borderColor: "rgba(16, 185, 129, 0.25)",
                  }}
                >
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" fw={700} c="teal">
                      ⚡ Walk-in Counter Sale (Isolated Cash Transaction)
                    </Text>
                    <Text size="xs" c="dimmed">
                      Optional memo for receipt
                    </Text>
                  </Group>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                    <TextInput
                      placeholder="Buyer Name (optional, e.g. Tariq Khan)"
                      size="xs"
                      value={walkinName}
                      onChange={(e) => setWalkinName(e.currentTarget.value)}
                    />
                    <TextInput
                      placeholder="Phone # (optional, e.g. 0300-1234567)"
                      size="xs"
                      value={walkinPhone}
                      onChange={(e) => setWalkinPhone(e.currentTarget.value)}
                    />
                  </SimpleGrid>
                </Paper>
              )}

              {/* Outstanding Khata / Udhaar Banner */}
              {customerId && !isWalkinCustomer && customerPendingDue > 0 && (
                <Alert
                  color="orange"
                  variant="light"
                  radius="md"
                  mt="xs"
                  p="xs"
                  icon={<AlertTriangle size={16} />}
                >
                  <Group justify="space-between" align="center">
                    <Text size="xs" fw={700}>
                      Existing Customer Khata Balance: {fmt(customerPendingDue)} PKR
                    </Text>
                    <Badge color="orange" size="xs">
                      Pending Udhaar
                    </Badge>
                  </Group>
                </Alert>
              )}

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mt="xs">
                <TextInput
                  label="PO Reference (Optional)"
                  placeholder="Customer Purchase Order #"
                  size="xs"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.currentTarget.value)}
                />
                <TextInput
                  label="Delivery / Memo Note"
                  placeholder="Terms, dispatch details or notes"
                  size="xs"
                  value={referenceNote}
                  onChange={(e) => setReferenceNote(e.currentTarget.value)}
                />
              </SimpleGrid>
            </Card>

            {/* 2. PRODUCT LINE ITEMS (FAST SPREADSHEET) */}
            <Card withBorder radius="md" padding="md" shadow="xs" style={{ background: "var(--app-surface)" }}>
              <Group justify="space-between" align="center" mb="sm" wrap="wrap">
                <Group gap="xs">
                  <Text size="xs" fw={700} c="dimmed" style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                    2. Product Line Items
                  </Text>
                  <Badge variant="dot" color={items.length > 0 ? "teal" : "gray"}>
                    {totals.itemCount} items ({totals.totalQuantity} units)
                  </Badge>
                </Group>
              </Group>

              {/* Fast Barcode / Search Input Header */}
              <form onSubmit={handleScannerSubmit}>
                <Group gap="xs" mb="md">
                  <TextInput
                    ref={scannerInputRef}
                    placeholder="Scan Barcode, type SKU or product name, then press Enter..."
                    leftSection={<Barcode size={18} color="var(--app-accent, #C9952A)" />}
                    style={{ flex: 1 }}
                    value={scannerQuery}
                    onChange={(e) => setScannerQuery(e.currentTarget.value)}
                  />
                  <Button type="submit" variant="light" color="indigo" leftSection={<Search size={15} />}>
                    Add
                  </Button>
                </Group>
              </form>

              {/* Inline Table */}
              {items.length === 0 ? (
                <Paper
                  withBorder
                  p="xl"
                  radius="md"
                  style={{
                    textAlign: "center",
                    background: "rgba(0,0,0,0.01)",
                    borderStyle: "dashed",
                  }}
                >
                  <Stack align="center" gap="xs">
                    <ReceiptText size={36} color="var(--app-muted, #94A3B8)" />
                    <Text size="sm" fw={600} style={{ color: INK.text }}>
                      No products added yet
                    </Text>
                    <Text size="xs" c="dimmed" style={{ maxWidth: 420 }}>
                      Scan a barcode with your hardware scanner, or pick a product from the quick selector below to begin.
                    </Text>
                    <Group gap="xs" mt="xs">
                      <Select
                        placeholder="Pick a product to add..."
                        data={productOptions}
                        searchable
                        clearable
                        style={{ width: 320 }}
                        onChange={(pid) => {
                          const prod = products.find((p) => p.id === pid);
                          if (prod) addProductToInvoice(prod);
                        }}
                      />
                    </Group>
                  </Stack>
                </Paper>
              ) : (
                <ScrollArea>
                  <Table verticalSpacing="xs" striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th style={{ width: 35 }}>#</Table.Th>
                        <Table.Th>Product & SKU</Table.Th>
                        <Table.Th style={{ width: 100 }}>Qty</Table.Th>
                        <Table.Th style={{ width: 130 }}>Rate (PKR)</Table.Th>
                        <Table.Th style={{ width: 90 }}>Tax %</Table.Th>
                        <Table.Th style={{ width: 110 }}>Discount</Table.Th>
                        <Table.Th style={{ width: 130, textAlign: "right" }}>Total</Table.Th>
                        <Table.Th style={{ width: 45 }}></Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {items.map((item, idx) => {
                        const lineMath = computeLineMath(item);
                        return (
                          <Table.Tr key={item.clientId}>
                            <Table.Td>
                              <Text size="xs" c="dimmed" fw={600}>
                                {idx + 1}
                              </Text>
                            </Table.Td>

                            {/* Product Info */}
                            <Table.Td>
                              <Stack gap={1}>
                                <Text size="sm" fw={600} style={{ color: INK.text }}>
                                  {item.productName}
                                </Text>
                                <Group gap={6}>
                                  <Badge size="xs" variant="outline" color="gray">
                                    {item.sku}
                                  </Badge>
                                  <Text size="xs" c={item.stockAvailable < item.quantity ? "red" : "dimmed"}>
                                    Stock: {item.stockAvailable} {item.unit}
                                  </Text>
                                </Group>
                              </Stack>
                            </Table.Td>

                            {/* Quantity */}
                            <Table.Td>
                              <NumberInput
                                size="xs"
                                min={1}
                                step={1}
                                value={item.quantity}
                                onChange={(val) => {
                                  const q = typeof val === "number" ? val : 1;
                                  setItems((prev) =>
                                    prev.map((i) =>
                                      i.clientId === item.clientId ? { ...i, quantity: q } : i
                                    )
                                  );
                                }}
                              />
                            </Table.Td>

                            {/* Unit Price */}
                            <Table.Td>
                              <NumberInput
                                size="xs"
                                min={0}
                                decimalScale={2}
                                value={item.unitPrice}
                                onChange={(val) => {
                                  const p = typeof val === "number" ? val : 0;
                                  setItems((prev) =>
                                    prev.map((i) =>
                                      i.clientId === item.clientId ? { ...i, unitPrice: p } : i
                                    )
                                  );
                                }}
                              />
                            </Table.Td>

                            {/* Tax Rate % */}
                            <Table.Td>
                              <NumberInput
                                size="xs"
                                min={0}
                                max={100}
                                suffix="%"
                                value={item.taxRate}
                                onChange={(val) => {
                                  const t = typeof val === "number" ? val : 0;
                                  setItems((prev) =>
                                    prev.map((i) =>
                                      i.clientId === item.clientId ? { ...i, taxRate: t } : i
                                    )
                                  );
                                }}
                              />
                            </Table.Td>

                            {/* Discount */}
                            <Table.Td>
                              <NumberInput
                                size="xs"
                                min={0}
                                placeholder="0"
                                value={item.discountValue}
                                onChange={(val) => {
                                  const d = typeof val === "number" ? val : 0;
                                  setItems((prev) =>
                                    prev.map((i) =>
                                      i.clientId === item.clientId ? { ...i, discountValue: d } : i
                                    )
                                  );
                                }}
                              />
                            </Table.Td>

                            {/* Line Total */}
                            <Table.Td style={{ textAlign: "right" }}>
                              <Text size="sm" fw={700} className="tabular" style={{ color: INK.text }}>
                                {fmt(lineMath.totalPaisa)}
                              </Text>
                            </Table.Td>

                            {/* Remove */}
                            <Table.Td>
                              <ActionIcon
                                color="red"
                                variant="subtle"
                                size="sm"
                                onClick={() =>
                                  setItems((prev) =>
                                    prev.filter((i) => i.clientId !== item.clientId)
                                  )
                                }
                              >
                                <Trash2 size={15} />
                              </ActionIcon>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}

              {/* Add More Items Row */}
              <Group justify="space-between" align="center" mt="md" pt="xs" style={{ borderTop: `1px solid ${INK.border}` }}>
                <Select
                  placeholder="+ Add another product..."
                  data={productOptions}
                  searchable
                  clearable
                  size="xs"
                  style={{ width: 340 }}
                  onChange={(pid) => {
                    const prod = products.find((p) => p.id === pid);
                    if (prod) addProductToInvoice(prod);
                  }}
                />
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  disabled={items.length === 0}
                  onClick={() => {
                    setItems([]);
                    localStorage.removeItem(STORAGE_KEY);
                  }}
                >
                  Clear All Items
                </Button>
              </Group>
            </Card>
          </Stack>
        </Grid.Col>

        {/* ── RIGHT COLUMN (30%): STICKY CHECKOUT & PAYMENT STUDIO ── */}
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md" style={{ position: "sticky", top: 16 }}>
            {/* FINANCIAL SUMMARY CARD */}
            <Card withBorder radius="md" padding="md" shadow="sm" style={{ background: "var(--app-surface)" }}>
              <Text size="xs" fw={700} c="dimmed" mb="sm" style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                3. Order & Financial Summary
              </Text>

              <Stack gap={8}>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Subtotal ({totals.totalQuantity} items):
                  </Text>
                  <Text size="sm" fw={600} className="tabular">
                    {fmt(totals.subtotalPaisa)} PKR
                  </Text>
                </Group>

                {totals.discountPaisa > 0 && (
                  <Group justify="space-between">
                    <Text size="sm" c="green">
                      Total Discount:
                    </Text>
                    <Text size="sm" fw={600} c="green" className="tabular">
                      - {fmt(totals.discountPaisa)} PKR
                    </Text>
                  </Group>
                )}

                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Sales Tax:
                  </Text>
                  <Text size="sm" fw={600} className="tabular">
                    + {fmt(totals.taxPaisa)} PKR
                  </Text>
                </Group>

                <Divider my={4} />

                {/* GRAND TOTAL CALLOUT */}
                <Box
                  p="xs"
                  style={{
                    background: "rgba(201, 149, 42, 0.08)",
                    border: "1px solid rgba(201, 149, 42, 0.25)",
                    borderRadius: 8,
                  }}
                >
                  <Group justify="space-between" align="baseline">
                    <Text size="xs" fw={700} style={{ textTransform: "uppercase", color: INK.text }}>
                      Grand Total
                    </Text>
                    <Text size="xl" fw={900} className="tabular" style={{ color: "var(--app-accent, #C9952A)" }}>
                      {fmt(totals.grandTotalPaisa)} PKR
                    </Text>
                  </Group>
                </Box>

                {/* Net Total with Khata Udhaar */}
                {customerPendingDue > 0 && (
                  <Group justify="space-between" mt={4}>
                    <Text size="xs" c="orange" fw={600}>
                      + Previous Udhaar Balance:
                    </Text>
                    <Text size="xs" c="orange" fw={700} className="tabular">
                      {fmt(customerPendingDue)} PKR
                    </Text>
                  </Group>
                )}
              </Stack>
            </Card>

            {/* INTEGRATED PAYMENT STUDIO */}
            <Card withBorder radius="md" padding="md" shadow="sm" style={{ background: "var(--app-surface)" }}>
              <Text size="xs" fw={700} c="dimmed" mb="xs" style={{ textTransform: "uppercase", letterSpacing: 0.8 }}>
                4. Payment & Settlement
              </Text>

              <Stack gap="sm">
                {/* Settlement Status Selector */}
                <div>
                  <Text size="xs" fw={600} mb={4} c="dimmed">
                    Settlement Status:
                  </Text>
                  <SegmentedControl
                    fullWidth
                    size="xs"
                    value={paymentStatus}
                    onChange={(v) => setPaymentStatus(v as any)}
                    data={[
                      { label: "Paid in Full", value: "paid" },
                      { label: "Partial Paid", value: "partial" },
                      { label: "Unpaid / Credit", value: "unpaid" },
                    ]}
                  />
                </div>

                {/* If Paid in Full or Partial Paid: choose Payment Method */}
                {paymentStatus !== "unpaid" && (
                  <div>
                    <Text size="xs" fw={600} mb={4} c="dimmed">
                      Payment Method:
                    </Text>
                    <SegmentedControl
                      fullWidth
                      size="xs"
                      value={paymentMethod}
                      onChange={(v) => setPaymentMethod(v as any)}
                      data={[
                        { label: "Cash", value: "cash" },
                        { label: "Bank Transfer", value: "bank_transfer" },
                        { label: "Card", value: "card" },
                      ]}
                    />
                  </div>
                )}

                {/* Paid in Full details */}
                {paymentStatus === "paid" && (
                  <Alert color="teal" variant="light" radius="md" p="xs">
                    <Text size="xs">
                      Full payment of <strong>Rs {totals.grandTotalRupees.toLocaleString()}</strong> will be recorded via <strong>{paymentMethod.toUpperCase()}</strong> on completion. Zero balance due.
                    </Text>
                  </Alert>
                )}

                {/* Partial Paid details */}
                {paymentStatus === "partial" && (
                  <>
                    <NumberInput
                      label="Amount Tendered / Received (Rs)"
                      description="Enter the amount received from customer"
                      decimalScale={2}
                      min={0}
                      value={amountTendered}
                      onChange={(v) => setAmountTendered(typeof v === "number" ? v : "")}
                    />

                    {/* Quick Cash Buttons */}
                    {paymentMethod === "cash" && (
                      <Group gap={6} wrap="wrap">
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="teal"
                          onClick={() => setAmountTendered(totals.grandTotalRupees)}
                        >
                          Exact (Rs {totals.grandTotalRupees.toLocaleString()})
                        </Button>
                        {[500, 1000, 2000, 5000].map((denomination) => (
                          <Button
                            key={denomination}
                            size="compact-xs"
                            variant="default"
                            onClick={() => setAmountTendered(denomination)}
                          >
                            Rs {denomination.toLocaleString()}
                          </Button>
                        ))}
                      </Group>
                    )}

                    {/* Change Return / Partial Due Box */}
                    {tenderedRupees > totals.grandTotalRupees ? (
                      <Box
                        p="xs"
                        style={{
                          background: "rgba(16, 185, 129, 0.12)",
                          border: "1px solid rgba(16, 185, 129, 0.3)",
                          borderRadius: 8,
                        }}
                      >
                        <Group justify="space-between" align="center">
                          <Text size="xs" fw={700} c="green">
                            Change to Return:
                          </Text>
                          <Text size="md" fw={800} c="green" className="tabular">
                            Rs {changeDueRupees.toLocaleString()}
                          </Text>
                        </Group>
                      </Box>
                    ) : tenderedRupees < totals.grandTotalRupees && tenderedRupees > 0 ? (
                      <Box
                        p="xs"
                        style={{
                          background: "rgba(245, 158, 11, 0.12)",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                          borderRadius: 8,
                        }}
                      >
                        <Group justify="space-between" align="center">
                          <Text size="xs" fw={700} c="orange">
                            Remaining Balance (Khata):
                          </Text>
                          <Text size="sm" fw={800} c="orange" className="tabular">
                            Rs {remainingDueRupees.toLocaleString()}
                          </Text>
                        </Group>
                      </Box>
                    ) : null}
                  </>
                )}

                {/* Unpaid / Credit details */}
                {paymentStatus === "unpaid" && (
                  <Alert color="blue" variant="light" radius="md" p="xs">
                    <Text size="xs">
                      Invoice will be issued with <strong>zero payment recorded</strong>.
                      {isWalkinCustomer ? (
                        <> Payment remains pending upon customer pickup or delivery.</>
                      ) : (
                        <> The entire amount of <strong>{fmt(totals.grandTotalPaisa)} PKR</strong> will be posted to the customer's Khata (Accounts Receivable).</>
                      )}
                    </Text>
                  </Alert>
                )}

                {/* Optional reference */}
                {paymentStatus !== "unpaid" && (
                  <TextInput
                    label="Payment Reference / Txn #"
                    placeholder="e.g. Cash counter, Bank slip, Cheque #"
                    size="xs"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.currentTarget.value)}
                  />
                )}

                <Divider my="xs" />

                {/* PRIMARY ACTION BUTTONS */}
                <Stack gap="xs">
                  <Button
                    size="md"
                    radius="md"
                    loading={submitting}
                    disabled={items.length === 0 || !customerId}
                    leftSection={<Printer size={18} />}
                    onClick={() => handleExecuteCheckout(true, false, false)}
                    styles={{
                      root: {
                        background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                        color: "#ffffff",
                        fontWeight: 700,
                        "&:hover": { filter: "brightness(1.05)" },
                      },
                    }}
                  >
                    Complete Sale & Print (F10)
                  </Button>

                  <Group grow gap="xs">
                    <Button
                      size="sm"
                      variant="light"
                      color="indigo"
                      loading={submitting}
                      disabled={items.length === 0 || !customerId}
                      onClick={() => handleExecuteCheckout(false, false, false)}
                    >
                      Complete (No Print)
                    </Button>

                    <Button
                      size="sm"
                      variant="default"
                      loading={submitting}
                      disabled={items.length === 0 || !customerId}
                      leftSection={<Save size={14} />}
                      onClick={() => handleExecuteCheckout(false, true, false)}
                    >
                      Save Draft
                    </Button>
                  </Group>

                  {/* Dedicated WhatsApp Sharing Action */}
                  <Menu position="bottom" withinPortal shadow="md">
                    <Menu.Target>
                      <Button
                        size="sm"
                        variant="light"
                        color="teal"
                        loading={submitting}
                        disabled={items.length === 0 || !customerId}
                        leftSection={<MessageSquare size={16} />}
                        rightSection={<ChevronDown size={14} />}
                      >
                        Send to WhatsApp...
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Label>WhatsApp Options</Menu.Label>
                      <Menu.Item
                        leftSection={<CheckCircle2 size={16} color="#10b981" />}
                        onClick={() => handleExecuteCheckout(false, false, true)}
                      >
                        <div>
                          <Text size="xs" fw={700}>Complete Sale & WhatsApp Bill</Text>
                          <Text size="xs" c="dimmed">Finalizes invoice, commits stock deduction & opens WhatsApp</Text>
                        </div>
                      </Menu.Item>
                      <Menu.Divider />
                      <Menu.Item
                        leftSection={<Save size={16} color="#3b82f6" />}
                        onClick={() => handleExecuteCheckout(false, true, true)}
                      >
                        <div>
                          <Text size="xs" fw={700}>Save Draft & Send Estimate Quote</Text>
                          <Text size="xs" c="dimmed">Keeps as draft without deducting inventory or recording payment</Text>
                        </div>
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>

                  <Button
                    variant="subtle"
                    size="xs"
                    color="gray"
                    onClick={() => {
                      if (items.length > 0) {
                        handleClearDraft();
                      }
                      onBack();
                    }}
                  >
                    Discard & Return
                  </Button>
                </Stack>
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>

      {/* ── INLINE NEW CUSTOMER MODAL ── */}
      <Modal
        opened={newCustomerModalOpen}
        onClose={() => setNewCustomerModalOpen(false)}
        title={
          <Group gap="xs">
            <UserPlus size={18} color="var(--app-accent, #C9952A)" />
            <Text fw={700} size="md">
              Register New Customer
            </Text>
          </Group>
        }
        centered
        radius="md"
      >
        <form onSubmit={newCustomerForm.onSubmit(handleCreateCustomerSubmit)}>
          <Stack gap="sm">
            {customerModalError && (
              <Alert color="red" variant="light" p="xs">
                {customerModalError}
              </Alert>
            )}

            <TextInput
              label="Customer / Business Name"
              placeholder="e.g. Al-Madina Traders"
              required
              {...newCustomerForm.getInputProps("name")}
            />

            <SimpleGrid cols={2}>
              <TextInput
                label="Phone / Mobile"
                placeholder="e.g. 0300-1234567"
                {...newCustomerForm.getInputProps("phone")}
              />
              <TextInput
                label="Email (Optional)"
                placeholder="client@domain.com"
                {...newCustomerForm.getInputProps("email")}
              />
            </SimpleGrid>

            <TextInput
              label="Address / City"
              placeholder="e.g. Shah Alam Market, Lahore"
              {...newCustomerForm.getInputProps("address")}
            />

            <SimpleGrid cols={3}>
              <TextInput
                label="CNIC"
                placeholder="35201-..."
                {...newCustomerForm.getInputProps("cnic")}
              />
              <TextInput
                label="NTN"
                placeholder="7-digit NTN"
                {...newCustomerForm.getInputProps("ntn")}
              />
              <TextInput
                label="STRN"
                placeholder="Sales tax #"
                {...newCustomerForm.getInputProps("strn")}
              />
            </SimpleGrid>

            <Group justify="flex-end" mt="md">
              <Button variant="default" size="sm" onClick={() => setNewCustomerModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={creatingCustomer}>
                Save Customer
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Box>
  );
}
