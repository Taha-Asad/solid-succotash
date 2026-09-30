import {
  Badge,
  Box,
  Button,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { CalendarClock, CheckCircle2, Trash2 } from "lucide-react";
import type { PublicStockBatch } from "../../../types/backend";
import {
  daysUntil,
  EmptyState,
  formatDate,
  LEDGER_NUM,
} from "../utils/inventoryHelpers";

interface ExpiringBatchesTableProps {
  batches: PublicStockBatch[];
  onBackToAll: () => void;
  onWriteOff: (batch: PublicStockBatch) => void;
}

export function ExpiringBatchesTable({
  batches,
  onBackToAll,
  onWriteOff,
}: ExpiringBatchesTableProps) {
  return (
    <Box>
      <Box
        p="md"
        style={{
          background: "var(--app-soft)",
          borderBottom: "1px solid var(--app-border)",
        }}
      >
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap={8}>
            <CalendarClock size={18} color="#f59e0b" />
            <Text fw={700} size="sm" style={{ color: "var(--app-text)" }}>
              Batches Expiring Within 30 Days ({batches.length})
            </Text>
          </Group>
          <Button size="xs" variant="subtle" color="gray" onClick={onBackToAll}>
            ← Back to All Products
          </Button>
        </Group>
      </Box>

      {batches.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={20} />}
          title="No expiring batches"
          description="All inventory batches have healthy shelf life with no expirations due in the next 30 days."
        />
      ) : (
        <ScrollArea>
          <Table
            highlightOnHover
            verticalSpacing="md"
            horizontalSpacing="lg"
            miw={900}
            styles={{
              thead: {
                background: "var(--app-soft)",
                borderBottom: "1px solid var(--app-border)",
              },
              th: {
                color: "var(--app-muted)",
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                paddingTop: 12,
                paddingBottom: 12,
              },
              td: {
                paddingTop: 12,
                paddingBottom: 12,
                borderColor: "var(--app-border)",
              },
            }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Product</Table.Th>
                <Table.Th>Batch Number</Table.Th>
                <Table.Th>Expiry Date</Table.Th>
                <Table.Th ta="right">Quantity</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Source</Table.Th>
                <Table.Th ta="right">Action</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {batches.map((b) => {
                const days = daysUntil(b.expiryDate);
                return (
                  <Table.Tr key={b.id}>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text
                          fw={600}
                          size="sm"
                          style={{ color: "var(--app-text)" }}
                        >
                          {b.productName}
                        </Text>
                        <Text size="xs" c="dimmed">
                          SKU: #{b.productSku}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Text
                        size="xs"
                        fw={600}
                        style={{ ...LEDGER_NUM, color: "var(--app-text)" }}
                      >
                        {b.batchNumber || "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text
                          size="sm"
                          style={{ ...LEDGER_NUM, color: "var(--app-text)" }}
                        >
                          {formatDate(b.expiryDate)}
                        </Text>
                        <Badge
                          size="xs"
                          color={
                            days < 0 ? "red" : days <= 7 ? "red" : "yellow"
                          }
                          variant="light"
                        >
                          {days < 0
                            ? `Expired ${Math.abs(days)}d ago`
                            : `Expires in ${days}d`}
                        </Badge>
                      </Stack>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text
                        size="sm"
                        fw={800}
                        style={{ ...LEDGER_NUM, color: "var(--app-text)" }}
                      >
                        {b.quantity}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={b.status === "expired" ? "red" : "yellow"}
                        variant="light"
                        radius="sm"
                      >
                        {b.status === "expired" ? "Expired" : "Expiring"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {b.source}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      {b.quantity > 0 && (
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          radius="md"
                          leftSection={<Trash2 size={13} />}
                          onClick={() => onWriteOff(b)}
                        >
                          Write Off
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Box>
  );
}
