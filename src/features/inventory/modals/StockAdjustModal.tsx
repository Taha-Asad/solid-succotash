import React, { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  PackageMinus,
  PackagePlus,
} from "lucide-react";
import { AppDateInput } from "../../../components/AppDateInput";
import { getErrorMessage } from "../../../api/backend";
import { useI18n } from "../../../i18n/I18nProvider";
import { INK } from "../../../theme";
import type { PublicProduct } from "../../../types/backend";
import { LEDGER_NUM } from "../utils/inventoryHelpers";
import { StockAdjustProductCard } from "./StockAdjustProductCard";
import { StockAdjustCountMode } from "./StockAdjustCountMode";

export type AdjustMode = "receive" | "remove" | "count" | "expiry";

interface StockAdjustModalProps {
  opened: boolean;
  onClose: () => void;
  onSave: (values: {
    movementType: string;
    quantity: number;
    referenceNote: string;
    expiryDate?: string;
    batchNumber?: string;
  }) => Promise<void>;
  product: PublicProduct | null;
  categoryName?: string;
}

export function StockAdjustModal({
  opened,
  onClose,
  onSave,
  product,
  categoryName,
}: StockAdjustModalProps) {
  const { dir } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 4 Human-Centered Modes
  const [mode, setMode] = useState<AdjustMode>("receive");

  // Mode 1: Receive Stock
  const [receiveQty, setReceiveQty] = useState<number | string>(0);
  const [receiveReason, setReceiveReason] = useState<string>("purchase");

  // Mode 2: Remove Stock
  const [removeQty, setRemoveQty] = useState<number | string>(0);
  const [removeReason, setRemoveReason] = useState<string>("damage");

  // Mode 3: Physical Shelf Count
  const [countedUnits, setCountedUnits] = useState<number | string>(
    product?.quantityInStock ?? 0
  );

  // Mode 4 & Optional Batch/Expiry
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [batchNumber, setBatchNumber] = useState<string>("");

  // Universal Reference Note
  const [referenceNote, setReferenceNote] = useState<string>("");

  // Reset form when modal opens or product changes
  useEffect(() => {
    if (opened && product) {
      setMode("receive");
      setReceiveQty(0);
      setReceiveReason("purchase");
      setRemoveQty(0);
      setRemoveReason("damage");
      setCountedUnits(product.quantityInStock);
      setExpiryDate("");
      setBatchNumber("");
      setReferenceNote("");
      setError(null);
    }
  }, [opened, product]);

  const currentStock = product?.quantityInStock ?? 0;
  const unit = product?.unit ?? "units";

  // Numeric sanitization
  const numReceiveQty = Math.max(
    0,
    typeof receiveQty === "number" ? receiveQty : parseInt(receiveQty, 10) || 0
  );
  const numRemoveQty = Math.max(
    0,
    typeof removeQty === "number" ? removeQty : parseInt(removeQty, 10) || 0
  );
  const numCountedUnits =
    typeof countedUnits === "number"
      ? countedUnits
      : parseInt(countedUnits, 10) || 0;
  const countDiff = numCountedUnits - currentStock;

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    setLoading(true);
    setError(null);

    try {
      let movementType = "adjustment";
      let quantity = 0;
      let note = referenceNote.trim();

      if (mode === "receive") {
        if (numReceiveQty <= 0) {
          setError("Please enter at least 1 unit to receive.");
          setLoading(false);
          return;
        }
        movementType = receiveReason;
        quantity = numReceiveQty;
      } else if (mode === "remove") {
        if (numRemoveQty <= 0) {
          setError("Please enter at least 1 unit to remove.");
          setLoading(false);
          return;
        }
        if (removeReason.startsWith("damage")) {
          movementType = "damage";
        } else if (removeReason === "sale") {
          movementType = "sale";
        } else {
          movementType = "adjustment";
        }
        quantity = -Math.abs(numRemoveQty);
      } else if (mode === "count") {
        if (countDiff === 0) {
          setError(
            "The physical count matches current system stock. No adjustment needed."
          );
          setLoading(false);
          return;
        }
        movementType = "adjustment";
        quantity = countDiff;
        if (!note) {
          note = `Physical shelf audit: counted ${numCountedUnits} (was ${currentStock})`;
        }
      } else if (mode === "expiry") {
        if (!expiryDate.trim()) {
          setError("Please choose an expiry date to assign to this stock.");
          setLoading(false);
          return;
        }
        movementType = "adjustment";
        quantity = 0;
      }

      await onSave({
        movementType,
        quantity,
        referenceNote: note,
        expiryDate: expiryDate.trim() ? expiryDate.trim() : undefined,
        batchNumber: batchNumber.trim() ? batchNumber.trim() : undefined,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const receiveReasons = [
    { value: "purchase", label: "Supplier Delivery / Purchase" },
    { value: "return", label: "Customer Return" },
    { value: "adjustment", label: "Found / Discovered Uncounted Stock" },
  ];

  const removeReasons = [
    { value: "damage", label: "Damaged / Broken / Defective" },
    { value: "damage_spoil", label: "Expired / Spoiled Goods" },
    { value: "damage_loss", label: "Lost / Missing / Stolen" },
    { value: "sale", label: "Direct / Manual Offline Sale" },
    { value: "adjustment", label: "Inventory Shrinkage / Write-down" },
  ];

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position={dir === "rtl" ? "left" : "right"}
      size={460}
      title={
        <Group gap={8}>
          <Box
            p={6}
            style={{
              borderRadius: 8,
              background: "var(--app-accent-soft)",
              color: "var(--app-accent)",
            }}
          >
            <PackagePlus size={18} />
          </Box>
          <Box>
            <Text fw={700} size="sm" style={{ color: INK.text }}>
              Adjust Inventory
            </Text>
            <Text size="xs" c="dimmed">
              Update stock quantities, audits, and expiry tracking
            </Text>
          </Box>
        </Group>
      }
      styles={{
        header: {
          background: "var(--app-surface)",
          borderBottom: `1px solid ${INK.border}`,
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
      <form onSubmit={handleFormSubmit}>
        <Stack gap="md">
          {/* Product Overview Card */}
          <StockAdjustProductCard
            product={product}
            categoryName={categoryName}
            currentStock={currentStock}
            unit={unit}
          />

          {/* Mode Switcher */}
          <SegmentedControl
            value={mode}
            onChange={(val) => {
              setMode(val as AdjustMode);
              setError(null);
            }}
            data={[
              {
                value: "receive",
                label: (
                  <Group gap={4} justify="center" wrap="nowrap">
                    <PackagePlus size={14} color="#059669" />
                    <Text size="xs" fw={600}>
                      Receive
                    </Text>
                  </Group>
                ),
              },
              {
                value: "remove",
                label: (
                  <Group gap={4} justify="center" wrap="nowrap">
                    <PackageMinus size={14} color="#dc2626" />
                    <Text size="xs" fw={600}>
                      Remove
                    </Text>
                  </Group>
                ),
              },
              {
                value: "count",
                label: (
                  <Group gap={4} justify="center" wrap="nowrap">
                    <ClipboardCheck size={14} color="#2563eb" />
                    <Text size="xs" fw={600}>
                      Count
                    </Text>
                  </Group>
                ),
              },
              {
                value: "expiry",
                label: (
                  <Group gap={4} justify="center" wrap="nowrap">
                    <CalendarClock size={14} color="#d97706" />
                    <Text size="xs" fw={600}>
                      Expiry
                    </Text>
                  </Group>
                ),
              },
            ]}
            fullWidth
            radius="md"
            size="sm"
          />

          {/* Mode 1: Receive Stock */}
          {mode === "receive" && (
            <Stack gap="sm">
              <Box>
                <Group justify="space-between" mb={6}>
                  <Text size="xs" fw={600} style={{ color: INK.text }}>
                    Quantity to Receive
                  </Text>
                  <Group gap={4}>
                    <Text size="xs" c="dimmed">
                      Quick add:
                    </Text>
                    {[5, 10, 25, 50, 100].map((amt) => (
                      <Button
                        key={amt}
                        size="compact-xs"
                        variant="light"
                        color="teal"
                        radius="xl"
                        onClick={() =>
                          setReceiveQty((prev) => (Number(prev) || 0) + amt)
                        }
                      >
                        +{amt}
                      </Button>
                    ))}
                  </Group>
                </Group>
                <NumberInput
                  value={receiveQty}
                  onChange={setReceiveQty}
                  min={1}
                  step={1}
                  size="sm"
                  placeholder="e.g. 20"
                  allowNegative={false}
                  rightSection={
                    <Text size="xs" c="dimmed" pr="xs" fw={600}>
                      {unit}
                    </Text>
                  }
                />
              </Box>

              <Select
                label="Source / Reason"
                description="Where did these items arrive from?"
                data={receiveReasons}
                value={receiveReason}
                onChange={(val) => setReceiveReason(val || "purchase")}
                size="sm"
              />

              {/* Live calculation banner */}
              <Box
                p="xs"
                style={{
                  background: "rgba(5, 150, 105, 0.08)",
                  border: "1px solid rgba(5, 150, 105, 0.25)",
                  borderRadius: 8,
                }}
              >
                <Group justify="space-between" align="center">
                  <Group gap={6}>
                    <Text size="xs" c="dimmed">
                      Current: {currentStock}
                    </Text>
                    <ArrowRight size={12} color="#059669" />
                    <Text size="xs" fw={600} c="teal">
                      Adding: +{numReceiveQty}
                    </Text>
                  </Group>
                  <Group gap={4}>
                    <Text size="xs" fw={700} c="dimmed">
                      New Total:
                    </Text>
                    <Text
                      size="sm"
                      fw={800}
                      style={{ ...LEDGER_NUM, color: "#059669" }}
                    >
                      {(currentStock + numReceiveQty).toLocaleString()} {unit}
                    </Text>
                  </Group>
                </Group>
              </Box>

              {/* Optional Expiry & Batch info */}
              <Accordion variant="separated" radius="md">
                <Accordion.Item value="batch">
                  <Accordion.Control icon={<CalendarClock size={16} />}>
                    <Text size="xs" fw={600}>
                      Batch & Expiry Date (Optional)
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      <AppDateInput
                        label="Expiry Date"
                        placeholder="Select expiry date"
                        value={expiryDate}
                        onChange={setExpiryDate}
                        size="xs"
                        description="Enables automatic First-In-First-Out (FIFO) deduction during sales."
                      />
                      <TextInput
                        label="Batch / Lot Number"
                        placeholder="e.g. BATCH-2026-A"
                        value={batchNumber}
                        onChange={(e) =>
                          setBatchNumber(e.currentTarget.value)
                        }
                        size="xs"
                        description="Leave empty to auto-generate (e.g. B-0001)."
                      />
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Stack>
          )}

          {/* Mode 2: Remove Stock */}
          {mode === "remove" && (
            <Stack gap="sm">
              <Box>
                <Group justify="space-between" mb={6}>
                  <Text size="xs" fw={600} style={{ color: INK.text }}>
                    Quantity to Remove
                  </Text>
                  <Group gap={4}>
                    <Text size="xs" c="dimmed">
                      Quick select:
                    </Text>
                    {[1, 2, 5, 10].map((amt) => (
                      <Button
                        key={amt}
                        size="compact-xs"
                        variant="light"
                        color="red"
                        radius="xl"
                        onClick={() => setRemoveQty(amt)}
                      >
                        {amt}
                      </Button>
                    ))}
                    {currentStock > 0 && (
                      <Button
                        size="compact-xs"
                        variant="outline"
                        color="red"
                        radius="xl"
                        onClick={() => setRemoveQty(currentStock)}
                      >
                        All ({currentStock})
                      </Button>
                    )}
                  </Group>
                </Group>
                <NumberInput
                  value={removeQty}
                  onChange={setRemoveQty}
                  min={1}
                  step={1}
                  size="sm"
                  placeholder="e.g. 5"
                  allowNegative={false}
                  rightSection={
                    <Text size="xs" c="dimmed" pr="xs" fw={600}>
                      {unit}
                    </Text>
                  }
                />
              </Box>

              <Select
                label="Reason for Removal"
                description="Categorizes the deduction for inventory audit reports"
                data={removeReasons}
                value={removeReason}
                onChange={(val) => setRemoveReason(val || "damage")}
                size="sm"
              />

              {/* Live calculation banner */}
              <Box
                p="xs"
                style={{
                  background: "rgba(220, 38, 38, 0.08)",
                  border: "1px solid rgba(220, 38, 38, 0.25)",
                  borderRadius: 8,
                }}
              >
                <Group justify="space-between" align="center">
                  <Group gap={6}>
                    <Text size="xs" c="dimmed">
                      Current: {currentStock}
                    </Text>
                    <ArrowRight size={12} color="#dc2626" />
                    <Text size="xs" fw={600} c="red">
                      Removing: -{numRemoveQty}
                    </Text>
                  </Group>
                  <Group gap={4}>
                    <Text size="xs" fw={700} c="dimmed">
                      New Total:
                    </Text>
                    <Text
                      size="sm"
                      fw={800}
                      style={{
                        ...LEDGER_NUM,
                        color:
                          currentStock - numRemoveQty < 0
                            ? INK.danger
                            : INK.text,
                      }}
                    >
                      {(currentStock - numRemoveQty).toLocaleString()} {unit}
                    </Text>
                  </Group>
                </Group>
              </Box>

              {currentStock - numRemoveQty < 0 && (
                <Alert
                  color="red"
                  variant="light"
                  icon={<AlertTriangle size={16} />}
                >
                  Warning: Removing {numRemoveQty} units will result in negative
                  stock ({(currentStock - numRemoveQty).toLocaleString()}{" "}
                  {unit}).
                </Alert>
              )}
            </Stack>
          )}

          {/* Mode 3: Physical Shelf Count */}
          {mode === "count" && (
            <StockAdjustCountMode
              countedUnits={countedUnits}
              onCountedUnitsChange={setCountedUnits}
              unit={unit}
              currentStock={currentStock}
              numCountedUnits={numCountedUnits}
              countDiff={countDiff}
            />
          )}

          {/* Mode 4: Set Expiry Date Only */}
          {mode === "expiry" && (
            <Stack gap="sm">
              <Box>
                <Text size="xs" fw={600} style={{ color: INK.text }} mb={4}>
                  Attach Expiry Date to Existing Stock
                </Text>
                <Text size="xs" c="dimmed" mb={8}>
                  Sets an expiration date for the {currentStock} {unit} currently
                  in stock without changing the quantity count.
                </Text>
              </Box>

              <AppDateInput
                label="Expiry Date"
                placeholder="Select expiration date"
                value={expiryDate}
                onChange={setExpiryDate}
                required
                size="sm"
              />

              <TextInput
                label="Batch / Lot Number (Optional)"
                placeholder="e.g. LOT-2026-A"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.currentTarget.value)}
                size="sm"
                description="Helps identify this stock batch in future reports."
              />

              <Box
                p="xs"
                style={{
                  background: "var(--app-surface)",
                  border: `1px solid ${INK.border}`,
                  borderRadius: 8,
                }}
              >
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Stock Quantity Impact:
                  </Text>
                  <Text size="xs" fw={700} style={LEDGER_NUM}>
                    No change ({currentStock} {unit})
                  </Text>
                </Group>
              </Box>
            </Stack>
          )}

          {/* Universal Reference Note */}
          <TextInput
            label="Reference Note (Optional)"
            placeholder="e.g. Supplier Invoice #102, shelf audit, unpacking damage"
            value={referenceNote}
            onChange={(e) => setReferenceNote(e.currentTarget.value)}
            size="sm"
          />

          {error && (
            <Alert
              color="red"
              variant="light"
              icon={<AlertTriangle size={16} />}
            >
              {error}
            </Alert>
          )}

          <Divider />

          {/* Action Buttons */}
          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="gray" onClick={onClose} size="sm">
              Cancel
            </Button>
            <Button
              type="submit"
              loading={loading}
              disabled={mode === "count" && countDiff === 0}
              size="sm"
              style={{
                backgroundColor:
                  mode === "receive"
                    ? "#059669"
                    : mode === "remove"
                    ? "#dc2626"
                    : mode === "count"
                    ? countDiff > 0
                      ? "#059669"
                      : countDiff < 0
                      ? "#d97706"
                      : "gray"
                    : "var(--app-accent, #1e3a5f)",
                color: "#fff",
              }}
            >
              {mode === "receive" &&
                `Add ${numReceiveQty} ${unit} to Stock`}
              {mode === "remove" &&
                `Deduct ${numRemoveQty} ${unit} from Stock`}
              {mode === "count" &&
                (countDiff === 0
                  ? "Shelf Matches System"
                  : countDiff > 0
                  ? `Add +${countDiff} Units (Set to ${numCountedUnits})`
                  : `Deduct ${Math.abs(countDiff)} Units (Set to ${numCountedUnits})`)}
              {mode === "expiry" && "Save Expiry Date"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Drawer>
  );
}
