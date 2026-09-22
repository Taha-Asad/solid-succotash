// ==========================================
// ADD / EDIT PRODUCT PAGE
// Full-page, clean, humanistic 2-column layout
// Modeled directly after reference design (Kusale / add_item_ref.jpg)
// ==========================================

import { useState, useEffect } from "react";
import {
  Box,
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
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  Barcode,
  Sparkles,
  AlertCircle,
} from "lucide-react";

import { listUnits, getErrorMessage } from "../../api/backend";
import type {
  PublicCategory,
  PublicProduct,
  PublicSupplier,
  PublicUnit,
} from "../../types/backend";

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
  const [units, setUnits] = useState<PublicUnit[]>([]);

  useEffect(() => {
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

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
      name: (val) => (val.trim().length === 0 ? "Product name is required" : null),
      sellPrice: (val) => (val < 0 ? "Selling price cannot be negative" : null),
    },
  });

  // Auto-generate SKU helper
  const generateSku = () => {
    const random = Math.floor(100000 + Math.random() * 900000);
    form.setFieldValue("sku", `SKU-${random}`);
  };

  async function handleSubmit(values: typeof form.values) {
    setLoading(true);
    setError(null);
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

  const unitOptions = units.length > 0
    ? units.map((u) => ({ value: u.name, label: u.symbol ? `${u.name} (${u.symbol})` : u.name }))
    : [
        { value: "pcs", label: "Pieces (pcs)" },
        { value: "kg", label: "Kilograms (kg)" },
        { value: "box", label: "Boxes (box)" },
        { value: "litre", label: "Litres (ltr)" },
        { value: "meter", label: "Meters (mtr)" },
        { value: "pack", label: "Packs (pk)" },
      ];

  return (
    <Box pb={40}>
      <form onSubmit={form.onSubmit(handleSubmit)}>
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
                Product List
              </Text>
              <Text size="xs" c="dimmed">
                ›
              </Text>
              <Text size="xs" fw={600} c="indigo">
                {isEdit ? "Edit Product" : "Add Product"}
              </Text>
            </Group>

            <Title order={2} style={{ letterSpacing: -0.5 }}>
              {isEdit ? `Edit: ${initial.name}` : "Add New Product"}
            </Title>
          </Stack>

          {/* Action buttons */}
          <Group gap="sm">
            <Button
              variant="default"
              size="sm"
              radius="pill"
              onClick={onCancel}
              style={{
                borderColor: "var(--app-border)",
                background: "var(--app-surface)",
                fontWeight: 600,
              }}
            >
              Discard Changes
            </Button>
            <Button
              type="submit"
              size="sm"
              radius="pill"
              loading={loading}
              style={{
                background: "#4F61ED",
                color: "#ffffff",
                fontWeight: 600,
                boxShadow: "0 4px 14px -2px rgba(79, 97, 237, 0.35)",
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
            gap: 28,
            alignItems: "flex-start",
          }}
        >
          {/* ==================== LEFT COLUMN (Main Details) ==================== */}
          <Stack gap={24}>
            {/* Card 1: General Information */}
            <Box
              p={24}
              style={{
                background: "var(--app-surface)",
                border: "1px solid var(--app-border)",
                borderRadius: 20,
                boxShadow: "0 4px 18px -4px rgba(18, 28, 56, 0.03)",
              }}
            >
              <Title order={4} mb={18} style={{ letterSpacing: -0.2 }}>
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
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                    input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
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
                      label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                      input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
                    }}
                  />
                  <TextInput
                    label="Barcode / Serial (Optional)"
                    placeholder="Scan or enter barcode"
                    leftSection={<Barcode size={15} />}
                    radius="md"
                    {...form.getInputProps("barcode")}
                    styles={{
                      label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                      input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
                    }}
                  />
                </Group>

                <Textarea
                  label="Description / Storage Notes"
                  placeholder="Enter details about pack size, shelf location, or customer specs..."
                  minRows={3}
                  radius="md"
                  {...form.getInputProps("description")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                    input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
                  }}
                />
              </Stack>
            </Box>

            {/* Card 2: Pricing */}
            <Box
              p={24}
              style={{
                background: "var(--app-surface)",
                border: "1px solid var(--app-border)",
                borderRadius: 20,
                boxShadow: "0 4px 18px -4px rgba(18, 28, 56, 0.03)",
              }}
            >
              <Title order={4} mb={18} style={{ letterSpacing: -0.2 }}>
                Pricing & Taxation
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                <NumberInput
                  label="Cost Price (Buying)"
                  placeholder="0.00"
                  min={0}
                  decimalScale={2}
                  radius="md"
                  {...form.getInputProps("costPrice")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                    input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
                  }}
                />
                <NumberInput
                  label="Selling Price (Retail)"
                  placeholder="0.00"
                  min={0}
                  decimalScale={2}
                  required
                  radius="md"
                  {...form.getInputProps("sellPrice")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                    input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
                  }}
                />
                <NumberInput
                  label="Tax Rate (GST %)"
                  placeholder="0"
                  min={0}
                  max={100}
                  decimalScale={2}
                  radius="md"
                  {...form.getInputProps("taxRate")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                    input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
                  }}
                />
              </SimpleGrid>
            </Box>

            {/* Card 3: Inventory & Units */}
            <Box
              p={24}
              style={{
                background: "var(--app-surface)",
                border: "1px solid var(--app-border)",
                borderRadius: 20,
                boxShadow: "0 4px 18px -4px rgba(18, 28, 56, 0.03)",
              }}
            >
              <Title order={4} mb={18} style={{ letterSpacing: -0.2 }}>
                Inventory & Stock Units
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <NumberInput
                  label={isEdit ? "Stock Count" : "Initial Stock Quantity"}
                  placeholder="0"
                  min={0}
                  radius="md"
                  {...form.getInputProps("quantityInStock")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                    input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
                  }}
                />
                <Select
                  label="Measurement Unit"
                  data={unitOptions}
                  radius="md"
                  {...form.getInputProps("unit")}
                  styles={{
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                    input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
                  }}
                />
              </SimpleGrid>
            </Box>
          </Stack>

          {/* ==================== RIGHT COLUMN (Organization & Status) ==================== */}
          <Stack gap={24}>
            {/* Card 1: Category & Supplier */}
            <Box
              p={24}
              style={{
                background: "var(--app-surface)",
                border: "1px solid var(--app-border)",
                borderRadius: 20,
                boxShadow: "0 4px 18px -4px rgba(18, 28, 56, 0.03)",
              }}
            >
              <Title order={4} mb={18} style={{ letterSpacing: -0.2 }}>
                Category & Brand
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
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                    input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
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
                    label: { fontWeight: 600, fontSize: 13, marginBottom: 6 },
                    input: { background: "var(--app-soft)", borderColor: "var(--app-border)" },
                  }}
                />
              </Stack>
            </Box>

            {/* Card 2: Status & Settings */}
            <Box
              p={24}
              style={{
                background: "var(--app-surface)",
                border: "1px solid var(--app-border)",
                borderRadius: 20,
                boxShadow: "0 4px 18px -4px rgba(18, 28, 56, 0.03)",
              }}
            >
              <Title order={4} mb={18} style={{ letterSpacing: -0.2 }}>
                Item Status
              </Title>
              <Stack gap="lg">
                <Group justify="space-between" align="center">
                  <Stack gap={2}>
                    <Text fw={600} size="sm">
                      Active for POS & Sales
                    </Text>
                    <Text size="xs" c="dimmed">
                      Item is available for billing
                    </Text>
                  </Stack>
                  <Switch
                    checked={form.values.isActive}
                    onChange={(e) => form.setFieldValue("isActive", e.currentTarget.checked)}
                    color="indigo"
                    size="md"
                  />
                </Group>

                <Divider color="var(--app-border)" />

                <Group justify="space-between" align="center">
                  <Stack gap={2}>
                    <Text fw={600} size="sm">
                      Subject to Sales Tax
                    </Text>
                    <Text size="xs" c="dimmed">
                      Calculate tax at checkout
                    </Text>
                  </Stack>
                  <Switch
                    checked={form.values.isTaxable}
                    onChange={(e) => form.setFieldValue("isTaxable", e.currentTarget.checked)}
                    color="indigo"
                    size="md"
                  />
                </Group>
              </Stack>
            </Box>
          </Stack>
        </Box>
      </form>
    </Box>
  );
}
