import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  CalendarDays,
  History,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Trash2,
} from "lucide-react";
import type { PublicProduct } from "../../../types/backend";
import {
  calculateMargin,
  ExpiryBadge,
  getProductColor,
  getProductInitials,
  LEDGER_NUM,
  paisaToDisplay,
} from "../utils/inventoryHelpers";

interface ProductsTableProps {
  products: PublicProduct[];
  categoryMap: Map<string, string>;
  supplierMap: Map<string, string>;
  customFieldDefs: { fieldName: string; fieldLabel: string; fieldType: string }[];
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (product: PublicProduct) => void;
  onStock: (product: PublicProduct) => void;
  onMovements: (product: PublicProduct) => void;
  onBatches: (product: PublicProduct) => void;
  onDelete: (product: PublicProduct) => void;
}

export function ProductsTable({
  products,
  categoryMap,
  supplierMap,
  customFieldDefs,
  canEdit,
  canDelete,
  onEdit,
  onStock,
  onMovements,
  onBatches,
  onDelete,
}: ProductsTableProps) {
  return (
    <ScrollArea>
      <Table
        highlightOnHover
        verticalSpacing="md"
        horizontalSpacing="lg"
        miw={1040}
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
            paddingTop: 14,
            paddingBottom: 14,
          },
          td: {
            paddingTop: 14,
            paddingBottom: 14,
            borderColor: "var(--app-border)",
          },
        }}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Product</Table.Th>
            <Table.Th>Category</Table.Th>
            <Table.Th>Supplier</Table.Th>
            <Table.Th ta="right">Pricing & Margin</Table.Th>
            <Table.Th>Stock Level</Table.Th>
            {customFieldDefs.map((f) => (
              <Table.Th key={f.fieldName}>{f.fieldLabel}</Table.Th>
            ))}
            <Table.Th>Expiry</Table.Th>
            {(canEdit || canDelete) && <Table.Th ta="right">Actions</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {products.map((prod) => {
            const inStock = prod.quantityInStock >= 10;
            const lowStock =
              prod.quantityInStock > 0 && prod.quantityInStock < 10;
            const colorScheme = getProductColor(prod.name);
            const margin = calculateMargin(prod.costPrice, prod.sellPrice);

            return (
              <Table.Tr key={prod.id}>
                {/* Product Name & Visual Avatar */}
                <Table.Td>
                  <Group gap="sm" wrap="nowrap">
                    <Box
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: colorScheme.bg,
                        color: colorScheme.text,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        fontSize: 13,
                        letterSpacing: 0.5,
                        flexShrink: 0,
                      }}
                    >
                      {getProductInitials(prod.name)}
                    </Box>

                    <Stack gap={2} style={{ minWidth: 140 }}>
                      <Text
                        fw={600}
                        size="sm"
                        style={{ color: "var(--app-text)", lineHeight: 1.3 }}
                      >
                        {prod.name}
                      </Text>
                      <Group gap={6} wrap="wrap">
                        <Text
                          size="xs"
                          fw={600}
                          style={{
                            ...LEDGER_NUM,
                            color: "var(--app-muted)",
                            background: "var(--app-soft)",
                            padding: "1px 6px",
                            borderRadius: 4,
                          }}
                        >
                          #{prod.sku}
                        </Text>
                        {prod.unit && (
                          <Text size="xs" c="dimmed">
                            · {prod.unit}
                          </Text>
                        )}
                      </Group>
                    </Stack>
                  </Group>
                </Table.Td>

                {/* Category */}
                <Table.Td>
                  <Text size="sm" style={{ color: "var(--app-text)" }}>
                    {prod.categoryId
                      ? categoryMap.get(prod.categoryId) ?? "—"
                      : "—"}
                  </Text>
                </Table.Td>

                {/* Supplier */}
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {prod.supplierId
                      ? supplierMap.get(prod.supplierId) ?? "—"
                      : "—"}
                  </Text>
                </Table.Td>

                {/* Pricing & Profit Margin */}
                <Table.Td ta="right">
                  <Stack gap={2} align="flex-end">
                    <Text
                      fw={700}
                      size="sm"
                      style={{ ...LEDGER_NUM, color: "var(--app-text)" }}
                    >
                      Rs. {paisaToDisplay(prod.sellPrice)}
                    </Text>
                    <Group gap={6} justify="flex-end">
                      <Text size="xs" c="dimmed" style={LEDGER_NUM}>
                        Cost: Rs. {paisaToDisplay(prod.costPrice)}
                      </Text>
                      <Badge
                        size="xs"
                        variant="light"
                        color={margin.profit >= 0 ? "green" : "red"}
                        radius="sm"
                      >
                        {margin.profit >= 0
                          ? `+${margin.marginPercent.toFixed(0)}%`
                          : `${margin.marginPercent.toFixed(0)}%`}
                      </Badge>
                    </Group>
                  </Stack>
                </Table.Td>

                {/* Stock Health & Mini Progress Bar */}
                <Table.Td>
                  <Stack gap={4} style={{ minWidth: 130 }}>
                    <Group gap={6} align="center">
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: inStock
                            ? "#10b981"
                            : lowStock
                            ? "#f59e0b"
                            : "#ef4444",
                        }}
                      />
                      <Text
                        size="sm"
                        fw={700}
                        style={{
                          ...LEDGER_NUM,
                          color: inStock
                            ? "#10b981"
                            : lowStock
                            ? "#f59e0b"
                            : "#ef4444",
                        }}
                      >
                        {prod.quantityInStock} {prod.unit || "units"}
                      </Text>
                    </Group>

                    <Box
                      style={{
                        width: "100%",
                        maxWidth: 100,
                        height: 4,
                        borderRadius: 999,
                        background: "var(--app-border)",
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(5, (prod.quantityInStock / 15) * 100),
                          )}%`,
                          height: "100%",
                          background: inStock
                            ? "#10b981"
                            : lowStock
                            ? "#f59e0b"
                            : "#ef4444",
                          borderRadius: 999,
                        }}
                      />
                    </Box>

                    <Text size="11px" c="dimmed">
                      {inStock
                        ? "Adequately stocked"
                        : lowStock
                        ? "Low buffer (<10)"
                        : "Depleted"}
                    </Text>
                  </Stack>
                </Table.Td>

                {/* Custom Fields */}
                {customFieldDefs.map((f) => {
                  let val = "—";
                  if (prod.customFields) {
                    try {
                      const parsed = JSON.parse(prod.customFields);
                      if (parsed[f.fieldName] != null) {
                        val = String(parsed[f.fieldName]);
                      }
                    } catch {
                      /* ignore */
                    }
                  }
                  return (
                    <Table.Td key={f.fieldName}>
                      <Text size="sm" c="dimmed">
                        {val}
                      </Text>
                    </Table.Td>
                  );
                })}

                {/* Expiry */}
                <Table.Td>
                  {prod.nextExpiryDate ? (
                    <ExpiryBadge date={prod.nextExpiryDate} />
                  ) : (
                    <Text size="xs" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>

                {/* Actions: Quick Adjust + Context Menu (...) */}
                {(canEdit || canDelete) && (
                  <Table.Td ta="right">
                    <Group gap={6} justify="flex-end" wrap="nowrap">
                      {canEdit && (
                        <Tooltip label="Quick Adjust Stock" withArrow>
                          <Button
                            size="xs"
                            variant="default"
                            radius="md"
                            leftSection={
                              <PackagePlus
                                size={13}
                                color="var(--app-accent)"
                              />
                            }
                            onClick={() => onStock(prod)}
                            styles={{
                              root: {
                                background: "var(--app-surface)",
                                borderColor: "var(--app-border)",
                                fontSize: 12,
                                fontWeight: 600,
                                padding: "0 10px",
                                height: 30,
                                color: "var(--app-text)",
                              },
                            }}
                          >
                            Adjust
                          </Button>
                        </Tooltip>
                      )}

                      <Menu
                        shadow="md"
                        width={180}
                        position="bottom-end"
                        radius="md"
                      >
                        <Menu.Target>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="md"
                            radius="md"
                          >
                            <MoreHorizontal size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown
                          style={{
                            background: "var(--app-surface)",
                            borderColor: "var(--app-border)",
                          }}
                        >
                          {canEdit && (
                            <Menu.Item
                              leftSection={<Pencil size={14} />}
                              onClick={() => onEdit(prod)}
                            >
                              Edit Details
                            </Menu.Item>
                          )}
                          {canEdit && (
                            <Menu.Item
                              leftSection={<History size={14} />}
                              onClick={() => onMovements(prod)}
                            >
                              Stock Movements
                            </Menu.Item>
                          )}
                          {canEdit && (
                            <Menu.Item
                              leftSection={<CalendarDays size={14} />}
                              onClick={() => onBatches(prod)}
                            >
                              Batches & Expiry
                            </Menu.Item>
                          )}
                          {canDelete && (
                            <>
                              <Menu.Divider />
                              <Menu.Item
                                color="red"
                                leftSection={<Trash2 size={14} />}
                                onClick={() => onDelete(prod)}
                              >
                                Delete Product
                              </Menu.Item>
                            </>
                          )}
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
