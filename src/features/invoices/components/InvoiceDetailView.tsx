import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  addInvoiceItem,
  cancelInvoice,
  createCreditNote,
  createDebitNote,
  deleteInvoice,
  finalizeInvoice,
  generateInvoiceExcel,
  generateInvoiceHtml,
  generateInvoicePdf,
  getCompanyCurrency,
  getErrorMessage,
  getInvoice,
  getInvoiceFbrStatus,
  listInvoices,
  listProducts,
  recordPayment,
  removeInvoiceItem,
  saveFileDialog,
  updateInvoiceItem,
} from "../../../api/backend";
import { usePermissions } from "../../permissions/PermissionsProvider";
import { reportOnboardingEvent } from "../../../onboarding/bus";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { printHtmlContent } from "../../../utils/printInvoice";
import {
  formatWhatsAppNumber,
  launchWhatsAppUrl,
} from "../../../utils/whatsapp";
import { paisaToNumber } from "../../../utils/currency";
import type {
  CurrencyConfig,
  InvoiceFbrStatus,
  InvoiceWithDetails,
  PublicInvoiceItem,
  PublicProduct,
} from "../../../types/backend";
import { displayToPaisa, paisaToDisplay } from "../utils/invoiceHelpers";
import { playPosBeepTone, playPosErrorTone } from "../utils/posAudio";
import { InvoiceDetailActions } from "./InvoiceDetailActions";
import { InvoiceDetailOverview } from "./InvoiceDetailOverview";
import { InvoiceFastEntryCard } from "./InvoiceFastEntryCard";
import { InvoiceDetailItemsTable } from "./InvoiceDetailItemsTable";
import { InvoiceDetailTotals } from "./InvoiceDetailTotals";
import { AddItemModal } from "./AddItemModal";
import {
  InvoicePaymentModal,
  type RecordPaymentValues,
} from "../../payments/InvoicePaymentModal";

interface InvoiceDetailViewProps {
  invoiceId: string;
  onBack: () => void;
}

export function InvoiceDetailView({ invoiceId, onBack }: InvoiceDetailViewProps) {
  const perms = usePermissions();
  const canFinalize = perms.can("invoices", "finalize");
  const canEdit = perms.can("invoices", "edit");
  const canDelete =
    perms.can("invoices", "delete") || perms.can("invoices", "edit");

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
  const [currencyConfig, setCurrencyConfig] = useState<CurrencyConfig | null>(
    null,
  );

  // Invoice Deletion & Cancellation States
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fast Line Item Entry state
  const [quickProductId, setQuickProductId] = useState<string | null>(null);
  const [quickQuantity, setQuickQuantity] = useState<number>(1);
  const [quickPrice, setQuickPrice] = useState<number>(0);
  const [fastAdding, setFastAdding] = useState(false);

  // Hardware Barcode Scanner & POS Fast-Path state
  const [barcodeInput, setBarcodeInput] = useState("");
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [invDetails, prods, curConfig] = await Promise.all([
        getInvoice(invoiceId),
        listProducts(),
        getCompanyCurrency(),
      ]);
      setDetails(invDetails);
      setProducts(prods);
      setCurrencyConfig(curConfig);
      setError(null);

      // Best-effort customer other unpaid invoices summary
      try {
        const allInvoices = await listInvoices();
        const otherUnpaid = allInvoices.filter(
          (i) =>
            i.customerId === invDetails.invoice.customerId &&
            i.id !== invoiceId &&
            i.status !== "cancelled" &&
            i.balanceDue > 0,
        );
        const sumDue = otherUnpaid.reduce((acc, curr) => acc + curr.balanceDue, 0);
        setCustomerTotalDue(sumDue);
      } catch {
        setCustomerTotalDue(null);
      }

      // Best-effort FBR status lookup
      try {
        const fbr = await getInvoiceFbrStatus(invoiceId);
        setFbrStatus(fbr);
      } catch {
        setFbrStatus(null);
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

  async function handleBarcodeScan(scannedCode: string) {
    const raw = scannedCode.trim();
    if (!raw) return;

    const matched = products.find((p) => {
      if (p.sku.toLowerCase() === raw.toLowerCase()) return true;
      if (p.customFields) {
        try {
          const parsed = JSON.parse(p.customFields);
          if (
            parsed.barcode &&
            String(parsed.barcode).toLowerCase() === raw.toLowerCase()
          ) {
            return true;
          }
        } catch {
          // ignore
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
    const found = products.find((p) => p.id === quickProductId);
    if (!found) return;

    setFastAdding(true);
    try {
      await addInvoiceItem({
        invoiceId,
        productId: quickProductId,
        quantity: quickQuantity,
        unitPrice: displayToPaisa(quickPrice, currencyConfig),
        taxRate: found.taxRate,
        discountType: "percent",
        discountValue: 0,
      });
      playPosBeepTone();
      setQuickProductId(null);
      setQuickQuantity(1);
      setQuickPrice(0);
      await load();
      setTimeout(() => barcodeInputRef.current?.focus(), 50);
    } catch (err) {
      playPosErrorTone();
      setError(getErrorMessage(err));
    } finally {
      setFastAdding(false);
    }
  }

  async function handleShareWhatsApp() {
    if (!details) return;
    const customerPhone = details.customer.phone;
    if (!customerPhone) {
      notifications.show({
        title: "No Customer Phone",
        message: "Customer record does not have a phone number.",
        color: "yellow",
      });
      return;
    }

    const formatted = formatWhatsAppNumber(customerPhone);
    const balanceText =
      details.invoice.balanceDue > 0
        ? `Balance Due: ${paisaToDisplay(details.invoice.balanceDue)} PKR`
        : "Bill is fully settled. Thank you!";

    const message = `Hello ${details.customer.name}, your bill #${details.invoice.invoiceNumber} for Rs. ${paisaToDisplay(details.invoice.grandTotal)} has been issued on ${details.invoice.invoiceDate}. ${balanceText} - Ijaz & Co.`;

    try {
      const url = `https://wa.me/${formatted}?text=${encodeURIComponent(message)}`;
      await launchWhatsAppUrl(url);
    } catch (err) {
      notifications.show({
        title: "WhatsApp Dispatch Failed",
        message: getErrorMessage(err),
        color: "red",
      });
    }
  }

  async function handleAddItem(values: {
    productId: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discountType: string;
    discountValue: number;
  }) {
    await addInvoiceItem({ invoiceId, ...values });
    setAddItemModalOpen(false);
    await load();
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
    await updateInvoiceItem({ invoiceId, itemId, ...values });
    setAddItemModalOpen(false);
    setEditingItem(null);
    await load();
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

  async function handleRecordPayment(values: RecordPaymentValues) {
    try {
      await recordPayment({ invoiceId, ...values });
      setPaymentModalOpen(false);
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  async function handleCreateCreditNote() {
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
      setDeleteModalOpen(false);
      onBack();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  async function handleCancelInvoice() {
    if (!cancelReason.trim()) {
      setError("Please provide a cancellation reason for the audit log.");
      return;
    }
    setCancelling(true);
    try {
      await cancelInvoice(invoiceId, cancelReason.trim());
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
      printHtmlContent(html);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleExportPdf() {
    try {
      const path = await saveFileDialog({
        defaultPath: `Invoice_${details?.invoice.invoiceNumber ?? invoiceId}.pdf`,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
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
        defaultPath: `Invoice_${details?.invoice.invoiceNumber ?? invoiceId}.xlsx`,
        filters: [{ name: "Excel Spreadsheet", extensions: ["xlsx"] }],
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

  return (
    <Stack data-tour="invoice-detail" gap="lg">
      {/* Actions & Header */}
      <InvoiceDetailActions
        invoice={invoice}
        fbrStatus={fbrStatus}
        onBack={onBack}
        onPrint={handlePrint}
        onShareWhatsApp={handleShareWhatsApp}
        onExportPdf={handleExportPdf}
        onExportExcel={handleExportExcel}
        onOpenCreditNote={() => setCreditNoteModalOpen(true)}
        onOpenDebitNote={() => setDebitNoteModalOpen(true)}
        onFinalize={handleFinalize}
        onOpenPayment={() => setPaymentModalOpen(true)}
        onOpenDelete={() => setDeleteModalOpen(true)}
        onOpenCancel={() => setCancelModalOpen(true)}
        canFinalize={canFinalize}
        canEdit={canEdit}
        canDelete={canDelete}
      />

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {/* Bill To & Invoice Details */}
      <InvoiceDetailOverview
        invoice={invoice}
        customer={customer}
        customerTotalDue={customerTotalDue}
        fbrStatus={fbrStatus}
      />

      {/* Line Items Section Header */}
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

      {/* Fast Counter Line Entry */}
      {isDraft && canEdit && (
        <InvoiceFastEntryCard
          barcodeInputRef={barcodeInputRef}
          barcodeInput={barcodeInput}
          isScanning={isScanning}
          onBarcodeInput={setBarcodeInput}
          onBarcodeScan={(code) => void handleBarcodeScan(code)}
          products={products}
          quickProductId={quickProductId}
          onQuickProductSelect={handleQuickProductSelect}
          quickQuantity={quickQuantity}
          onQuickQuantityChange={setQuickQuantity}
          quickPrice={quickPrice}
          onQuickPriceChange={setQuickPrice}
          fastAdding={fastAdding}
          onFastAddLine={() => void handleFastAddLine()}
        />
      )}

      {/* Line Items Table */}
      <InvoiceDetailItemsTable
        items={items}
        isDraft={isDraft}
        canEdit={canEdit}
        onEditItem={(item) => {
          setEditingItem(item);
          setAddItemModalOpen(true);
        }}
        onRemoveItem={handleRemoveItem}
      />

      {/* Totals & Payments */}
      <InvoiceDetailTotals invoice={invoice} payments={payments} />

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
          <NumberInput
            label="Credit Amount (Rs.)"
            placeholder="e.g. 500"
            value={creditNoteAmount / 100}
            onChange={(val) =>
              setCreditNoteAmount(
                typeof val === "number" ? Math.round(val * 100) : 0,
              )
            }
            min={0}
            max={invoice.grandTotal / 100}
          />
          <TextInput
            label="Reason"
            placeholder="e.g. Goods returned, damaged items"
            value={creditNoteReason}
            onChange={(e) => setCreditNoteReason(e.currentTarget.value)}
            required
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
              disabled={creditNoteAmount <= 0 || !creditNoteReason.trim()}
              onClick={handleCreateCreditNote}
            >
              Issue Credit Note
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
          <NumberInput
            label="Debit Amount (Rs.)"
            placeholder="e.g. 200"
            value={debitNoteAmount / 100}
            onChange={(val) =>
              setDebitNoteAmount(
                typeof val === "number" ? Math.round(val * 100) : 0,
              )
            }
            min={0}
          />
          <TextInput
            label="Reason"
            placeholder="e.g. Price revision, additional charges"
            value={debitNoteReason}
            onChange={(e) => setDebitNoteReason(e.currentTarget.value)}
            required
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
              disabled={debitNoteAmount <= 0 || !debitNoteReason.trim()}
              onClick={handleCreateDebitNote}
            >
              Issue Debit Note
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete Draft Confirm Dialog */}
      <ConfirmDialog
        opened={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteInvoice}
        title="Delete Draft Invoice"
        message={
          <>
            Are you sure you want to permanently delete draft invoice{" "}
            <strong>{invoice.invoiceNumber}</strong>?
          </>
        }
        subtitle="This action cannot be undone. All unfinalized line items will be removed."
        confirmLabel="Delete Draft"
        danger
        loading={deleting}
      />

      {/* Void Finalized Invoice Modal */}
      <Modal
        opened={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title="Void / Cancel Finalized Invoice"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Voiding invoice <strong>{invoice.invoiceNumber}</strong> will reverse
            all inventory deductions (restoring stock levels) and create
            compensating double-entry accounting entries.
          </Text>
          <TextInput
            label="Reason for Cancellation"
            placeholder="e.g. Customer cancelled order, billing error"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.currentTarget.value)}
            required
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setCancelModalOpen(false)}>
              Keep Invoice
            </Button>
            <Button
              color="red"
              loading={cancelling}
              disabled={!cancelReason.trim()}
              onClick={handleCancelInvoice}
            >
              Confirm Void
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
