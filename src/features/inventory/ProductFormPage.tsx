// ==========================================
// ADD / EDIT PRODUCT PAGE
// Full-page, humanistic 2-column layout with Live Margin Engine
// ==========================================

import { useState, useEffect } from "react";
import {
  Box,
  Badge,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Textarea,
  NumberInput,
  Select,
  Switch,
  Alert,
  Title,
  ActionIcon,
  Tooltip,
  Divider,
  SimpleGrid,
  Modal,
  Card,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  Barcode,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Percent,
  Plus,
} from "lucide-react";

import { listUnits, createUnit, getErrorMessage } from "../../api/backend";
import type {
  PublicCategory,
  PublicProduct,
  PublicSupplier,
  PublicUnit,
} from "../../types/backend";
import { INK } from "../../theme";

// Monospace tabular figures for financial clarity
const LEDGER_NUM: React.CSSProperties = {
  fontFamily:
    'ui-monospace, "SF Mono", "Roboto Mono", "JetBrains Mono", Menlo, monospace',
  fontVariantNumeric: "tabular-nums",
};

interface ProductFormPageProps {
  initial: PublicProduct | null;
  categories: PublicCategory[];
  suppliers: PublicSupplier[];
  onSave: (values: {
    sku: string;
    name: string;
    categoryId: string;
    supplierId: string;
    costPrice: number;
    sellPrice: number;
    taxRate: number;
    quantityInStock: number;
    unit: string;
  }) => Promise<void>;
  onCancel: () => void;
}

export default function ProductFormPage({
  initial,
  categories,
  suppliers,
  onSave,
  onCancel,
}: ProductFormPageProps) {
  const isEdit = initial !== null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lossModalOpen, setLossModalOpen] = useState(false);
  const [units, setUnits] = useState<PublicUnit[]>([]);

  // Inline custom unit creation state
  const [newUnitModalOpen, setNewUnitModalOpen] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");
  const [newUnitSymbol, setNewUnitSymbol] = useState("");
  const [creatingUnit, setCreatingUnit] = useState(false);
  const [newUnitError, setNewUnitError] = useState<string | null>(null);

  useEffect(() => {
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  async function handleCreateUnit() {
    const trimmed = newUnitName.trim();
    if (!trimmed) {
      setNewUnitError("Unit name is required (e.g. 'Strip', 'Bundle')");
      return;
    }
    setCreatingUnit(true);
    setNewUnitError(null);
    try {
      const created = await createUnit({
        name: trimmed,
        symbol: newUnitSymbol.trim() || null,
        isDefault: false,
      });
      setUnits((prev) => [...prev, created]);
      form.setFieldValue("unit", created.name);
      setNewUnitModalOpen(false);
      setNewUnitName("");
      setNewUnitSymbol("");
    } catch (err) {
      setNewUnitError(getErrorMessage(err));
    } finally {
      setCreatingUnit(false);
    }
  }

  const form = useForm({
    initialValues: {
      sku: initial?.sku ?? "",
      name: initial?.name ?? "",
      categoryId: initial?.categoryId ?? "",
      supplierId: initial?.supplierId ?? "",
      costPrice: initial ? initial.costPrice / 100 : 0,
      sellPrice: initial ? initial.sellPrice / 100 : 0,
      taxRate: initial ? initial.taxRate / 100 : 0,
      quantityInStock: initial?.quantityInStock ?? 0,
      unit: initial?.unit ?? "pcs",
      barcode: "",
      description: "",
      isActive: true,
      isTaxable: true,
    },
    validate: {
      name: (val) =>
        val.trim().length === 0 ? "Product name is required" : null,
      sellPrice: (val) =>
        val < 0 ? "Selling price cannot be negative" : null,
      costPrice: (val) =>
        val < 0 ? "Cost price cannot be negative" : null,
    },
  });

  // Auto-generate SKU helper
  const generateSku = () => {
    const random = Math.floor(100000 + Math.random() * 900000);
    form.setFieldValue("sku", `SKU-${random}`);
  };

  // Pricing & Live Margin Calculations
  const cost = Number(form.values.costPrice) || 0;
  const sell = Number(form.values.sellPrice) || 0;
  const stockQty = Number(form.values.quantityInStock) || 0;
  const unit = form.values.unit || "units";

  const profit = sell - cost;
  const isLoss = cost > 0 && sell > 0 && profit < 0;
  const markupPercent =
    cost > 0 ? ((sell - cost) / cost) * 100 : sell > 0 ? 100 : 0;
  const marginPercent = sell > 0 ? ((sell - cost) / sell) * 100 : 0;

  const applyMarkup = (percent: number) => {
    if (cost > 0) {
      const calculatedSell =
        Math.round(cost * (1 + percent / 100) * 100) / 100;
      form.setFieldValue("sellPrice", calculatedSell);
    }
  };

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validation = form.validate();
    if (validation.hasErrors) return;

    // Loss guardrail: warn merchant if selling below purchase cost
    if (isLoss) {
      setLossModalOpen(true);
      return;
    }

    void executeSave(form.values);
  }

  async function executeSave(values: typeof form.values) {
    setLoading(true);
    setError(null);
    setLossModalOpen(false);
    try {
      await onSave({
        sku: values.sku.trim() || `SKU-${Date.now().toString().slice(-6)}`,
        name: values.name.trim(),
        categoryId: values.categoryId,
        supplierId: values.supplierId,
        costPrice: values.costPrice,
        sellPrice: values.sellPrice,
        taxRate: values.taxRate,
        quantityInStock: values.quantityInStock,
        unit: values.unit,
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const categoryOptions = [
    { value: "", label: "No Category" },
    ...categories
      .filter((c) => c.isActive)
      .map((c) => ({ value: c.id, label: c.name ?? "Unnamed" })),
  ];

  const supplierOptions = [
    { value: "", label: "No Supplier" },
    ...suppliers
      .filter((s) => s.isActive)
      .map((s) => ({ value: s.id, label: s.name ?? "Unnamed" })),
  ];

  const unitOptions =
    units.length > 0
      ? units.map((u) => ({
          value: u.name,
          label: u.symbol ? `${u.name} (${u.symbol})` : u.name,
        }))
      : [
          { value: "pcs", label: "Pieces (pcs)" },
          { value: "kg", label: "Kilograms (kg)" },
          { value: "box", label: "Boxes (box)" },
          { value: "carton", label: "Cartons (ctn)" },
          { value: "litre", label: "Litres (ltr)" },
          { value: "meter", label: "Meters (mtr)" },
          { value: "pack", label: "Packs (pk)" },
        ];

  return (
    <Box pb={40}>
      <form onSubmit={handleFormSubmit}>
        {/* ==================== TOP ACTION HEADER ==================== */}
        <Group justify="space-between" align="center" mb={28} wrap="wrap" gap="md">
          <Stack gap={4}>
            {/* Breadcrumb path */}
            <Group gap={6}>
              <Text
                size="xs"
                c="dimmed"
                style={{ cursor: "pointer" }}
                onClick={onCancel}
              >
                Inventory
              </Text>
              <Text size="xs" c="dimmed">
                ›
              </Text>
              <Text
                size="xs"
                c="dimmed"
                style={{ cursor: "pointer" }}
                onClick={onCancel}
              >
                Products
              </Text>
              <Text size="xs" c="dimmed">
                ›
              </Text>
              <Text size="xs" fw={700} style={{ color: "var(--app-accent)" }}>
                {isEdit ? "Edit Product" : "Add Product"}
              </Text>
            </Group>

            <Title order={2} style={{ letterSpacing: -0.5, color: INK.text }}>
              {isEdit ? `Edit: ${initial.name}` : "Add New Product"}
            </Title>
          </Stack>

          {/* Action buttons */}
          <Group gap="sm">
            <Button
              variant="default"
              size="sm"
              radius="md"
              onClick={onCancel}
              style={{
                borderColor: INK.border,
                background: "var(--app-surface)",
                fontWeight: 600,
              }}
            >
              Discard Changes
            </Button>
            <Button
              type="submit"
              size="sm"
              radius="md"
              loading={loading}
              style={{
                background: "var(--app-accent, #1d2b54)",
                color: "#ffffff",
                fontWeight: 600,
              }}
            >
              {isEdit ? "Save Changes" : "Add Product"}
            </Button>
          </Group>
        </Group>

        {error && (
          <Alert
            color="red"
            variant="light"
            radius="md"
            icon={<AlertCircle size={16} />}
            mb="lg"
          >
            {error}
          </Alert>
        )}

        {/* ==================== 2-COLUMN FORM SCAFFOLD ==================== */}
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.8fr) minmax(0, 1.1fr)",
            gap: 24,
            alignItems: "flex-start",
          }}
        >
          {/* ==================== LEFT COLUMN (Main Details) ==================== */}
          <Stack gap={20}>
            {/* Card 1: General Information */}
            <Card
              p={20}
              radius="md"
              withBorder
              style={{
                background: "var(--app-surface)",
                borderColor: INK.border,
              }}
            >
              <Title order={4} mb={16} style={{ letterSpacing: -0.2, color: INK.text }}>
                General Information
              </Title>
              <Stack gap="md">
                <TextInput
                  label="Product Name"
                  placeholder="e.g. Panadol Extra 500mg, Cotton T-Shirt, Basmati Rice"
                  required
                  radius="md"
                  {...form.getInputProps("name")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 4 },
                  }}
                />

                <Group grow>
                  <TextInput
                    label="SKU / Item Code"
                    placeholder="e.g. PRD-10294"
                    radius="md"
                    rightSection={
                      <Tooltip label="Auto-generate SKU">
                        <ActionIcon variant="subtle" size="sm" onClick={generateSku}>
                          <Sparkles size={14} />
                        </ActionIcon>
                      </Tooltip>
                    }
                    {...form.getInputProps("sku")}
                    styles={{
                      label: { fontWeight: 600, fontSize: 13, marginBottom: 4 },
                    }}
                  />
                  <TextInput
                    label="Barcode / Serial (Optional)"
                    placeholder="Scan or enter barcode"
                    leftSection={<Barcode size={15} />}
                    radius="md"
                    {...form.getInputProps("barcode")}
                    styles={{
                      label: { fontWeight: 600, fontSize: 13, marginBottom: 4 },
                    }}
                  />
                </Group>

                <Textarea
                  label="Description / Storage Notes"
                  placeholder="Enter details about pack size, shelf location, or customer specs..."
                  minRows={2}
                  radius="md"
                  {...form.getInputProps("description")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 4 },
                  }}
                />
              </Stack>
            </Card>

            {/* Card 2: Pricing & Live Margin Calculator */}
            <Card
              p={20}
              radius="md"
              withBorder
              style={{
                background: "var(--app-surface)",
                borderColor: INK.border,
              }}
            >
              <Group justify="space-between" align="center" mb={16} wrap="wrap" gap="xs">
                <Box>
                  <Title order={4} style={{ letterSpacing: -0.2, color: INK.text }}>
                    Pricing & Profit Margin
                  </Title>
                  <Text size="xs" c="dimmed">
                    Track wholesale buying costs, retail prices, and gross profit return
                  </Text>
                </Box>
                {cost > 0 && (
                  <Group gap={6} align="center">
                    <Text size="xs" c="dimmed">Quick Target:</Text>
                    {[
                      { label: "+15% Wholesale", pct: 15 },
                      { label: "+25% Retail", pct: 25 },
                      { label: "+35% Standard", pct: 35 },
                      { label: "+50% Premium", pct: 50 },
                    ].map(({ label, pct }) => (
                      <Button
                        key={pct}
                        variant="subtle"
                        size="compact-xs"
                        radius="md"
                        onClick={() => applyMarkup(pct)}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          background: "var(--app-soft)",
                          color: INK.text,
                          border: `1px solid ${INK.border}`,
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </Group>
                )}
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" mb="md">
                <NumberInput
                  label="Cost Price (Wholesale / Buying)"
                  description="What you pay the supplier"
                  placeholder="0.00"
                  min={0}
                  decimalScale={2}
                  radius="md"
                  leftSection={<Text size="xs" fw={700} c="dimmed">Rs.</Text>}
                  {...form.getInputProps("costPrice")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 2 },
                  }}
                />
                <NumberInput
                  label="Selling Price (Retail / Counter)"
                  description="What customer pays at checkout"
                  placeholder="0.00"
                  min={0}
                  decimalScale={2}
                  required
                  radius="md"
                  leftSection={<Text size="xs" fw={700} c="dimmed">Rs.</Text>}
                  {...form.getInputProps("sellPrice")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 2 },
                  }}
                />
                <NumberInput
                  label="Sales Tax (GST %)"
                  description="Applicable federal/provincial tax"
                  placeholder="0"
                  min={0}
                  max={100}
                  decimalScale={2}
                  radius="md"
                  rightSection={<Percent size={14} color="var(--app-muted)" />}
                  {...form.getInputProps("taxRate")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 2 },
                  }}
                />
              </SimpleGrid>

              {/* Live Margin Indicator Strip */}
              {cost > 0 && sell > 0 ? (
                !isLoss ? (
                  <Box
                    p="sm"
                    style={{
                      borderRadius: 10,
                      background: "rgba(5, 150, 105, 0.08)",
                      border: "1px solid rgba(5, 150, 105, 0.25)",
                    }}
                  >
                    <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                      <Group gap="xs">
                        <TrendingUp size={18} color="#059669" />
                        <Text size="sm" fw={700} style={{ color: "#059669" }}>
                          Gross Profit: +Rs. {profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {unit}
                        </Text>
                      </Group>
                      <Group gap="xs">
                        <Badge color="green" variant="light" size="sm">
                          {markupPercent.toFixed(1)}% Markup
                        </Badge>
                        <Badge color="teal" variant="filled" size="sm">
                          {marginPercent.toFixed(1)}% Profit Margin
                        </Badge>
                      </Group>
                    </Group>

                    {stockQty > 0 && (
                      <Text size="xs" c="dimmed" mt={4}>
                        Projected inventory profit on {stockQty} {unit}:{" "}
                        <Text component="span" fw={700} style={{ ...LEDGER_NUM, color: "#059669" }}>
                          +Rs. {(profit * stockQty).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                      </Text>
                    )}
                  </Box>
                ) : (
                  <Box
                    p="sm"
                    style={{
                      borderRadius: 10,
                      background: "rgba(220, 38, 38, 0.08)",
                      border: "1px solid rgba(220, 38, 38, 0.3)",
                    }}
                  >
                    <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                      <Group gap="xs">
                        <TrendingDown size={18} color="#dc2626" />
                        <Text size="sm" fw={700} style={{ color: "#dc2626" }}>
                          Loss Warning: -Rs. {Math.abs(profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per {unit} sold
                        </Text>
                      </Group>
                      <Badge color="red" variant="filled" size="sm">
                        {marginPercent.toFixed(1)}% Negative Margin
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed" mt={4}>
                      Your selling price is lower than wholesale cost. Selling at this rate will erode capital.
                    </Text>
                  </Box>
                )
              ) : cost === 0 && sell > 0 ? (
                <Box
                  p="xs"
                  style={{
                    borderRadius: 8,
                    background: "var(--app-soft)",
                    border: `1px solid ${INK.border}`,
                  }}
                >
                  <Text size="xs" c="dimmed">
                    💡 Tip: Enter a wholesale cost price above to track your profit margin and prevent accidental loss-making sales.
                  </Text>
                </Box>
              ) : null}
            </Card>

            {/* Card 3: Inventory & Units */}
            <Card
              p={20}
              radius="md"
              withBorder
              style={{
                background: "var(--app-surface)",
                borderColor: INK.border,
              }}
            >
              <Title order={4} mb={16} style={{ letterSpacing: -0.2, color: INK.text }}>
                Inventory & Stock Units
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <NumberInput
                  label={isEdit ? "Stock Count" : "Initial Stock Quantity"}
                  description="Number of units currently in store or storage"
                  placeholder="0"
                  min={0}
                  radius="md"
                  {...form.getInputProps("quantityInStock")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 2 },
                  }}
                />
                <Box>
                  <Group justify="space-between" align="center" mb={2}>
                    <Text size="sm" fw={600} style={{ fontSize: 13, color: INK.text }}>
                      Measurement Unit
                    </Text>
                    <Button
                      variant="subtle"
                      size="compact-xs"
                      leftSection={<Plus size={12} />}
                      onClick={() => {
                        setNewUnitError(null);
                        setNewUnitModalOpen(true);
                      }}
                      style={{ color: "var(--app-accent)", fontWeight: 600 }}
                    >
                      + New Unit
                    </Button>
                  </Group>
                  <Select
                    description="Packaging unit for billing and stock adjustment"
                    data={unitOptions}
                    searchable
                    radius="md"
                    {...form.getInputProps("unit")}
                  />
                </Box>
              </SimpleGrid>
            </Card>
          </Stack>

          {/* ==================== RIGHT COLUMN (Organization & Status) ==================== */}
          <Stack gap={20}>
            {/* Card 1: Category & Supplier */}
            <Card
              p={20}
              radius="md"
              withBorder
              style={{
                background: "var(--app-surface)",
                borderColor: INK.border,
              }}
            >
              <Title order={4} mb={16} style={{ letterSpacing: -0.2, color: INK.text }}>
                Category & Supplier
              </Title>
              <Stack gap="md">
                <Select
                  label="Product Category"
                  placeholder="Select a category"
                  data={categoryOptions}
                  searchable
                  clearable
                  radius="md"
                  {...form.getInputProps("categoryId")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 2 },
                  }}
                />

                <Select
                  label="Supplier / Vendor"
                  placeholder="Select supplier"
                  data={supplierOptions}
                  searchable
                  clearable
                  radius="md"
                  {...form.getInputProps("supplierId")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 2 },
                  }}
                />
              </Stack>
            </Card>

            {/* Card 2: Status & Settings */}
            <Card
              p={20}
              radius="md"
              withBorder
              style={{
                background: "var(--app-surface)",
                borderColor: INK.border,
              }}
            >
              <Title order={4} mb={16} style={{ letterSpacing: -0.2, color: INK.text }}>
                Item Status
              </Title>
              <Stack gap="lg">
                <Group justify="space-between" align="center">
                  <Stack gap={2}>
                    <Text fw={600} size="sm">
                      Active for POS & Sales
                    </Text>
                    <Text size="xs" c="dimmed">
                      Item is active and searchable at checkout
                    </Text>
                  </Stack>
                  <Switch
                    checked={form.values.isActive}
                    onChange={(e) =>
                      form.setFieldValue("isActive", e.currentTarget.checked)
                    }
                    color="teal"
                    size="md"
                  />
                </Group>

                <Divider color={INK.border} />

                <Group justify="space-between" align="center">
                  <Stack gap={2}>
                    <Text fw={600} size="sm">
                      Subject to Sales Tax
                    </Text>
                    <Text size="xs" c="dimmed">
                      Apply GST rate during invoice calculations
                    </Text>
                  </Stack>
                  <Switch
                    checked={form.values.isTaxable}
                    onChange={(e) =>
                      form.setFieldValue("isTaxable", e.currentTarget.checked)
                    }
                    color="teal"
                    size="md"
                  />
                </Group>
              </Stack>
            </Card>
          </Stack>
        </Box>
      </form>

      {/* ==================== LOSS GUARDRAIL CONFIRMATION MODAL ==================== */}
      <Modal
        opened={lossModalOpen}
        onClose={() => setLossModalOpen(false)}
        title={
          <Group gap={8}>
            <AlertTriangle size={20} color="#dc2626" />
            <Text fw={700} size="md" c="red">
              Confirm Below-Cost Selling Price
            </Text>
          </Group>
        }
        centered
        radius="md"
      >
        <Stack gap="md">
          <Text size="sm">
            You are setting a selling price that is <strong>lower than your purchase cost</strong>:
          </Text>

          <Box
            p="sm"
            style={{
              background: "rgba(220, 38, 38, 0.08)",
              border: "1px solid rgba(220, 38, 38, 0.25)",
              borderRadius: 8,
            }}
          >
            <Group justify="space-between" mb={4}>
              <Text size="xs" c="dimmed">Wholesale Purchase Cost:</Text>
              <Text size="xs" fw={700} style={LEDGER_NUM}>Rs. {cost.toFixed(2)}</Text>
            </Group>
            <Group justify="space-between" mb={4}>
              <Text size="xs" c="dimmed">Retail Selling Price:</Text>
              <Text size="xs" fw={700} style={LEDGER_NUM}>Rs. {sell.toFixed(2)}</Text>
            </Group>
            <Divider my={4} />
            <Group justify="space-between">
              <Text size="xs" fw={700} c="red">Loss Per Unit:</Text>
              <Text size="sm" fw={800} style={{ ...LEDGER_NUM, color: "#dc2626" }}>
                -Rs. {Math.abs(profit).toFixed(2)} ({marginPercent.toFixed(1)}%)
              </Text>
            </Group>
          </Box>

          <Text size="xs" c="dimmed">
            Is this intentional (e.g. damaged stock liquidation, seasonal clearance), or was the selling price entered with a typo?
          </Text>

          <Group justify="flex-end" gap="sm" mt="xs">
            <Button
              variant="default"
              onClick={() => setLossModalOpen(false)}
              size="sm"
            >
              Go Back & Fix Price
            </Button>
            <Button
              color="red"
              onClick={() => void executeSave(form.values)}
              loading={loading}
              size="sm"
            >
              Yes, Save Below Cost
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ==================== CREATE CUSTOM UNIT MODAL ==================== */}
      <Modal
        opened={newUnitModalOpen}
        onClose={() => setNewUnitModalOpen(false)}
        title={
          <Group gap="xs">
            <Plus size={18} color="var(--app-accent)" />
            <Text fw={700} size="md" style={{ color: INK.text }}>
              Add Custom Measurement Unit
            </Text>
          </Group>
        }
        radius="md"
        centered
        styles={{
          header: { background: "var(--app-surface)", borderBottom: `1px solid ${INK.border}` },
          content: { background: "var(--app-surface)" },
        }}
      >
        <Stack gap="md" pt="xs">
          <Text size="sm" c="dimmed">
            Define a standard measurement unit (e.g. <em>Strip, Bundle, Dozen, Roll, Carton</em>) to keep packaging and billing consistent.
          </Text>

          {newUnitError && (
            <Alert color="red" variant="light" radius="md" icon={<AlertCircle size={16} />}>
              {newUnitError}
            </Alert>
          )}

          <TextInput
            label="Unit Name"
            placeholder="e.g. Strip, Bundle, Dozen, Drum"
            required
            radius="md"
            value={newUnitName}
            onChange={(e) => setNewUnitName(e.currentTarget.value)}
          />

          <TextInput
            label="Short Symbol / Abbreviation (Optional)"
            placeholder="e.g. strp, bdl, doz, drm"
            radius="md"
            value={newUnitSymbol}
            onChange={(e) => setNewUnitSymbol(e.currentTarget.value)}
          />

          <Group justify="flex-end" gap="sm" mt="md">
            <Button
              variant="default"
              size="sm"
              radius="md"
              onClick={() => setNewUnitModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              radius="md"
              loading={creatingUnit}
              onClick={handleCreateUnit}
              style={{
                background: "var(--app-accent, #1d2b54)",
                color: "#ffffff",
                fontWeight: 600,
              }}
            >
              Save & Use Unit
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
