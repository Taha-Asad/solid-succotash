import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { Plus, ReceiptText } from "lucide-react";
import {
  getCompanyCurrency,
  getErrorMessage,
  listCustomers,
  listInvoices,
} from "../../../api/backend";
import { usePermissions } from "../../permissions/PermissionsProvider";
import { INK } from "../../../theme";
import type {
  CurrencyConfig,
  PublicCustomer,
  PublicInvoice,
} from "../../../types/backend";
import {
  FBR_STATUS_COLORS,
  paisaToDisplay,
  STATUS_COLORS,
} from "../utils/invoiceHelpers";

interface InvoiceListViewProps {
  onOpenInvoice: (id: string) => void;
  onOpenCreate: () => void;
}

export function InvoiceListView({
  onOpenInvoice,
  onOpenCreate,
}: InvoiceListViewProps) {
  const perms = usePermissions();
  const canCreate = perms.can("invoices", "create");
  const [invoices, setInvoices] = useState<PublicInvoice[]>([]);
  const [customers, setCustomers] = useState<PublicCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currencyConfig, setCurrencyConfig] = useState<CurrencyConfig | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, cust, curConfig] = await Promise.all([
        listInvoices(),
        listCustomers(),
        getCompanyCurrency(),
      ]);
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
            style={{
              color: INK.gold,
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
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
                background: "var(--app-accent-gradient)",
                color: "var(--app-on-accent, #0A0A0C)",
                fontWeight: 700,
                boxShadow: "0 4px 14px -2px var(--app-accent-shadow)",
                "&:hover": { filter: "brightness(1.08)" },
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
          <Text
            size="xs"
            fw={600}
            style={{
              color: INK.muted,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            Total Invoices
          </Text>
          <Title order={2} className="tabular" style={{ color: INK.text }}>
            {totalInvoices}
          </Title>
          <Text size="xs" c="dimmed" mt={4}>
            across all statuses
          </Text>
        </Card>
        <Card withBorder shadow="sm" padding="lg">
          <Text
            size="xs"
            fw={600}
            style={{
              color: INK.muted,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            Total Revenue
          </Text>
          <Title order={2} className="tabular" style={{ color: INK.text }}>
            {paisaToDisplay(totalRevenue, currencyConfig)}
          </Title>
          <Text size="xs" c="dimmed" mt={4}>
            from finalized invoices
          </Text>
        </Card>
        <Card withBorder shadow="sm" padding="lg">
          <Text
            size="xs"
            fw={600}
            style={{
              color: INK.muted,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            Outstanding
          </Text>
          <Title
            order={2}
            className="tabular"
            c={totalOutstanding > 0 ? "orange" : "green"}
          >
            {paisaToDisplay(totalOutstanding, currencyConfig)}
          </Title>
          <Text size="xs" c="dimmed" mt={4}>
            balance due from customers
          </Text>
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
                background: INK.goldSoft,
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
                      <Text
                        fw={600}
                        size="sm"
                        className="mono"
                        style={{ color: INK.text }}
                      >
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
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={600} className="tabular">
                        {paisaToDisplay(inv.grandTotal, currencyConfig)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" className="tabular">
                        {paisaToDisplay(inv.amountPaid, currencyConfig)}
                      </Text>
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
