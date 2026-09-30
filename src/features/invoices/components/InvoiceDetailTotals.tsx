import {
  Badge,
  Card,
  Divider,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { PublicInvoice, PublicPayment } from "../../../types/backend";
import { paisaToDisplay } from "../utils/invoiceHelpers";

interface InvoiceDetailTotalsProps {
  invoice: PublicInvoice;
  payments: PublicPayment[];
}

export function InvoiceDetailTotals({
  invoice,
  payments,
}: InvoiceDetailTotalsProps) {
  return (
    <>
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
    </>
  );
}
