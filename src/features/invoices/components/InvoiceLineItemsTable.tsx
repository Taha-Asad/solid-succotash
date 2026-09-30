import React from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { Barcode, ReceiptText, Search, Trash2 } from "lucide-react";
import { MoneyText } from "../../../shared/ui/MoneyText";
import { INK } from "../../../theme";
import type { CurrencyConfig, PublicProduct } from "../../../types/backend";
import { computeLineMath, type DraftLineItem } from "../types";

interface InvoiceLineItemsTableProps {
  items: DraftLineItem[];
  onUpdateItem: (clientId: string, updates: Partial<DraftLineItem>) => void;
  onRemoveItem: (clientId: string) => void;
  onClearAllItems: () => void;
  onAddProduct: (product: PublicProduct) => void;
  scannerQuery: string;
  onScannerQueryChange: (val: string) => void;
  onScannerSubmit: (e?: React.FormEvent) => void;
  scannerInputRef: React.RefObject<HTMLInputElement | null>;
  products: PublicProduct[];
  productOptions: { value: string; label: string }[];
  currencyConfig: CurrencyConfig | null;
}

export function InvoiceLineItemsTable({
  items,
  onUpdateItem,
  onRemoveItem,
  onClearAllItems,
  onAddProduct,
  scannerQuery,
  onScannerQueryChange,
  onScannerSubmit,
  scannerInputRef,
  products,
  productOptions,
  currencyConfig,
}: InvoiceLineItemsTableProps) {
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
          2. Products & Line Items ({items.length})
        </Text>
        <Text size="xs" c="dimmed">
          Barcode scanning or keyboard fast-entry
        </Text>
      </Group>

      {/* Barcode Fast-Path Input */}
      <form onSubmit={onScannerSubmit}>
        <Group gap="xs" mb="sm">
          <TextInput
            ref={scannerInputRef}
            placeholder="Scan barcode (F3) or enter SKU / name..."
            size="sm"
            style={{ flex: 1 }}
            leftSection={<Barcode size={18} color="var(--app-accent, #C9952A)" />}
            value={scannerQuery}
            onChange={(e) => onScannerQueryChange(e.currentTarget.value)}
          />
          <Button
            type="submit"
            variant="light"
            color="indigo"
            leftSection={<Search size={15} />}
          >
            Add
          </Button>
        </Group>
      </form>

      {/* Inline Table */}
      {items.length === 0 ? (
        <Paper
          withBorder
          p="xl"
          radius="md"
          style={{
            textAlign: "center",
            background: "rgba(0,0,0,0.01)",
            borderStyle: "dashed",
          }}
        >
          <Stack align="center" gap="xs">
            <ReceiptText size={36} color="var(--app-muted, #94A3B8)" />
            <Text size="sm" fw={600} style={{ color: INK.text }}>
              No products added yet
            </Text>
            <Text size="xs" c="dimmed" style={{ maxWidth: 420 }}>
              Scan a barcode with your hardware scanner, or pick a product from the
              quick selector below to begin.
            </Text>
            <Group gap="xs" mt="xs">
              <Select
                placeholder="Pick a product to add..."
                data={productOptions}
                searchable
                clearable
                style={{ width: 320 }}
                onChange={(pid) => {
                  const prod = products.find((p) => p.id === pid);
                  if (prod) onAddProduct(prod);
                }}
              />
            </Group>
          </Stack>
        </Paper>
      ) : (
        <ScrollArea>
          <Table verticalSpacing="xs" striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 35 }}>#</Table.Th>
                <Table.Th>Product & SKU</Table.Th>
                <Table.Th style={{ width: 100 }}>Qty</Table.Th>
                <Table.Th style={{ width: 130 }}>Rate (PKR)</Table.Th>
                <Table.Th style={{ width: 90 }}>Tax %</Table.Th>
                <Table.Th style={{ width: 110 }}>Discount</Table.Th>
                <Table.Th style={{ width: 130, textAlign: "right" }}>Total</Table.Th>
                <Table.Th style={{ width: 45 }}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((item, idx) => {
                const lineMath = computeLineMath(item);
                return (
                  <Table.Tr key={item.clientId}>
                    <Table.Td>
                      <Text size="xs" c="dimmed" fw={600}>
                        {idx + 1}
                      </Text>
                    </Table.Td>

                    {/* Product Info */}
                    <Table.Td>
                      <Stack gap={1}>
                        <Text size="sm" fw={600} style={{ color: INK.text }}>
                          {item.productName}
                        </Text>
                        <Group gap={6}>
                          <Badge size="xs" variant="outline" color="gray">
                            {item.sku}
                          </Badge>
                          <Text
                            size="xs"
                            c={
                              item.stockAvailable < item.quantity ? "red" : "dimmed"
                            }
                          >
                            Stock: {item.stockAvailable} {item.unit}
                          </Text>
                        </Group>
                      </Stack>
                    </Table.Td>

                    {/* Quantity */}
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        min={1}
                        step={1}
                        value={item.quantity}
                        onChange={(val) => {
                          const q = typeof val === "number" ? val : 1;
                          onUpdateItem(item.clientId, { quantity: q });
                        }}
                      />
                    </Table.Td>

                    {/* Unit Price */}
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        min={0}
                        decimalScale={2}
                        value={item.unitPrice}
                        onChange={(val) => {
                          const p = typeof val === "number" ? val : 0;
                          onUpdateItem(item.clientId, { unitPrice: p });
                        }}
                      />
                    </Table.Td>

                    {/* Tax Rate % */}
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        min={0}
                        max={100}
                        suffix="%"
                        value={item.taxRate}
                        onChange={(val) => {
                          const t = typeof val === "number" ? val : 0;
                          onUpdateItem(item.clientId, { taxRate: t });
                        }}
                      />
                    </Table.Td>

                    {/* Discount */}
                    <Table.Td>
                      <NumberInput
                        size="xs"
                        min={0}
                        placeholder="0"
                        value={item.discountValue}
                        onChange={(val) => {
                          const d = typeof val === "number" ? val : 0;
                          onUpdateItem(item.clientId, { discountValue: d });
                        }}
                      />
                    </Table.Td>

                    {/* Line Total */}
                    <Table.Td style={{ textAlign: "right" }}>
                      <MoneyText
                        paisa={lineMath.totalPaisa}
                        currencyConfig={currencyConfig}
                        size="sm"
                        fw={700}
                        style={{ color: INK.text }}
                      />
                    </Table.Td>

                    {/* Remove */}
                    <Table.Td>
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        size="sm"
                        onClick={() => onRemoveItem(item.clientId)}
                      >
                        <Trash2 size={15} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      {/* Add More Items Row */}
      <Group
        justify="space-between"
        align="center"
        mt="md"
        pt="xs"
        style={{ borderTop: `1px solid ${INK.border}` }}
      >
        <Select
          placeholder="+ Add another product..."
          data={productOptions}
          searchable
          clearable
          size="xs"
          style={{ width: 340 }}
          onChange={(pid) => {
            const prod = products.find((p) => p.id === pid);
            if (prod) onAddProduct(prod);
          }}
        />
        <Button
          size="xs"
          variant="subtle"
          color="red"
          disabled={items.length === 0}
          onClick={onClearAllItems}
        >
          Clear All Items
        </Button>
      </Group>
    </Card>
  );
}
