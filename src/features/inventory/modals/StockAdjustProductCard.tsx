import { Badge, Box, Card, Group, Stack, Text } from "@mantine/core";
import { INK } from "../../../theme";
import type { PublicProduct } from "../../../types/backend";
import { LEDGER_NUM } from "../utils/inventoryHelpers";

interface StockAdjustProductCardProps {
  product: PublicProduct | null;
  categoryName?: string;
  currentStock: number;
  unit: string;
}

export function StockAdjustProductCard({
  product,
  categoryName,
  currentStock,
  unit,
}: StockAdjustProductCardProps) {
  return (
    <Card
      padding="sm"
      radius="md"
      style={{
        background: "var(--app-surface)",
        border: `1px solid ${INK.border}`,
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Text fw={700} size="sm" style={{ color: INK.text }} truncate>
            {product?.name ?? "Product"}
          </Text>
          <Group gap={6} wrap="wrap">
            <Badge variant="outline" size="xs" color="gray">
              SKU: {product?.sku}
            </Badge>
            {categoryName && (
              <Badge variant="light" size="xs" color="blue">
                {categoryName}
              </Badge>
            )}
            <Badge variant="subtle" size="xs" color="gray">
              Cost: Rs {product ? (product.costPrice / 100).toFixed(2) : "0.00"}
            </Badge>
          </Group>
        </Stack>
        <Box ta="right" style={{ flexShrink: 0 }}>
          <Text size="xs" c="dimmed" fw={600} tt="uppercase">
            On Hand
          </Text>
          <Text
            fw={800}
            size="lg"
            style={{
              ...LEDGER_NUM,
              color: currentStock <= 0 ? INK.danger : INK.text,
            }}
          >
            {currentStock.toLocaleString()}{" "}
            <Text component="span" size="xs" fw={600} c="dimmed">
              {unit}
            </Text>
          </Text>
        </Box>
      </Group>
    </Card>
  );
}
