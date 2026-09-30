// ==========================================
// INVOICE PAGE
// ==========================================
//
// Full invoice management:
//   - List invoices with status badges
//   - Create new invoices
//   - Add/remove line items
//   - Finalize (lock + deduct stock)
//   - Record payments
//   - View invoice details

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Kbd,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  ScrollArea,
  Alert,
  Menu,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";

import { useForm } from "@mantine/form";

import {
  listCustomers,
  listInvoices,
  getInvoice,
  addInvoiceItem,
  removeInvoiceItem,
  updateInvoiceItem,
  finalizeInvoice,
  deleteInvoice,
  cancelInvoice,
  recordPayment,
  listProducts,
  generateInvoiceHtml,
  generateInvoicePdf,
  generateInvoiceExcel,
  saveFileDialog,
  getErrorMessage,
  getCompanyCurrency,
  getInvoiceFbrStatus,
  createCreditNote,
  createDebitNote,
} from "../../api/backend";

import type {
  PublicCustomer,
  PublicInvoice,
  PublicInvoiceItem,
  PublicProduct,
  InvoiceWithDetails,
  CurrencyConfig,
  InvoiceFbrStatus,
} from "../../types/backend";

import { INK } from "../../theme";
import { ReceiptText, Plus, Printer, MessageSquare, CheckCircle2, Zap, Barcode, ChevronDown, Trash2, XCircle, AlertTriangle } from "lucide-react";
import { printHtmlContent } from "../../utils/printInvoice";
import { reportOnboardingEvent } from "../../onboarding/bus";
import { usePermissions } from "../permissions/PermissionsProvider";
import InvoiceCreatePage from "./InvoiceCreatePage";
import { InvoicePaymentModal } from "../payments/InvoicePaymentModal";
import {
  formatWhatsAppNumber,
  launchWhatsAppUrl,
} from "../../utils/whatsapp";

// ==========================================
// HELPERS
// ==========================================

import {
  formatPaisa as fmtPaisa,
  displayToPaisa as dtp,
  roundToCurrency,
  paisaToNumber,
  getCurrencyCode,
} from "../../utils/currency";

function paisaToDisplay(paisa: number, config?: CurrencyConfig | null): string {
  return fmtPaisa(paisa, config);
}

function displayToPaisa(display: string | number, config?: CurrencyConfig | null): number {
  return dtp(display, config);
}

// Rounds paisa to the nearest whole currency unit (matches the backend).
function roundToRupee(paisa: number): number {
  return roundToCurrency(paisa);
}

// Mirrors the backend's line item math so the modal preview matches the saved values.
function computeLinePreview(input: {
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

const STATUS_COLORS: Record<string, string> = {
  draft: "yellow",
  finalized: "blue",
  paid: "green",
  cancelled: "red",
};

const FBR_STATUS_COLORS: Record<string, string> = {
  not_submitted: "gray",
  pending: "yellow",
  queued: "blue",
  submitting: "blue",
  validated: "green",
  failed: "orange",
  dead: "red",
};

// ==========================================
// PROPS
// ==========================================

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function InvoicePage() {
  const [view, setView] = useState<"list" | "detail" | "create">("list");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    null,
  );

  function openInvoice(invoiceId: string) {
    setSelectedInvoiceId(invoiceId);
    setView("detail");
  }

  function backToList() {
    setSelectedInvoiceId(null);
    setView("list");
  }

  function openCreate() {
    setView("create");
  }

  if (view === "create") {
    return (
      <InvoiceCreatePage
        onBack={backToList}
        onInvoiceCreated={(id) => openInvoice(id)}
      />
    );
  }

  if (view === "detail" && selectedInvoiceId) {
    return (
      <InvoiceDetailView
        invoiceId={selectedInvoiceId}
        onBack={backToList}
      />
    );
  }

  return (
    <InvoiceListView
      onOpenInvoice={openInvoice}
      onOpenCreate={openCreate}
    />
  );
}

// ==========================================
// INVOICE LIST VIEW
// ==========================================

function InvoiceListView({
  onOpenInvoice,
  onOpenCreate,
}: {
  onOpenInvoice: (id: string) => void;
  onOpenCreate: () => void;
}) {
  const perms = usePermissions();
  const canCreate = perms.can("invoices", "create");
  const [invoices, setInvoices] = useState<PublicInvoice[]>([]);
  const [customers, setCustomers] = useState<PublicCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currencyConfig, setCurrencyConfig] = useState<CurrencyConfig | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, cust, curConfig] = await Promise.all([listInvoices(), listCustomers(), getCompanyCurrency()]);
      setInvoices(inv);
      setCustomers(cust);
      setCurrencyConfig(curConfig);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const customerMap = new Map(customers.map((c) => [c.id, c.name]));

  // Summary stats
  const totalInvoices = invoices.length;
  const totalRevenue = invoices
    .filter((i) => i.status !== "cancelled")
    .reduce((sum, i) => sum + i.grandTotal, 0);
  const totalOutstanding = invoices
    .filter((i) => i.status === "finalized")
    .reduce((sum, i) => sum + i.balanceDue, 0);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Stack gap={2}>
          <Text
            size="xs"
            fw={700}
            style={{ color: INK.gold, letterSpacing: 1.4, textTransform: "uppercase" }}
          >
            Billing
          </Text>
          <Title order={2} style={{ color: INK.text, letterSpacing: -0.3 }}>
            Invoices
          </Title>
          <Text size="sm" c="dimmed">
            Create, finalize and collect payments on your sales invoices.
          </Text>
        </Stack>
        {canCreate && (
          <Button
            leftSection={<Plus size={16} />}
            onClick={onOpenCreate}
            styles={{
              root: {
                background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
                color: "#131C39",
                fontWeight: 700,
                "&:hover": { filter: "brightness(1.05)" },
              },
            }}
            data-tour="new-invoice"
          >
            New Invoice
          </Button>
        )}
      </Group>

      {/* Summary cards */}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card withBorder shadow="sm" padding="lg">
          <Text size="xs" fw={600} style={{ color: INK.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Total Invoices
          </Text>
          <Title order={2} className="tabular" style={{ color: INK.text }}>{totalInvoices}</Title>
          <Text size="xs" c="dimmed" mt={4}>across all statuses</Text>
        </Card>
        <Card withBorder shadow="sm" padding="lg">
          <Text size="xs" fw={600} style={{ color: INK.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Total Revenue
          </Text>
          <Title order={2} className="tabular" style={{ color: INK.text }}>{paisaToDisplay(totalRevenue, currencyConfig)}</Title>
          <Text size="xs" c="dimmed" mt={4}>from finalized invoices</Text>
        </Card>
        <Card withBorder shadow="sm" padding="lg">
          <Text size="xs" fw={600} style={{ color: INK.muted, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Outstanding
          </Text>
          <Title order={2} className="tabular" c={totalOutstanding > 0 ? "orange" : "green"}>
            {paisaToDisplay(totalOutstanding, currencyConfig)}
          </Title>
          <Text size="xs" c="dimmed" mt={4}>balance due from customers</Text>
        </Card>
      </SimpleGrid>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {loading ? (
        <Text c="dimmed">Loading invoices...</Text>
      ) : invoices.length === 0 ? (
        <Card withBorder padding="xl" ta="center">
          <Stack align="center" gap="xs" py="lg">
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `${INK.gold}18`,
                color: INK.gold,
              }}
            >
              <ReceiptText size={22} />
            </div>
            <Text fw={600} style={{ color: INK.text }}>
              No invoices yet
            </Text>
            <Text size="sm" c="dimmed" maw={320}>
              Create your first invoice to start billing customers.
            </Text>
          </Stack>
        </Card>
      ) : (
        <Card withBorder shadow="sm" padding="lg">
          <ScrollArea>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Invoice #</Table.Th>
                  <Table.Th>Customer</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>FBR</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                  <Table.Th ta="right">Paid</Table.Th>
                  <Table.Th ta="right">Balance</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {invoices.map((inv) => (
                  <Table.Tr
                    key={inv.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => onOpenInvoice(inv.id)}
                  >
                    <Table.Td>
                      <Text fw={600} size="sm" className="mono" style={{ color: INK.text }}>
                        {inv.invoiceNumber}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {customerMap.get(inv.customerId) ?? "Unknown"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{inv.invoiceDate}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={STATUS_COLORS[inv.status] ?? "gray"}
                        variant="light"
                      >
                        {inv.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {inv.fbrStatus && inv.fbrStatus !== "not_submitted" ? (
                        <Badge
                          color={FBR_STATUS_COLORS[inv.fbrStatus] ?? "gray"}
                          variant="light"
                          size="sm"
                        >
                          {inv.fbrStatus}
                        </Badge>
                      ) : (
                        <Text size="xs" c="dimmed">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={600} className="tabular">
                        {paisaToDisplay(inv.grandTotal, currencyConfig)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" className="tabular">{paisaToDisplay(inv.amountPaid, currencyConfig)}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text
                        size="sm"
                        fw={500}
                        className="tabular"
                        c={inv.balanceDue > 0 ? "orange" : "green"}
                      >
                        {paisaToDisplay(inv.balanceDue, currencyConfig)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}
    </Stack>
  );
}

// ==========================================
// POS AUDIO FEEDBACK (SYNTHESIZED WEB AUDIO)
// ==========================================

function playPosBeepTone() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime); // 880Hz (A5)
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {
    // Non-fatal if audio context is blocked
  }
}

function playPosErrorTone() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, ctx.currentTime); // 220Hz buzz
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch {
    // Non-fatal if audio context is blocked
  }
}

// ==========================================
// INVOICE DETAIL VIEW
// ==========================================

function InvoiceDetailView({
  invoiceId,
  onBack,
}: {
  invoiceId: string;
  onBack: () => void;
}) {
  const perms = usePermissions();
  const canFinalize = perms.can("invoices", "finalize");
  const canEdit = perms.can("invoices", "edit");
  const canDelete = perms.can("invoices", "delete") || perms.can("invoices", "edit");
  const [details, setDetails] = useState<InvoiceWithDetails | null>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PublicInvoiceItem | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [fbrStatus, setFbrStatus] = useState<InvoiceFbrStatus | null>(null);
  const [creditNoteModalOpen, setCreditNoteModalOpen] = useState(false);
  const [debitNoteModalOpen, setDebitNoteModalOpen] = useState(false);
  const [creditNoteReason, setCreditNoteReason] = useState("");
  const [creditNoteAmount, setCreditNoteAmount] = useState(0);
  const [debitNoteReason, setDebitNoteReason] = useState("");
  const [debitNoteAmount, setDebitNoteAmount] = useState(0);
  const [customerTotalDue, setCustomerTotalDue] = useState<number | null>(null);
  const [currencyConfig, setCurrencyConfig] = useState<CurrencyConfig | null>(null);

  // Invoice Deletion & Cancellation States
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fast Line Item Entry state (Cashier & Quick Invoicing)
  const [quickProductId, setQuickProductId] = useState<string | null>(null);
  const [quickQuantity, setQuickQuantity] = useState<number>(1);
  const [quickPrice, setQuickPrice] = useState<number>(0);
  const [fastAdding, setFastAdding] = useState(false);

  // Hardware Barcode Scanner & POS Fast-Path state
  const [barcodeInput, setBarcodeInput] = useState("");
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);

  async function handleBarcodeScan(scannedCode: string) {
    const raw = scannedCode.trim();
    if (!raw) return;

    // Match by SKU or customFields.barcode
    const matched = products.find((p) => {
      if (p.sku.toLowerCase() === raw.toLowerCase()) return true;
      if (p.customFields) {
        try {
          const parsed = JSON.parse(p.customFields);
          if (parsed.barcode && String(parsed.barcode).toLowerCase() === raw.toLowerCase()) {
            return true;
          }
        } catch {
          // ignore json parse error
        }
      }
      return false;
    });

    if (!matched) {
      playPosErrorTone();
      notifications.show({
        title: "Barcode Not Found",
        message: `No product matches barcode or SKU "${raw}"`,
        color: "red",
        autoClose: 3500,
      });
      setBarcodeInput("");
      return;
    }

    playPosBeepTone();
    const currentItems = details?.items ?? [];
    const existing = currentItems.find((it) => it.productId === matched.id);

    setIsScanning(true);
    try {
      if (existing) {
        await updateInvoiceItem({
          invoiceId,
          itemId: existing.id,
          productId: matched.id,
          quantity: existing.quantity + 1,
          unitPrice: existing.unitPrice,
          taxRate: existing.taxRate,
          discountType: existing.discountType,
          discountValue:
            existing.discountType === "fixed"
              ? existing.discountAmount
              : existing.discountRate / 100,
        });
        notifications.show({
          title: "Quantity Incremented",
          message: `${matched.name} (Qty: ${existing.quantity + 1})`,
          color: "teal",
          autoClose: 2000,
        });
      } else {
        await addInvoiceItem({
          invoiceId,
          productId: matched.id,
          quantity: 1,
          unitPrice: matched.sellPrice,
          taxRate: matched.taxRate,
          discountType: "percent",
          discountValue: 0,
        });
        notifications.show({
          title: "Item Scanned",
          message: `${matched.name} added (+1)`,
          color: "teal",
          autoClose: 2000,
        });
      }
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsScanning(false);
      setBarcodeInput("");
      setTimeout(() => barcodeInputRef.current?.focus(), 50);
    }
  }

  // POS Hotkeys: F2 to focus barcode, F8 for 80mm thermal receipt
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        barcodeInputRef.current?.focus();
        barcodeInputRef.current?.select();
      }
      if (e.key === "F8") {
        e.preventDefault();
        void handlePrint("thermal_80mm");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [invoiceId, details]);

  function handleQuickProductSelect(id: string | null) {
    setQuickProductId(id);
    if (!id) {
      setQuickPrice(0);
      return;
    }
    const found = products.find((p) => p.id === id);
    if (found) {
      setQuickPrice(paisaToNumber(found.sellPrice, currencyConfig));
    }
  }

  async function handleFastAddLine() {
    if (!quickProductId || quickQuantity <= 0) return;
    const selectedProd = products.find((p) => p.id === quickProductId);
    if (!selectedProd) return;

    setFastAdding(true);
    try {
      await addInvoiceItem({
        invoiceId,
        productId: quickProductId,
        quantity: quickQuantity,
        unitPrice: displayToPaisa(quickPrice, currencyConfig),
        taxRate: selectedProd.taxRate,
        discountType: "percent",
        discountValue: 0,
      });
      await load();
      setQuickProductId(null);
      setQuickQuantity(1);
      setQuickPrice(0);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setFastAdding(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [det, prods, allInvoices, curConfig] = await Promise.all([
        getInvoice(invoiceId),
        listProducts(),
        listInvoices().catch(() => [] as PublicInvoice[]),
        getCompanyCurrency().catch(() => null),
      ]);
      setDetails(det);
      setProducts(prods);
      if (curConfig) setCurrencyConfig(curConfig);
      if (det?.customer?.id) {
        const otherDue = allInvoices
          .filter(
            (inv) =>
              inv.customerId === det.customer.id &&
              inv.id !== det.invoice.id &&
              inv.status !== "cancelled" &&
              inv.status !== "draft"
          )
          .reduce((sum, inv) => sum + (inv.balanceDue || 0), 0);
        setCustomerTotalDue(otherDue);
      }
      setError(null);
      try {
        const fbr = await getInvoiceFbrStatus(invoiceId);
        setFbrStatus(fbr);
      } catch {
        // FBR status not available (non-critical)
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleShareWhatsApp() {
    if (!details) return;
    const { invoice, customer, items } = details;

    const rawPhone = customer.phone ? formatWhatsAppNumber(customer.phone) : "";

    const itemsSummary = items
      .slice(0, 8)
      .map(
        (it) =>
          `• ${it.productName} (x${it.quantity}): Rs. ${(it.lineTotal / 100).toFixed(2)}`
      )
      .join("\n");
    const moreItems =
      items.length > 8 ? `\n...and ${items.length - 8} more items` : "";

    const message = [
      `*INVOICE: ${invoice.invoiceNumber}*`,
      `*Date:* ${invoice.invoiceDate}`,
      `*Customer:* ${customer.name}`,
      `────────────────────────`,
      itemsSummary + moreItems,
      `────────────────────────`,
      `*Total Bill:* Rs. ${(invoice.grandTotal / 100).toFixed(2)}`,
      `*Amount Paid:* Rs. ${(invoice.amountPaid / 100).toFixed(2)}`,
      `*Balance Due:* Rs. ${(invoice.balanceDue / 100).toFixed(2)}`,
      ``,
      `Thank you for your business!`,
    ].join("\n");

    const url = rawPhone
      ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    await launchWhatsAppUrl(url);
  }

  async function handleAddItem(values: {
    productId: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discountType: string;
    discountValue: number;
  }) {
    try {
      await addInvoiceItem({ invoiceId, ...values });
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  async function handleRemoveItem(itemId: string) {
    try {
      await removeInvoiceItem({ invoiceId, itemId });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleUpdateItem(
    values: {
      productId: string;
      quantity: number;
      unitPrice: number;
      taxRate: number;
      discountType: string;
      discountValue: number;
    },
    itemId: string,
  ) {
    try {
      await updateInvoiceItem({ invoiceId, itemId, ...values });
      setEditingItem(null);
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  async function handleFinalize() {
    try {
      await finalizeInvoice(invoiceId);
      reportOnboardingEvent({ type: "invoice-finalized" });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleRecordPayment(values: {
    amount: number;
    paymentMethod: string;
    paymentDate: string;
    reference: string;
    notes: string;
  }) {
    try {
      await recordPayment({ invoiceId, ...values });
      setPaymentModalOpen(false);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleCreateCreditNote() {
    if (!details) return;
    try {
      await createCreditNote(
        invoiceId,
        creditNoteReason,
        creditNoteAmount,
        null,
      );
      setCreditNoteModalOpen(false);
      setCreditNoteReason("");
      setCreditNoteAmount(0);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleCreateDebitNote() {
    if (!details) return;
    try {
      await createDebitNote(
        invoiceId,
        debitNoteReason,
        debitNoteAmount,
        null,
      );
      setDebitNoteModalOpen(false);
      setDebitNoteReason("");
      setDebitNoteAmount(0);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleDeleteInvoice() {
    setDeleting(true);
    try {
      await deleteInvoice(invoiceId);
      notifications.show({
        title: "Draft Deleted",
        message: "Draft invoice deleted successfully.",
        color: "teal",
      });
      setDeleteModalOpen(false);
      onBack();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  async function handleCancelInvoice() {
    if (!cancelReason.trim()) return;
    setCancelling(true);
    try {
      await cancelInvoice(invoiceId, cancelReason.trim());
      notifications.show({
        title: "Invoice Voided",
        message: "Invoice cancelled and inventory stock returned to warehouse.",
        color: "teal",
      });
      setCancelModalOpen(false);
      setCancelReason("");
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  async function handlePrint(designOverride?: string) {
    try {
      const html = await generateInvoiceHtml(invoiceId, designOverride);
      if (html) {
        printHtmlContent(html);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleExportPdf() {
    try {
      const path = await saveFileDialog({
        title: "Save invoice as PDF",
        defaultPath: `invoice-${invoiceId.slice(0, 8)}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!path) return;
      await generateInvoicePdf(invoiceId, path);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleExportExcel() {
    try {
      const path = await saveFileDialog({
        title: "Save invoice as Excel",
        defaultPath: `invoice-${invoiceId.slice(0, 8)}.xlsx`,
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
      });
      if (!path) return;
      await generateInvoiceExcel(invoiceId, path);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (loading) {
    return <Text c="dimmed">Loading invoice...</Text>;
  }

  if (!details) {
    return <Text c="red">Invoice not found</Text>;
  }

  const { invoice, customer, items, payments } = details;
  const isDraft = invoice.status === "draft";
  const isFinalized = invoice.status === "finalized";

  return (
    <Stack data-tour="invoice-detail">
      {/* Cancellation Notice Banner */}
      {invoice.status === "cancelled" && (
        <Alert color="red" icon={<XCircle size={20} />} title="Invoice Voided / Cancelled" radius="md">
          <Text size="sm">
            This invoice has been cancelled and voided. Deducted items have been restored to warehouse stock, and double-entry accounting entries were reversed.
          </Text>
          {invoice.referenceNote && (
            <Text size="xs" mt={4} c="dimmed">
              Audit Record: {invoice.referenceNote}
            </Text>
          )}
        </Alert>
      )}

      {/* Header */}
      <Group justify="space-between">
        <Group>
          <Button variant="subtle" onClick={onBack}>
            ← Back
          </Button>
          <Title order={3}>{invoice.invoiceNumber}</Title>
          <Badge
            color={STATUS_COLORS[invoice.status] ?? "gray"}
            variant="light"
            size="lg"
          >
            {invoice.status.toUpperCase()}
          </Badge>
          {fbrStatus && fbrStatus.fbrStatus !== "not_submitted" && (
            <Badge
              color={FBR_STATUS_COLORS[fbrStatus.fbrStatus] ?? "gray"}
              variant="outline"
              size="lg"
            >
              FBR: {fbrStatus.fbrStatus}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          <Menu position="bottom-end" withinPortal shadow="md">
            <Menu.Target>
              <Button
                variant="filled"
                color="indigo"
                leftSection={<Printer size={15} />}
                rightSection={<ChevronDown size={14} />}
              >
                Print Slip / Invoice
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Thermal POS Rolls</Menu.Label>
              <Menu.Item
                leftSection={<ReceiptText size={15} />}
                rightSection={<Kbd size="xs">F8</Kbd>}
                onClick={() => void handlePrint("thermal_80mm")}
              >
                Print 80mm POS Slip
              </Menu.Item>
              <Menu.Item
                leftSection={<ReceiptText size={15} />}
                onClick={() => void handlePrint("thermal_58mm")}
              >
                Print 58mm Mini POS Slip
              </Menu.Item>
              <Menu.Divider />
              <Menu.Label>Full Sheet Formats</Menu.Label>
              <Menu.Item
                leftSection={<Printer size={15} />}
                onClick={() => void handlePrint("wholesale_a4")}
              >
                Print Wholesale (A4 Sheet)
              </Menu.Item>
              <Menu.Item
                leftSection={<Printer size={15} />}
                onClick={() => void handlePrint("compact_a5")}
              >
                Print Compact (A5 Sheet)
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={() => void handlePrint()}>
                Print Default Saved Design
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Button
            color="green"
            variant="light"
            leftSection={<MessageSquare size={15} />}
            onClick={handleShareWhatsApp}
          >
            WhatsApp Bill
          </Button>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button variant="outline">Export</Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={handleExportPdf}>Export PDF File</Menu.Item>
              <Menu.Item onClick={handleExportExcel}>Export Excel File</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          {isFinalized && canEdit && (
            <>
              <Button
                variant="outline"
                color="teal"
                onClick={() => setCreditNoteModalOpen(true)}
              >
                Credit Note
              </Button>
              <Button
                variant="outline"
                color="orange"
                onClick={() => setDebitNoteModalOpen(true)}
              >
                Debit Note
              </Button>
            </>
          )}
          {isDraft && canFinalize && (
            <Button color="green" onClick={handleFinalize}>
              ✓ Finalize Invoice
            </Button>
          )}
          {isFinalized && canEdit && (
            <Button color="blue" onClick={() => setPaymentModalOpen(true)}>
              💰 Record Payment
            </Button>
          )}
          {/* Delete Draft Button */}
          {isDraft && canDelete && (
            <Button
              color="red"
              variant="subtle"
              leftSection={<Trash2 size={15} />}
              onClick={() => setDeleteModalOpen(true)}
            >
              Delete Draft
            </Button>
          )}
          {/* Cancel / Void Finalized Invoice Button */}
          {(isFinalized || invoice.status === "paid") && canDelete && (
            <Button
              color="red"
              variant="outline"
              leftSection={<XCircle size={15} />}
              onClick={() => setCancelModalOpen(true)}
            >
              Void Invoice
            </Button>
          )}
        </Group>
      </Group>

      {/* POS Handover Banner when Finalized or Paid */}
      {(isFinalized || invoice.status === "paid") && (
        <Card
          withBorder
          padding="xs"
          radius="md"
          style={{
            background: "rgba(16, 185, 129, 0.08)",
            borderColor: "rgba(16, 185, 129, 0.4)",
          }}
        >
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Group gap="xs">
              <CheckCircle2 size={18} color="#10b981" />
              <div>
                <Text size="xs" fw={700} c="teal">
                  Sale Finalized & Locked
                </Text>
                <Text size="xs" c="dimmed">
                  Fast counter print and customer WhatsApp dispatch
                </Text>
              </div>
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                color="indigo"
                leftSection={<ReceiptText size={13} />}
                rightSection={<Kbd size="xs">F8</Kbd>}
                onClick={() => void handlePrint("thermal_80mm")}
              >
                Print 80mm Slip
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<ReceiptText size={13} />}
                onClick={() => void handlePrint("thermal_58mm")}
              >
                Print 58mm Slip
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<Printer size={13} />}
                onClick={() => void handlePrint("wholesale_a4")}
              >
                Print A4
              </Button>
              <Button
                size="xs"
                color="green"
                variant="light"
                leftSection={<MessageSquare size={13} />}
                onClick={handleShareWhatsApp}
              >
                Send WhatsApp Bill
              </Button>
            </Group>
          </Group>
        </Card>
      )}

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {/* Invoice info */}
      <Grid>
        <Grid.Col span={6}>
          <Card withBorder padding="md">
            <Group justify="space-between" align="center" mb="xs">
              <Title order={5} m={0}>
                Bill To
              </Title>
              {customerTotalDue !== null && (
                customerTotalDue > 0 ? (
                  <Badge color="orange" variant="light" size="sm">
                    ⚠️ Other Pending Khata: {paisaToDisplay(customerTotalDue)} PKR
                  </Badge>
                ) : (
                  <Badge color="teal" variant="light" size="sm">
                    ✓ Other Bills Clear
                  </Badge>
                )
              )}
            </Group>
            <Text fw={500}>{customer.name}</Text>
            {customer.phone && <Text size="sm">Phone: {customer.phone}</Text>}
            {customer.email && <Text size="sm">Email: {customer.email}</Text>}
            {customer.address && <Text size="sm">{customer.address}</Text>}
            {customer.ntn && <Text size="sm">NTN: {customer.ntn}</Text>}
            {customer.cnic && <Text size="sm">CNIC: {customer.cnic}</Text>}
            <Text size="sm" c="dimmed">
              Type: {customer.buyerType}
            </Text>
          </Card>
        </Grid.Col>
        <Grid.Col span={6}>
          <Card withBorder padding="md">
            <Title order={5} mb="xs">
              Invoice Details
            </Title>
            <SimpleGrid cols={2} spacing="xs">
              <Text size="sm" fw={500}>
                Date:
              </Text>
              <Text size="sm">{invoice.invoiceDate}</Text>
              {invoice.dueDate && (
                <>
                  <Text size="sm" fw={500}>
                    Due Date:
                  </Text>
                  <Text size="sm">{invoice.dueDate}</Text>
                </>
              )}
              {invoice.poNumber && (
                <>
                  <Text size="sm" fw={500}>
                    PO Number:
                  </Text>
                  <Text size="sm">{invoice.poNumber}</Text>
                </>
              )}
              <Text size="sm" fw={500}>
                Status:
              </Text>
              <Badge
                color={STATUS_COLORS[invoice.status]}
                variant="light"
                size="sm"
              >
                {invoice.status}
              </Badge>
              {fbrStatus && fbrStatus.fbrStatus !== "not_submitted" && (
                <>
                  <Text size="sm" fw={500}>
                    FBR Status:
                  </Text>
                  <Badge
                    color={FBR_STATUS_COLORS[fbrStatus.fbrStatus] ?? "gray"}
                    variant="light"
                    size="sm"
                  >
                    {fbrStatus.fbrStatus}
                  </Badge>
                </>
              )}
              {fbrStatus?.irn && (
                <>
                  <Text size="sm" fw={500}>
                    IRN:
                  </Text>
                  <Text size="sm" style={{ fontFamily: "monospace" }}>
                    {fbrStatus.irn}
                  </Text>
                </>
              )}
              {fbrStatus?.queueItem?.lastError && (
                <>
                  <Text size="sm" fw={500}>
                    Last Error:
                  </Text>
                  <Text size="xs" c="red" lineClamp={2}>
                    {fbrStatus.queueItem.lastError}
                  </Text>
                </>
              )}
            </SimpleGrid>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Line items */}
      <Group justify="space-between">
        <Title order={5}>Items</Title>
        {isDraft && canEdit && (
          <Button
            size="sm"
            onClick={() => {
              setEditingItem(null);
              setAddItemModalOpen(true);
            }}
          >
            + Add Item
          </Button>
        )}
      </Group>

      {/* Fast Line Item Entry Card for Cashier & Quick Invoicing */}
      {isDraft && canEdit && (
        <Card
          withBorder
          padding="sm"
          radius="md"
          style={{
            background: "var(--app-surface)",
            borderColor: "var(--mantine-color-blue-outline, #3b82f6)",
            borderWidth: 1.5,
          }}
        >
          <Stack gap="sm">
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <Zap size={15} color="var(--mantine-color-blue-6)" />
                <Text size="xs" fw={700} style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Fast Counter Line Entry & Barcode Scanner
                </Text>
              </Group>
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  Press <Kbd size="xs">F2</Kbd> to Scan Barcode • <Kbd size="xs">F8</Kbd> to Print Receipt
                </Text>
              </Group>
            </Group>

            {/* Hardware Barcode Scan Fast-Path */}
            <Group align="flex-end" gap="sm">
              <Box style={{ flex: 1, minWidth: 260 }}>
                <TextInput
                  ref={barcodeInputRef}
                  label="Scan Barcode (Auto-Add)"
                  placeholder="Scan or type barcode / SKU and press Enter..."
                  leftSection={<Barcode size={18} color="var(--mantine-color-blue-6)" />}
                  rightSection={<Kbd size="xs">F2</Kbd>}
                  value={barcodeInput}
                  disabled={isScanning}
                  onChange={(e) => setBarcodeInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleBarcodeScan(barcodeInput);
                    }
                  }}
                  styles={{
                    input: {
                      fontWeight: 600,
                      fontFamily: "monospace",
                      letterSpacing: 0.5,
                    },
                  }}
                />
              </Box>
              <Button
                variant="light"
                color="blue"
                loading={isScanning}
                disabled={!barcodeInput.trim()}
                onClick={() => void handleBarcodeScan(barcodeInput)}
              >
                Scan & Add
              </Button>
            </Group>

            <Divider label="or Manual Product Selection" labelPosition="center" />

            <Group align="flex-end" gap="sm" wrap="wrap">
              <Box style={{ flex: 1, minWidth: 260 }}>
                <Select
                  label="Product"
                  placeholder="Type product name, SKU, or choose..."
                  data={products.map((p) => ({
                    value: p.id,
                    label: `${p.name} [${p.sku}] — ${paisaToDisplay(p.sellPrice)} PKR (${p.quantityInStock} ${p.unit})`,
                  }))}
                  searchable
                  clearable
                  value={quickProductId}
                  onChange={handleQuickProductSelect}
                  styles={{
                    input: { fontWeight: 500 },
                  }}
                />
              </Box>

              <NumberInput
                label="Qty"
                min={1}
                value={quickQuantity}
                onChange={(val) => setQuickQuantity(typeof val === "number" ? val : 1)}
                style={{ width: 85 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleFastAddLine();
                }}
              />

              <NumberInput
                label="Price (PKR)"
                min={0}
                value={quickPrice}
                onChange={(val) => setQuickPrice(typeof val === "number" ? val : 0)}
                style={{ width: 120 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleFastAddLine();
                }}
              />

              <Button
                leftSection={<Plus size={15} />}
                loading={fastAdding}
                disabled={!quickProductId || quickQuantity <= 0}
                onClick={() => void handleFastAddLine()}
                style={{
                  background: "var(--app-accent, #1d2b54)",
                  color: "#ffffff",
                  fontWeight: 600,
                }}
              >
                + Add Line
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      {items.length === 0 ? (
        <Text c="dimmed" ta="center" py="md">
          No items added yet.
        </Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>SKU</Table.Th>
              <Table.Th>Product</Table.Th>
              <Table.Th>Qty</Table.Th>
              <Table.Th>Unit Price</Table.Th>
              <Table.Th>Tax</Table.Th>
              <Table.Th>Discount</Table.Th>
              <Table.Th>Total</Table.Th>
              {isDraft && <Table.Th></Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>
                  <Badge variant="outline" size="sm">
                    {item.productSku}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{item.productName}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{item.quantity}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{paisaToDisplay(item.unitPrice)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {item.taxRate / 100}% = {paisaToDisplay(item.taxAmount)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {item.discountAmount > 0
                      ? item.discountType === "amount"
                        ? `-${paisaToDisplay(item.discountAmount)}`
                        : `${item.discountRate / 100}% = ${paisaToDisplay(item.discountAmount)}`
                      : "—"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {paisaToDisplay(item.lineTotal)}
                  </Text>
                </Table.Td>
                {isDraft && canEdit && (
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        onClick={() => {
                          setEditingItem(item);
                          setAddItemModalOpen(true);
                        }}
                      >
                        ✎
                      </ActionIcon>
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        onClick={() => handleRemoveItem(item.id)}
                      >
                        ✕
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* Totals */}
      <Card withBorder padding="md">
        <Stack gap="xs" align="flex-end">
          <Group w={300}>
            <Text size="sm" style={{ flex: 1 }}>
              Subtotal:
            </Text>
            <Text size="sm" fw={500}>
              {paisaToDisplay(invoice.subtotal)}
            </Text>
          </Group>
          {invoice.discountTotal > 0 && (
            <Group w={300}>
              <Text size="sm" c="red" style={{ flex: 1 }}>
                Discount:
              </Text>
              <Text size="sm" c="red">
                -{paisaToDisplay(invoice.discountTotal)}
              </Text>
            </Group>
          )}
          {invoice.taxTotal > 0 && (
            <Group w={300}>
              <Text size="sm" style={{ flex: 1 }}>
                Tax:
              </Text>
              <Text size="sm">{paisaToDisplay(invoice.taxTotal)}</Text>
            </Group>
          )}
          <Divider w={300} />
          <Group w={300}>
            <Text fw={700} style={{ flex: 1 }}>
              Grand Total:
            </Text>
            <Text fw={700} size="lg">
              {paisaToDisplay(invoice.grandTotal)}
            </Text>
          </Group>
          <Group w={300}>
            <Text size="sm" style={{ flex: 1 }}>
              Paid:
            </Text>
            <Text size="sm" c="green">
              {paisaToDisplay(invoice.amountPaid)}
            </Text>
          </Group>
          <Group w={300}>
            <Text fw={500} style={{ flex: 1 }}>
              Balance Due:
            </Text>
            <Text
              fw={500}
              size="lg"
              c={invoice.balanceDue > 0 ? "orange" : "green"}
            >
              {paisaToDisplay(invoice.balanceDue)}
            </Text>
          </Group>
        </Stack>
      </Card>

      {/* Payments */}
      {payments.length > 0 && (
        <>
          <Title order={5}>Payments</Title>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Method</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Reference</Table.Th>
                <Table.Th>Notes</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {payments.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    <Text size="sm">{p.paymentDate}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" size="sm">
                      {p.paymentMethod}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {paisaToDisplay(p.amount)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{p.reference ?? "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{p.notes ?? "—"}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}

      {/* Add/Edit Item Modal */}
      <AddItemModal
        opened={addItemModalOpen}
        onClose={() => {
          setEditingItem(null);
          setAddItemModalOpen(false);
        }}
        onAdd={handleAddItem}
        onUpdate={handleUpdateItem}
        editingItem={editingItem}
        products={products}
        currencyConfig={currencyConfig}
      />

      {/* Payment Modal */}
      <InvoicePaymentModal
        opened={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        onRecord={handleRecordPayment}
        balanceDue={invoice.balanceDue}
        invoiceNumber={invoice.invoiceNumber}
        currencyConfig={currencyConfig}
      />

      {/* Credit Note Modal */}
      <Modal
        opened={creditNoteModalOpen}
        onClose={() => setCreditNoteModalOpen(false)}
        title="Create Credit Note"
        size="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Creates a credit note referencing this invoice&apos;s FBR IRN. The
            credit amount reduces what the buyer owes.
          </Text>
          <TextInput
            label="Reason for credit note"
            placeholder="e.g. Goods returned, pricing correction"
            value={creditNoteReason}
            onChange={(e) => setCreditNoteReason(e.currentTarget.value)}
          />
          <NumberInput
            label="Credit amount"
            prefix={details?.invoice.currencyCode === "PKR" ? "PKR " : ""}
            value={creditNoteAmount}
            onChange={(v) => setCreditNoteAmount(typeof v === "number" ? v : 0)}
            min={0}
          />
          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() => setCreditNoteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              color="teal"
              onClick={() => void handleCreateCreditNote()}
              disabled={!creditNoteReason || creditNoteAmount <= 0}
            >
              Create Credit Note
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Debit Note Modal */}
      <Modal
        opened={debitNoteModalOpen}
        onClose={() => setDebitNoteModalOpen(false)}
        title="Create Debit Note"
        size="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Creates a debit note referencing this invoice&apos;s FBR IRN. The
            debit amount increases what the buyer owes.
          </Text>
          <TextInput
            label="Reason for debit note"
            placeholder="e.g. Additional charges, undercharged"
            value={debitNoteReason}
            onChange={(e) => setDebitNoteReason(e.currentTarget.value)}
          />
          <NumberInput
            label="Debit amount"
            prefix={details?.invoice.currencyCode === "PKR" ? "PKR " : ""}
            value={debitNoteAmount}
            onChange={(v) => setDebitNoteAmount(typeof v === "number" ? v : 0)}
            min={0}
          />
          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() => setDebitNoteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={() => void handleCreateDebitNote()}
              disabled={!debitNoteReason || debitNoteAmount <= 0}
            >
              Create Debit Note
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Draft Modal */}
      <Modal
        opened={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Draft Invoice"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Are you sure you want to permanently delete draft invoice{" "}
            <strong>{invoice.invoiceNumber}</strong>?
          </Text>
          <Text size="xs" c="dimmed">
            Line items will be removed. Because this invoice is still a draft, inventory stock and financial accounts will not be affected.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={deleting}
              onClick={handleDeleteInvoice}
            >
              Delete Draft
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Cancel / Void Invoice Modal */}
      <Modal
        opened={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title={`Void / Cancel Invoice ${invoice.invoiceNumber}`}
        centered
      >
        <Stack gap="md">
          <Alert color="red" icon={<AlertTriangle size={16} />} variant="light">
            <Text size="xs" fw={700}>
              Warning: This action will cancel invoice {invoice.invoiceNumber}.
            </Text>
            <Text size="xs">
              All deducted products will be automatically returned to inventory stock, and reversing accounting ledger entries will be posted.
            </Text>
          </Alert>

          <TextInput
            label="Reason for Cancellation"
            placeholder="e.g. Customer returned items, wrong billing, created by mistake"
            required
            value={cancelReason}
            onChange={(e) => setCancelReason(e.currentTarget.value)}
          />

          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setCancelModalOpen(false)}>
              Go Back
            </Button>
            <Button
              color="red"
              loading={cancelling}
              disabled={!cancelReason.trim()}
              onClick={handleCancelInvoice}
            >
              Confirm Void & Return Stock
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// ==========================================
// ADD ITEM MODAL
// ==========================================

function AddItemModal({
  opened,
  onClose,
  onAdd,
  onUpdate,
  editingItem,
  products,
  currencyConfig,
}: {
  opened: boolean;
  onClose: () => void;
  onAdd: (values: {
    productId: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discountType: string;
    discountValue: number;
  }) => Promise<void>;
  onUpdate: (
    values: {
      productId: string;
      quantity: number;
      unitPrice: number;
      taxRate: number;
      discountType: string;
      discountValue: number;
    },
    itemId: string,
  ) => Promise<void>;
  editingItem: PublicInvoiceItem | null;
  products: PublicProduct[];
  currencyConfig?: CurrencyConfig | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = editingItem !== null;

  const form = useForm({
    initialValues: {
      productId: "",
      quantity: 1,
      unitPrice: 0,
      taxRate: 0,
      discountType: "percent" as string,
      discountValue: 0,
    },
    validate: {
      productId: (v) => (v ? null : "Select a product"),
      quantity: (v) => (v > 0 ? null : "Must be > 0"),
    },
  });

  // Populate the form when opening in edit mode
  useEffect(() => {
    if (opened && editingItem) {
      form.setValues({
        productId: editingItem.productId,
        quantity: editingItem.quantity,
        unitPrice: paisaToNumber(editingItem.unitPrice, currencyConfig),
        taxRate: editingItem.taxRate / 100,
        discountType: editingItem.discountType === "amount" ? "amount" : "percent",
        discountValue:
          editingItem.discountType === "amount"
            ? paisaToNumber(editingItem.discountAmount, currencyConfig)
            : editingItem.discountRate / 100,
      });
    } else if (opened) {
      form.reset();
    }
  }, [opened, editingItem, currencyConfig]);

  // Auto-fill price when product changes
  function handleProductChange(productId: string) {
    form.setFieldValue("productId", productId);
    const product = products.find((p) => p.id === productId);
    if (product) {
      form.setFieldValue(
        "unitPrice",
        paisaToNumber(product.sellPrice, currencyConfig),
      );
      form.setFieldValue("taxRate", product.taxRate / 100);
    }
  }

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    const payload = {
      productId: values.productId,
      quantity: values.quantity,
      unitPrice: displayToPaisa(values.unitPrice, currencyConfig),
      taxRate: Math.round(values.taxRate * 100),
      discountType: values.discountType,
      discountValue:
        values.discountType === "amount"
          ? displayToPaisa(values.discountValue, currencyConfig)
          : Math.round(values.discountValue * 100),
    };
    try {
      if (isEdit && editingItem) {
        await onUpdate(payload, editingItem.id);
      } else {
        await onAdd(payload);
      }
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const productOptions = products
    .filter((p) => p.isActive)
    .map((p) => ({
      value: p.id,
      label: `${p.name} (${p.sku}) — Stock: ${p.quantityInStock}`,
    }));

  const preview = computeLinePreview({
    quantity: form.values.quantity,
    unitPricePaisa: displayToPaisa(form.values.unitPrice, currencyConfig),
    taxRateBp: Math.round(form.values.taxRate * 100),
    discountType: form.values.discountType,
    discountValue:
      form.values.discountType === "amount"
        ? displayToPaisa(form.values.discountValue, currencyConfig)
        : Math.round(form.values.discountValue * 100),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? "Edit Item" : "Add Item"}
      centered
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Select
            label="Product"
            placeholder="Select product"
            data={productOptions}
            required
            searchable
            disabled={isEdit}
            value={form.values.productId}
            onChange={(v) => v && handleProductChange(v)}
          />

          <SimpleGrid cols={2}>
            <NumberInput
              label="Quantity"
              min={1}
              required
              {...form.getInputProps("quantity")}
            />
            <NumberInput
              label="Unit Price"
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...form.getInputProps("unitPrice")}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <NumberInput
              label="Tax Rate %"
              decimalScale={2}
              fixedDecimalScale
              suffix="%"
              min={0}
              max={100}
              {...form.getInputProps("taxRate")}
            />
            <Select
              label="Discount Type"
              data={[
                { value: "percent", label: "Percentage (%)" },
                { value: "amount", label: "Fixed Amount (Rs)" },
              ]}
              {...form.getInputProps("discountType")}
            />
          </SimpleGrid>

          <NumberInput
            label={
              form.values.discountType === "amount"
                ? "Discount Amount (Rs)"
                : "Discount %"
            }
            placeholder={
              form.values.discountType === "amount" ? "e.g. 500" : "e.g. 10"
            }
            decimalScale={2}
            fixedDecimalScale
            suffix={form.values.discountType === "percent" ? "%" : ""}
            min={0}
            {...form.getInputProps("discountValue")}
          />

          {/* Preview */}
          {preview.subtotal > 0 && (
            <Alert color="blue" variant="light">
              <Text size="sm">
                Line total:{" "}
                <Text span fw={700}>
                  {paisaToDisplay(preview.total, currencyConfig)} {getCurrencyCode(currencyConfig)}
                </Text>{" "}
                (Subtotal {paisaToDisplay(preview.subtotal, currencyConfig)} − Discount{" "}
                {paisaToDisplay(preview.discount, currencyConfig)} + Tax{" "}
                {paisaToDisplay(preview.tax, currencyConfig)}, rounded to nearest rupee)
              </Text>
            </Alert>
          )}

          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {isEdit ? "Save Changes" : "Add Item"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

