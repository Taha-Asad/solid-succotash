import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Kbd,
  Menu,
  Text,
  Title,
} from "@mantine/core";
import {
  CheckCircle2,
  ChevronDown,
  MessageSquare,
  Printer,
  ReceiptText,
  Trash2,
  XCircle,
} from "lucide-react";
import type { InvoiceFbrStatus, PublicInvoice } from "../../../types/backend";
import { FBR_STATUS_COLORS, STATUS_COLORS } from "../utils/invoiceHelpers";

interface InvoiceDetailActionsProps {
  invoice: PublicInvoice;
  fbrStatus: InvoiceFbrStatus | null;
  onBack: () => void;
  onPrint: (designOverride?: string) => void;
  onShareWhatsApp: () => void;
  onExportPdf: () => void;
  onExportExcel: () => void;
  onOpenCreditNote: () => void;
  onOpenDebitNote: () => void;
  onFinalize: () => void;
  onOpenPayment: () => void;
  onOpenDelete: () => void;
  onOpenCancel: () => void;
  canFinalize: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function InvoiceDetailActions({
  invoice,
  fbrStatus,
  onBack,
  onPrint,
  onShareWhatsApp,
  onExportPdf,
  onExportExcel,
  onOpenCreditNote,
  onOpenDebitNote,
  onFinalize,
  onOpenPayment,
  onOpenDelete,
  onOpenCancel,
  canFinalize,
  canEdit,
  canDelete,
}: InvoiceDetailActionsProps) {
  const isDraft = invoice.status === "draft";
  const isFinalized = invoice.status === "finalized";
  const isPaid = invoice.status === "paid";

  return (
    <>
      {/* Cancellation Notice Banner */}
      {invoice.status === "cancelled" && (
        <Alert
          color="red"
          icon={<XCircle size={20} />}
          title="Invoice Voided / Cancelled"
          radius="md"
        >
          <Text size="sm">
            This invoice has been cancelled and voided. Deducted items have been
            restored to warehouse stock, and double-entry accounting entries were
            reversed.
          </Text>
          {invoice.referenceNote && (
            <Text size="xs" mt={4} c="dimmed">
              Audit Record: {invoice.referenceNote}
            </Text>
          )}
        </Alert>
      )}

      {/* Header & Primary Actions */}
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group wrap="wrap" gap="xs">
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

        <Group gap="xs" wrap="wrap">
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
                onClick={() => onPrint("thermal_80mm")}
              >
                Print 80mm POS Slip
              </Menu.Item>
              <Menu.Item
                leftSection={<ReceiptText size={15} />}
                onClick={() => onPrint("thermal_58mm")}
              >
                Print 58mm Mini POS Slip
              </Menu.Item>
              <Menu.Divider />
              <Menu.Label>Full Sheet Formats</Menu.Label>
              <Menu.Item
                leftSection={<Printer size={15} />}
                onClick={() => onPrint("wholesale_a4")}
              >
                Print Wholesale (A4 Sheet)
              </Menu.Item>
              <Menu.Item
                leftSection={<Printer size={15} />}
                onClick={() => onPrint("compact_a5")}
              >
                Print Compact (A5 Sheet)
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item onClick={() => onPrint()}>
                Print Default Saved Design
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>

          <Button
            color="green"
            variant="light"
            leftSection={<MessageSquare size={15} />}
            onClick={onShareWhatsApp}
          >
            WhatsApp Bill
          </Button>

          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button variant="outline">Export</Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={onExportPdf}>Export PDF File</Menu.Item>
              <Menu.Item onClick={onExportExcel}>Export Excel File</Menu.Item>
            </Menu.Dropdown>
          </Menu>

          {isFinalized && canEdit && (
            <>
              <Button
                variant="outline"
                color="teal"
                onClick={onOpenCreditNote}
              >
                Credit Note
              </Button>
              <Button
                variant="outline"
                color="orange"
                onClick={onOpenDebitNote}
              >
                Debit Note
              </Button>
            </>
          )}

          {isDraft && canFinalize && (
            <Button color="green" onClick={onFinalize}>
              ✓ Finalize Invoice
            </Button>
          )}

          {isFinalized && canEdit && (
            <Button color="blue" onClick={onOpenPayment}>
              💰 Record Payment
            </Button>
          )}

          {isDraft && canDelete && (
            <Button
              color="red"
              variant="subtle"
              leftSection={<Trash2 size={15} />}
              onClick={onOpenDelete}
            >
              Delete Draft
            </Button>
          )}

          {(isFinalized || isPaid) && canDelete && (
            <Button
              color="red"
              variant="outline"
              leftSection={<XCircle size={15} />}
              onClick={onOpenCancel}
            >
              Void Invoice
            </Button>
          )}
        </Group>
      </Group>

      {/* POS Handover Banner when Finalized or Paid */}
      {(isFinalized || isPaid) && (
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
                onClick={() => onPrint("thermal_80mm")}
              >
                Print 80mm Slip
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<ReceiptText size={13} />}
                onClick={() => onPrint("thermal_58mm")}
              >
                Print 58mm Slip
              </Button>
              <Button
                size="xs"
                variant="default"
                leftSection={<Printer size={13} />}
                onClick={() => onPrint("wholesale_a4")}
              >
                Print A4
              </Button>
              <Button
                size="xs"
                color="green"
                variant="light"
                leftSection={<MessageSquare size={13} />}
                onClick={onShareWhatsApp}
              >
                Send WhatsApp Bill
              </Button>
            </Group>
          </Group>
        </Card>
      )}
    </>
  );
}
