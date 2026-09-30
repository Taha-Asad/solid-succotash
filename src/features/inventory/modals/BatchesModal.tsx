import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  ScrollArea,
  Table,
  Text,
} from "@mantine/core";
import { AlertTriangle, CalendarDays, Trash2 } from "lucide-react";
import { getErrorMessage, listProductBatches } from "../../../api/backend";
import { useI18n } from "../../../i18n/I18nProvider";
import { INK } from "../../../theme";
import type { PublicProduct, PublicStockBatch } from "../../../types/backend";
import {
  EmptyState,
  formatDate,
  LEDGER_NUM,
  paisaToDisplay,
} from "../utils/inventoryHelpers";
import { WriteOffModal } from "./WriteOffModal";

interface BatchesModalProps {
  opened: boolean;
  onClose: () => void;
  product: PublicProduct | null;
  onChanged: () => Promise<void>;
}

export function BatchesModal({
  opened,
  onClose,
  product,
  onChanged,
}: BatchesModalProps) {
  const { dir } = useI18n();
  const [batches, setBatches] = useState<PublicStockBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<PublicStockBatch | null>(
    null
  );

  async function loadBatches() {
    if (!product) return;
    setLoading(true);
    setError(null);
    try {
      setBatches(await listProductBatches(product.id));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (opened && product) {
      loadBatches();
    }
  }, [opened, product]);

  return (
    <>
      <Drawer
        opened={opened}
        onClose={onClose}
        position={dir === "rtl" ? "left" : "right"}
        size={680}
        title={
          <Group gap={8}>
            <CalendarDays size={18} color="var(--app-accent)" />
            <Text fw={700} style={{ color: "var(--app-text)" }}>
              Expiry Batches: {product?.name ?? ""}
            </Text>
          </Group>
        }
        styles={{
          header: {
            background: "var(--app-surface)",
            borderBottom: "1px solid var(--app-border)",
            padding: "16px 20px",
          },
          body: {
            background: "var(--app-bg)",
            padding: "20px",
            height: "calc(100% - 65px)",
            overflowY: "auto",
          },
        }}
      >
        {loading ? (
          <Text c="dimmed" size="sm">
            Loading batches…
          </Text>
        ) : error ? (
          <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
            {error}
          </Alert>
        ) : batches.length === 0 ? (
          <EmptyState
            icon={<CalendarDays size={20} />}
            title="No expiry batches"
            description="Stock received with an expiry date shows up here, in FIFO order (soonest expiry first)."
          />
        ) : (
          <ScrollArea h={400}>
            <Table
              striped
              highlightOnHover
              withTableBorder
              verticalSpacing="sm"
              miw={640}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Batch</Table.Th>
                  <Table.Th>Expiry Date</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                  <Table.Th ta="right">Unit Cost</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Source</Table.Th>
                  <Table.Th ta="right">Action</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {batches.map((b) => (
                  <Table.Tr key={b.id}>
                    <Table.Td>
                      <Text size="sm" fw={600} style={{ color: INK.text }}>
                        {b.batchNumber || "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" style={LEDGER_NUM}>
                        {formatDate(b.expiryDate)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={700} style={LEDGER_NUM}>
                        {b.quantity}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" style={LEDGER_NUM}>
                        {b.unitCost != null ? paisaToDisplay(b.unitCost) : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={
                          b.status === "expired"
                            ? "red"
                            : b.status === "depleted"
                            ? "gray"
                            : b.status === "expiring"
                            ? "yellow"
                            : "teal"
                        }
                        variant="light"
                        radius="sm"
                      >
                        {b.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {b.source}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      {b.quantity > 0 && b.status !== "depleted" && (
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          leftSection={<Trash2 size={13} />}
                          onClick={() => setWriteOffTarget(b)}
                        >
                          Write off
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Drawer>

      <WriteOffModal
        batch={writeOffTarget}
        onClose={() => setWriteOffTarget(null)}
        onWrittenOff={async () => {
          setWriteOffTarget(null);
          await onChanged();
          await loadBatches();
        }}
      />
    </>
  );
}
