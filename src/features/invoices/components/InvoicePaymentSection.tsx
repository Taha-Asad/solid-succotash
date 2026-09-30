import {
  Alert,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Menu,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { CheckCircle2, ChevronDown, MessageSquare, Printer, Save, Share2 } from "lucide-react";
import { MoneyText } from "../../../shared/ui/MoneyText";
import { INK } from "../../../theme";
import type { CurrencyConfig } from "../../../types/backend";
import type { DraftTotals } from "../types";

interface InvoicePaymentSectionProps {
  totals: DraftTotals;
  customerPendingDue: number;
  currencyConfig: CurrencyConfig | null;
  paymentStatus: "paid" | "partial" | "unpaid";
  onPaymentStatusChange: (status: "paid" | "partial" | "unpaid") => void;
  paymentMethod: "cash" | "bank_transfer" | "card";
  onPaymentMethodChange: (method: "cash" | "bank_transfer" | "card") => void;
  amountTendered: number | "";
  onAmountTenderedChange: (val: number | "") => void;
  tenderedRupees: number;
  changeDueRupees: number;
  remainingDueRupees: number;
  paymentReference: string;
  onPaymentReferenceChange: (val: string) => void;
  isWalkinCustomer: boolean;
  submitting: boolean;
  hasItems: boolean;
  hasCustomer: boolean;
  onExecuteCheckout: (andPrint: boolean, asDraft: boolean, andWhatsApp?: boolean) => void;
  onShareWhatsAppQuote: () => void;
  onDiscard: () => void;
}

export function InvoicePaymentSection({
  totals,
  customerPendingDue,
  currencyConfig,
  paymentStatus,
  onPaymentStatusChange,
  paymentMethod,
  onPaymentMethodChange,
  amountTendered,
  onAmountTenderedChange,
  tenderedRupees,
  changeDueRupees,
  remainingDueRupees,
  paymentReference,
  onPaymentReferenceChange,
  isWalkinCustomer,
  submitting,
  hasItems,
  hasCustomer,
  onExecuteCheckout,
  onShareWhatsAppQuote,
  onDiscard,
}: InvoicePaymentSectionProps) {
  const canSubmit = hasItems && hasCustomer && !submitting;

  return (
    <Stack gap="md" style={{ position: "sticky", top: 16 }}>
      {/* FINANCIAL SUMMARY CARD */}
      <Card
        withBorder
        radius="md"
        padding="md"
        shadow="sm"
        style={{ background: "var(--app-surface)" }}
      >
        <Text
          size="xs"
          fw={700}
          c="dimmed"
          mb="sm"
          style={{ textTransform: "uppercase", letterSpacing: 0.8 }}
        >
          3. Order & Financial Summary
        </Text>

        <Stack gap={8}>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Subtotal ({totals.totalQuantity} items):
            </Text>
            <MoneyText
              paisa={totals.subtotalPaisa}
              currencyConfig={currencyConfig}
              size="sm"
              fw={600}
            />
          </Group>

          {totals.discountPaisa > 0 && (
            <Group justify="space-between">
              <Text size="sm" c="green">
                Total Discount:
              </Text>
              <Text size="sm" fw={600} c="green" style={{ fontVariantNumeric: "tabular-nums" }}>
                - <MoneyText paisa={totals.discountPaisa} currencyConfig={currencyConfig} />
              </Text>
            </Group>
          )}

          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Sales Tax:
            </Text>
            <Text size="sm" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
              + <MoneyText paisa={totals.taxPaisa} currencyConfig={currencyConfig} />
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
              <Text
                size="xs"
                fw={700}
                style={{ textTransform: "uppercase", color: INK.text }}
              >
                Grand Total
              </Text>
              <MoneyText
                paisa={totals.grandTotalPaisa}
                currencyConfig={currencyConfig}
                size="xl"
                fw={900}
                style={{ color: "var(--app-accent, #C9952A)" }}
              />
            </Group>
          </Box>

          {/* Net Total with Khata Udhaar */}
          {customerPendingDue > 0 && (
            <Group justify="space-between" mt={4}>
              <Text size="xs" c="orange" fw={600}>
                + Previous Udhaar Balance:
              </Text>
              <MoneyText
                paisa={customerPendingDue}
                currencyConfig={currencyConfig}
                size="xs"
                c="orange"
                fw={700}
              />
            </Group>
          )}
        </Stack>
      </Card>

      {/* INTEGRATED PAYMENT STUDIO */}
      <Card
        withBorder
        radius="md"
        padding="md"
        shadow="sm"
        style={{ background: "var(--app-surface)" }}
      >
        <Text
          size="xs"
          fw={700}
          c="dimmed"
          mb="xs"
          style={{ textTransform: "uppercase", letterSpacing: 0.8 }}
        >
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
              onChange={(v) => onPaymentStatusChange(v as any)}
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
                onChange={(v) => onPaymentMethodChange(v as any)}
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
                Full payment of <strong>Rs {totals.grandTotalRupees.toLocaleString()}</strong> will be recorded via{" "}
                <strong>{paymentMethod.toUpperCase()}</strong> on completion. Zero balance due.
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
                onChange={(v) => onAmountTenderedChange(typeof v === "number" ? v : "")}
              />

              {/* Quick Cash Buttons */}
              {paymentMethod === "cash" && (
                <Group gap={6} wrap="wrap">
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="teal"
                    onClick={() => onAmountTenderedChange(totals.grandTotalRupees)}
                  >
                    Exact (Rs {totals.grandTotalRupees.toLocaleString()})
                  </Button>
                  {[500, 1000, 2000, 5000].map((denomination) => (
                    <Button
                      key={denomination}
                      size="compact-xs"
                      variant="default"
                      onClick={() => onAmountTenderedChange(denomination)}
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
                    <Text size="md" fw={800} c="green" style={{ fontVariantNumeric: "tabular-nums" }}>
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
                    <Text size="sm" fw={800} c="orange" style={{ fontVariantNumeric: "tabular-nums" }}>
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
                  <> The entire amount of <strong>Rs {totals.grandTotalRupees.toLocaleString()}</strong> will be posted to the customer's Khata (Accounts Receivable).</>
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
              onChange={(e) => onPaymentReferenceChange(e.currentTarget.value)}
            />
          )}

          <Divider my="xs" />

          {/* PRIMARY ACTION BUTTONS */}
          <Stack gap="xs">
            <Button
              size="md"
              radius="md"
              loading={submitting}
              disabled={!canSubmit}
              leftSection={<Printer size={18} />}
              onClick={() => onExecuteCheckout(true, false)}
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
                disabled={!canSubmit}
                onClick={() => onExecuteCheckout(false, false)}
              >
                Complete (No Print)
              </Button>

              <Button
                size="sm"
                variant="default"
                loading={submitting}
                disabled={!canSubmit}
                leftSection={<Save size={14} />}
                onClick={() => onExecuteCheckout(false, true)}
              >
                Save Draft
              </Button>
            </Group>

            {/* Decoupled WhatsApp Menu: Direct Estimate Share vs Finalize & WhatsApp */}
            <Menu position="bottom" withinPortal shadow="md">
              <Menu.Target>
                <Button
                  size="sm"
                  variant="light"
                  color="teal"
                  loading={submitting}
                  disabled={!canSubmit}
                  leftSection={<MessageSquare size={16} />}
                  rightSection={<ChevronDown size={14} />}
                >
                  WhatsApp Options...
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>WhatsApp Sharing & Dispatch</Menu.Label>
                {/* 1. Pure Share: DOES NOT FINALIZE OR TOUCH STOCK */}
                <Menu.Item
                  leftSection={<Share2 size={16} color="#0ea5e9" />}
                  onClick={onShareWhatsAppQuote}
                >
                  <div>
                    <Text size="xs" fw={700}>Share Quote / Estimate</Text>
                    <Text size="xs" c="dimmed">Opens WhatsApp with quote summary; does not finalize or alter stock</Text>
                  </div>
                </Menu.Item>
                <Menu.Divider />
                {/* 2. Save Draft + Share */}
                <Menu.Item
                  leftSection={<Save size={16} color="#3b82f6" />}
                  onClick={() => onExecuteCheckout(false, true, true)}
                >
                  <div>
                    <Text size="xs" fw={700}>Save Draft & Send Estimate</Text>
                    <Text size="xs" c="dimmed">Saves draft in database and opens WhatsApp quote</Text>
                  </div>
                </Menu.Item>
                <Menu.Divider />
                {/* 3. Explicitly Labeled: Finalizes Sale + Share Bill */}
                <Menu.Item
                  leftSection={<CheckCircle2 size={16} color="#10b981" />}
                  onClick={() => onExecuteCheckout(false, false, true)}
                >
                  <div>
                    <Text size="xs" fw={700}>Complete Sale & WhatsApp Bill</Text>
                    <Text size="xs" c="dimmed">Finalizes invoice, deducts stock & opens WhatsApp bill</Text>
                  </div>
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>

            <Button
              variant="subtle"
              size="xs"
              color="gray"
              onClick={onDiscard}
            >
              Discard & Return
            </Button>
          </Stack>
        </Stack>
      </Card>
    </Stack>
  );
}
