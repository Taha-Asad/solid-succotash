// ==========================================
// FEATURE: INVOICE PAYMENT MODAL
// ==========================================
//
// Standalone cashier modal for recording invoice payments.
// Features:
// - Exact integer minor units (paisa) representation.
// - Quick-cash chips for rapid cashier settlement.
// - Change-to-return / shortage calculation.
// - Double-click / retry idempotency protection.
// - Accessible Mantine form state.

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Divider,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { AlertCircle, Check, Coins } from "lucide-react";
import { AppDateInput } from "../../components/AppDateInput";
import { MoneyText } from "../../shared/ui/MoneyText";
import {
  paisaToNumber,
  displayToPaisa,
  getCurrencyCode,
} from "../../utils/currency";
import type { CurrencyConfig } from "../../types/backend";

export interface RecordPaymentValues {
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  reference: string;
  notes: string;
  idempotencyKey?: string;
}

interface InvoicePaymentModalProps {
  opened: boolean;
  onClose: () => void;
  onRecord: (values: RecordPaymentValues) => Promise<void>;
  balanceDue: number;
  invoiceNumber?: string;
  currencyConfig?: CurrencyConfig | null;
}

export function InvoicePaymentModal({
  opened,
  onClose,
  onRecord,
  balanceDue,
  invoiceNumber,
  currencyConfig,
}: InvoicePaymentModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashTendered, setCashTendered] = useState<number | string>("");

  // Unique key generated per modal open session to ensure backend idempotency
  const idempotencyKey = useMemo(
    () => (opened ? `pay-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` : ""),
    [opened],
  );

  const initialRupees = useMemo(
    () => paisaToNumber(balanceDue, currencyConfig),
    [balanceDue, currencyConfig],
  );

  const form = useForm({
    initialValues: {
      amount: initialRupees,
      paymentMethod: "cash",
      paymentDate: new Date().toISOString().split("T")[0],
      reference: "",
      notes: "",
    },
    validate: {
      amount: (val) => (val <= 0 ? "Payment amount must be greater than zero" : null),
      paymentMethod: (val) => (!val ? "Select a payment method" : null),
    },
  });

  useEffect(() => {
    if (opened) {
      form.setFieldValue("amount", paisaToNumber(balanceDue, currencyConfig));
      setCashTendered("");
      setError(null);
    }
  }, [balanceDue, opened, currencyConfig]);

  const billAmount = Number(form.values.amount) || 0;
  const tenderedNum =
    typeof cashTendered === "number"
      ? cashTendered
      : parseFloat(String(cashTendered).replace(/,/g, "")) || 0;

  const changeToReturn = tenderedNum > billAmount ? tenderedNum - billAmount : 0;
  const isShort = tenderedNum > 0 && tenderedNum < billAmount;

  // Quick cash chips based on bill amount in whole rupees
  const quickCashOptions = useMemo(() => {
    if (billAmount <= 0) return [];
    const options = [{ label: "Exact", val: billAmount }];
    if (billAmount < 500) options.push({ label: "Rs. 500", val: 500 });
    if (billAmount < 1000) options.push({ label: "Rs. 1,000", val: 1000 });
    if (billAmount < 5000) options.push({ label: "Rs. 5,000", val: 5000 });
    if (billAmount >= 5000) {
      const nextThousand = Math.ceil(billAmount / 1000) * 1000;
      if (nextThousand > billAmount) {
        options.push({
          label: `Rs. ${nextThousand.toLocaleString()}`,
          val: nextThousand,
        });
      }
    }
    return options;
  }, [billAmount]);

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    try {
      await onRecord({
        amount: displayToPaisa(values.amount, currencyConfig),
        paymentMethod: values.paymentMethod,
        paymentDate: values.paymentDate,
        reference: values.reference,
        notes: values.notes,
        idempotencyKey,
      });
      form.reset();
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Coins size={20} color="#C9952A" />
          <Text fw={700}>Record Payment</Text>
          {invoiceNumber && (
            <Text size="sm" c="dimmed">
              ({invoiceNumber})
            </Text>
          )}
        </Group>
      }
      centered
      size="md"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          {error && (
            <Alert icon={<AlertCircle size={16} />} color="red" title="Payment Error">
              {error}
            </Alert>
          )}

          <Group justify="space-between" p="xs" bg="var(--mantine-color-default-hover)" style={{ borderRadius: 6 }}>
            <Text size="sm" c="dimmed">
              Remaining Balance Due:
            </Text>
            <Text fw={700} size="md">
              <MoneyText paisa={balanceDue} currencyConfig={currencyConfig} />
            </Text>
          </Group>

          <NumberInput
            label="Payment Amount"
            description={`Amount to credit against invoice in ${getCurrencyCode(currencyConfig)}`}
            decimalScale={2}
            fixedDecimalScale
            min={0.01}
            required
            {...form.getInputProps("amount")}
          />

          <SimpleGrid cols={2}>
            <Select
              label="Payment Method"
              data={[
                { value: "cash", label: "Cash" },
                { value: "bank_transfer", label: "Bank Transfer" },
                { value: "card", label: "Debit/Credit Card" },
                { value: "cheque", label: "Cheque" },
                { value: "online", label: "Online" },
                { value: "other", label: "Other" },
              ]}
              {...form.getInputProps("paymentMethod")}
            />
            <AppDateInput
              label="Payment Date"
              value={form.values.paymentDate}
              onChange={(val) => form.setFieldValue("paymentDate", val)}
              required
            />
          </SimpleGrid>

          {/* Cash Change Calculator (only relevant for cash payments) */}
          {form.values.paymentMethod === "cash" && (
            <Stack gap="xs" p="xs" style={{ border: "1px dashed var(--mantine-color-gray-4)", borderRadius: 6 }}>
              <Text size="xs" fw={700} c="dimmed">
                CASHIER CHANGE CALCULATOR
              </Text>

              <Group gap="xs">
                {quickCashOptions.map((opt) => (
                  <Chip
                    key={opt.label}
                    size="xs"
                    checked={tenderedNum === opt.val}
                    onChange={() => setCashTendered(opt.val)}
                  >
                    {opt.label}
                  </Chip>
                ))}
              </Group>

              <NumberInput
                label="Cash Tendered (Received from customer)"
                placeholder="e.g. 5000"
                decimalScale={2}
                min={0}
                value={cashTendered === "" ? "" : Number(cashTendered)}
                onChange={(val) => setCashTendered(val === "" ? "" : Number(val))}
              />

              {tenderedNum > 0 && (
                <Group justify="space-between" mt="xs">
                  <Text size="sm" fw={600}>
                    {isShort ? "Shortage (Unpaid):" : "Change to Return:"}
                  </Text>
                  <Text size="md" fw={700} c={isShort ? "red.7" : "teal.7"}>
                    <MoneyText
                      paisa={Math.round((isShort ? billAmount - tenderedNum : changeToReturn) * 100)}
                      currencyConfig={currencyConfig}
                    />
                  </Text>
                </Group>
              )}
            </Stack>
          )}

          <TextInput
            label="Reference / Cheque No."
            placeholder="e.g. TR-98432 or Cheque #1029"
            {...form.getInputProps("reference")}
          />

          <Textarea
            label="Internal Notes"
            placeholder="Optional cashier notes"
            rows={2}
            {...form.getInputProps("notes")}
          />

          <Divider my="xs" />

          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              color="teal"
              loading={loading}
              disabled={loading}
              leftSection={<Check size={16} />}
            >
              Confirm & Record Payment
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default InvoicePaymentModal;
