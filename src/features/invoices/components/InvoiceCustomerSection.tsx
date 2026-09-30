import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Text,
  TextInput,
} from "@mantine/core";
import { AlertTriangle, UserPlus, Zap } from "lucide-react";
import { AppDateInput } from "../../../components/AppDateInput";
import { MoneyText } from "../../../shared/ui/MoneyText";
import type { CurrencyConfig } from "../../../types/backend";

interface InvoiceCustomerSectionProps {
  customerOptions: { value: string; label: string }[];
  customerId: string;
  onCustomerIdChange: (id: string) => void;
  invoiceDate: string;
  onInvoiceDateChange: (date: string) => void;
  dueDate: string;
  onDueDateChange: (date: string) => void;
  isWalkinCustomer: boolean;
  walkinName: string;
  onWalkinNameChange: (val: string) => void;
  walkinPhone: string;
  onWalkinPhoneChange: (val: string) => void;
  customerPendingDue: number;
  poNumber: string;
  onPoNumberChange: (val: string) => void;
  referenceNote: string;
  onReferenceNoteChange: (val: string) => void;
  currencyConfig: CurrencyConfig | null;
  onSelectWalkin: () => void;
  onOpenNewCustomerModal: () => void;
}

export function InvoiceCustomerSection({
  customerOptions,
  customerId,
  onCustomerIdChange,
  invoiceDate,
  onInvoiceDateChange,
  dueDate,
  onDueDateChange,
  isWalkinCustomer,
  walkinName,
  onWalkinNameChange,
  walkinPhone,
  onWalkinPhoneChange,
  customerPendingDue,
  poNumber,
  onPoNumberChange,
  referenceNote,
  onReferenceNoteChange,
  currencyConfig,
  onSelectWalkin,
  onOpenNewCustomerModal,
}: InvoiceCustomerSectionProps) {
  return (
    <Card
      withBorder
      radius="md"
      padding="md"
      shadow="xs"
      style={{ background: "var(--app-surface)" }}
    >
      <Group justify="space-between" align="center" mb="xs">
        <Text
          size="xs"
          fw={700}
          c="dimmed"
          style={{ textTransform: "uppercase", letterSpacing: 0.8 }}
        >
          1. Customer & Billing Terms
        </Text>
        <Group gap="xs">
          <Button
            size="xs"
            variant="light"
            color="teal"
            leftSection={<Zap size={14} />}
            onClick={onSelectWalkin}
          >
            ⚡ Cash / Walk-in
          </Button>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<UserPlus size={14} />}
            onClick={onOpenNewCustomerModal}
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
          onChange={(v) => onCustomerIdChange(v || "")}
        />
        <SimpleGrid cols={2} spacing="xs">
          <AppDateInput
            label="Invoice Date"
            value={invoiceDate}
            onChange={onInvoiceDateChange}
          />
          <AppDateInput
            label="Due Date"
            value={dueDate}
            onChange={onDueDateChange}
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
              onChange={(e) => onWalkinNameChange(e.currentTarget.value)}
            />
            <TextInput
              placeholder="Phone # (optional, e.g. 0300-1234567)"
              size="xs"
              value={walkinPhone}
              onChange={(e) => onWalkinPhoneChange(e.currentTarget.value)}
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
              Existing Customer Khata Balance:{" "}
              <MoneyText paisa={customerPendingDue} currencyConfig={currencyConfig} />
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
          onChange={(e) => onPoNumberChange(e.currentTarget.value)}
        />
        <TextInput
          label="Delivery / Memo Note"
          placeholder="Terms, dispatch details or notes"
          size="xs"
          value={referenceNote}
          onChange={(e) => onReferenceNoteChange(e.currentTarget.value)}
        />
      </SimpleGrid>
    </Card>
  );
}
