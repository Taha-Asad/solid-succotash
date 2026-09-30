import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Drawer,
  Group,
  ScrollArea,
  Table,
  Text,
} from "@mantine/core";
import { AlertTriangle, History } from "lucide-react";
import { getErrorMessage, listStockMovements } from "../../../api/backend";
import { useI18n } from "../../../i18n/I18nProvider";
import { INK } from "../../../theme";
import type { PublicProduct, PublicStockMovement } from "../../../types/backend";
import { EmptyState, formatDate, LEDGER_NUM } from "../utils/inventoryHelpers";

interface MovementsModalProps {
  opened: boolean;
  onClose: () => void;
  product: PublicProduct | null;
}

export function MovementsModal({ opened, onClose, product }: MovementsModalProps) {
  const { dir } = useI18n();
  const [movements, setMovements] = useState<PublicStockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened && product) {
      setLoading(true);
      listStockMovements(product.id)
        .then((data) => {
          setMovements(data);
          setError(null);
        })
        .catch((err) => setError(getErrorMessage(err)))
        .finally(() => setLoading(false));
    }
  }, [opened, product]);

  const typeColors: Record<string, string> = {
    purchase: "green",
    return: "teal",
    adjustment: "blue",
    sale: "orange",
    damage: "red",
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position={dir === "rtl" ? "left" : "right"}
      size={560}
      title={
        <Group gap={8}>
          <History size={18} color="var(--app-accent)" />
          <Text fw={700} style={{ color: "var(--app-text)" }}>
            Stock History: {product?.name ?? ""}
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
          Loading movements…
        </Text>
      ) : error ? (
        <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
          {error}
        </Alert>
      ) : movements.length === 0 ? (
        <EmptyState
          icon={<History size={20} />}
          title="No stock movements recorded"
          description="Purchases, sales, returns and adjustments for this product will show up here."
        />
      ) : (
        <ScrollArea h={400}>
          <Table
            striped
            highlightOnHover
            withTableBorder
            verticalSpacing="sm"
            miw={480}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th ta="right">Quantity</Table.Th>
                <Table.Th>Note</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {movements.map((m) => (
                <Table.Tr key={m.id}>
                  <Table.Td>
                    <Text size="sm" style={LEDGER_NUM}>
                      {formatDate(m.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={typeColors[m.movementType] ?? "gray"}
                      variant="light"
                      radius="sm"
                    >
                      {m.movementType}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text
                      size="sm"
                      fw={700}
                      style={{
                        ...LEDGER_NUM,
                        color: m.quantity > 0 ? INK.success : INK.danger,
                      }}
                    >
                      {m.quantity > 0 ? "+" : ""}
                      {m.quantity}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {m.referenceNote || "—"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Drawer>
  );
}
