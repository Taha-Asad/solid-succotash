import React from "react";
import {
  Box,
  Button,
  Card,
  Divider,
  Group,
  Kbd,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Barcode, Plus, Zap } from "lucide-react";
import type { PublicProduct } from "../../../types/backend";
import { paisaToDisplay } from "../utils/invoiceHelpers";

interface InvoiceFastEntryCardProps {
  barcodeInputRef: React.RefObject<HTMLInputElement | null>;
  barcodeInput: string;
  isScanning: boolean;
  onBarcodeInput: (val: string) => void;
  onBarcodeScan: (code: string) => void;
  products: PublicProduct[];
  quickProductId: string | null;
  onQuickProductSelect: (id: string | null) => void;
  quickQuantity: number;
  onQuickQuantityChange: (qty: number) => void;
  quickPrice: number;
  onQuickPriceChange: (price: number) => void;
  fastAdding: boolean;
  onFastAddLine: () => void;
}

export function InvoiceFastEntryCard({
  barcodeInputRef,
  barcodeInput,
  isScanning,
  onBarcodeInput,
  onBarcodeScan,
  products,
  quickProductId,
  onQuickProductSelect,
  quickQuantity,
  onQuickQuantityChange,
  quickPrice,
  onQuickPriceChange,
  fastAdding,
  onFastAddLine,
}: InvoiceFastEntryCardProps) {
  return (
    <Card
      withBorder
      padding="sm"
      radius="md"
      style={{
        background: "var(--app-surface)",
        borderColor: "var(--mantine-color-blue-outline, #3b82f6)",
        borderWidth: 1.5,
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <Zap size={15} color="var(--mantine-color-blue-6)" />
            <Text
              size="xs"
              fw={700}
              style={{ textTransform: "uppercase", letterSpacing: 0.5 }}
            >
              Fast Counter Line Entry & Barcode Scanner
            </Text>
          </Group>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              Press <Kbd size="xs">F2</Kbd> to Scan Barcode •{" "}
              <Kbd size="xs">F8</Kbd> to Print Receipt
            </Text>
          </Group>
        </Group>

        {/* Hardware Barcode Scan Fast-Path */}
        <Group align="flex-end" gap="sm">
          <Box style={{ flex: 1, minWidth: 260 }}>
            <TextInput
              ref={barcodeInputRef}
              label="Scan Barcode (Auto-Add)"
              placeholder="Scan or type barcode / SKU and press Enter..."
              leftSection={
                <Barcode size={18} color="var(--mantine-color-blue-6)" />
              }
              rightSection={<Kbd size="xs">F2</Kbd>}
              value={barcodeInput}
              disabled={isScanning}
              onChange={(e) => onBarcodeInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onBarcodeScan(barcodeInput);
                }
              }}
              styles={{
                input: {
                  fontWeight: 600,
                  fontFamily: "monospace",
                  letterSpacing: 0.5,
                },
              }}
            />
          </Box>
          <Button
            variant="light"
            color="blue"
            loading={isScanning}
            disabled={!barcodeInput.trim()}
            onClick={() => onBarcodeScan(barcodeInput)}
          >
            Scan & Add
          </Button>
        </Group>

        <Divider label="or Manual Product Selection" labelPosition="center" />

        <Group align="flex-end" gap="sm" wrap="wrap">
          <Box style={{ flex: 1, minWidth: 260 }}>
            <Select
              label="Product"
              placeholder="Type product name, SKU, or choose..."
              data={products.map((p) => ({
                value: p.id,
                label: `${p.name} [${p.sku}] — ${paisaToDisplay(p.sellPrice)} PKR (${p.quantityInStock} ${p.unit})`,
              }))}
              searchable
              clearable
              value={quickProductId}
              onChange={onQuickProductSelect}
              styles={{
                input: { fontWeight: 500 },
              }}
            />
          </Box>

          <NumberInput
            label="Qty"
            min={1}
            value={quickQuantity}
            onChange={(val) =>
              onQuickQuantityChange(typeof val === "number" ? val : 1)
            }
            style={{ width: 85 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onFastAddLine();
            }}
          />

          <NumberInput
            label="Price (PKR)"
            min={0}
            value={quickPrice}
            onChange={(val) =>
              onQuickPriceChange(typeof val === "number" ? val : 0)
            }
            style={{ width: 120 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onFastAddLine();
            }}
          />

          <Button
            leftSection={<Plus size={15} />}
            loading={fastAdding}
            disabled={!quickProductId || quickQuantity <= 0}
            onClick={onFastAddLine}
            style={{
              background: "var(--app-accent, #1d2b54)",
              color: "#ffffff",
              fontWeight: 600,
            }}
          >
            + Add Line
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
