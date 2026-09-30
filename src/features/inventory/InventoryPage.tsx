// ==========================================
// INVENTORY PAGE
// ==========================================
//
// The main inventory management screen.
// Uses Mantine Tabs to switch between:
//   1. Products — the main list
//   2. Categories — product groupings
//   3. Suppliers — who we buy from
//
// Each tab has its own list, create modal, and edit modal.
//
// Prices are stored as INTEGERS in the database (paisa/cents).
// This page converts them for display: 1500 → "15.00"
// And converts back on input: "15.00" → 1500
//
// ---- Visual identity ----
// This screen uses a deliberate "ledger" identity rather than the
// generic teal/blue SaaS gradient: a deep navy for structure and
// authority, a brass/gold accent for value-bearing numbers (prices,
// stock value), and tabular monospace figures so columns of numbers
// stay scannable the way they would in a paper ledger or POS receipt.
// Semantic colors (green/amber/red) are reserved strictly for status
// (in stock / low / out, active / inactive) so they keep their meaning.

import { useEffect, useMemo, useState, useCallback } from "react";

import { listen } from "@tauri-apps/api/event";

import { usePermissions } from "../permissions/PermissionsProvider";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  Drawer,
  Accordion,
  NumberInput,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
  ScrollArea,
  Alert,
  Divider,
  Menu,
  SegmentedControl,
  ThemeIcon,
} from "@mantine/core";

import { useForm } from "@mantine/form";

import { useMediaQuery } from "@mantine/hooks";
import {
  Package,
  PackagePlus,
  PackageMinus,
  ClipboardCheck,
  ArrowRight,
  ArrowLeft,
  Tags,
  Truck,
  Plus,
  Pencil,
  History,
  Search,
  FileSpreadsheet,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Trash2,
  Download,
  CheckCircle2,
  SlidersHorizontal,
  Check,
  MoreHorizontal,
  X,
  ChevronRight,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";

import {
  listCategories,
  createCategory,
  updateCategory,
  setCategoryActive,
  deleteCategory,
  listSuppliers,
  createSupplier,
  updateSupplier,
  setSupplierActive,
  deleteSupplier,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock,
  listStockMovements,
  listProductBatches,
  listExpiringBatches,
  writeOffBatch,
  getErrorMessage,
  listCustomFields,
  IMPORT_COMPLETE_EVENT,
} from "../../api/backend";

import type {
  PublicCategory,
  PublicProduct,
  PublicStockBatch,
  PublicStockMovement,
  PublicSupplier,
  PublicUser,
} from "../../types/backend";

import {
  AppDateInput,
  parseDateOnly,
} from "../../components/AppDateInput";
import { INK } from "../../theme";
import { reportOnboardingEvent } from "../../onboarding/bus";
import ProductFormPage from "./ProductFormPage";

// ==========================================
// DESIGN TOKENS — shared, defined in src/theme.ts
// ==========================================

// Monospace, tabular numerals for anything that is a quantity of money
// or units — this is the page's one deliberate typographic signature.
const LEDGER_NUM: React.CSSProperties = {
  fontFamily:
    'ui-monospace, "SF Mono", "Roboto Mono", "JetBrains Mono", Menlo, monospace',
  fontVariantNumeric: "tabular-nums",
};

// ==========================================
// PROPS
// ==========================================

interface InventoryPageProps {
  user: PublicUser;
  /** Navigate to the standalone Import Wizard module instead of mounting it inline. */
  onOpenImport?: () => void;
}

// ==========================================
// HELPERS
// ==========================================

// Convert paisa to display string: 1500 → "15.00"
function paisaToDisplay(paisa: number): string {
  return (paisa / 100).toFixed(2);
}

// Convert display string to paisa: "15.00" → 1500
function displayToPaisa(display: string | number): number {
  if (typeof display === "number") return Math.round(display * 100);
  const cleaned = String(display).replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

// Format date for display
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

// Days from today until the given date-only string (negative = already past).
function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round(
    (parseDateOnly(dateStr).getTime() - today.getTime()) / 86400000,
  );
}

// Reusable empty state — states what happened and the next action,
// rather than a bare "no data" line.
function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Stack align="center" gap={4} py={48}>
      <Box
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: INK.goldSoft,
          color: INK.gold,
        }}
      >
        {icon}
      </Box>
      <Text fw={600} size="sm" mt={8} style={{ color: INK.text }}>
        {title}
      </Text>
      <Text size="xs" c="dimmed" ta="center" maw={320}>
        {description}
      </Text>
    </Stack>
  );
}

// Reusable product visual avatar initial generator
function getProductInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "PR";
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

// Consistent subtle hue based on product name hash
function getProductColor(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [
    { bg: "rgba(59, 130, 246, 0.12)", text: "#3b82f6" }, // blue
    { bg: "rgba(16, 185, 129, 0.12)", text: "#10b981" }, // green
    { bg: "rgba(139, 92, 246, 0.12)", text: "#8b5cf6" }, // purple
    { bg: "rgba(245, 158, 11, 0.12)", text: "#f59e0b" }, // amber
    { bg: "rgba(236, 72, 153, 0.12)", text: "#ec4899" }, // pink
    { bg: "rgba(14, 165, 233, 0.12)", text: "#0ea5e9" }, // sky
    { bg: "rgba(99, 102, 241, 0.12)", text: "#6366f1" }, // indigo
  ];
  return hues[Math.abs(hash) % hues.length];
}

// Financial profit and margin calculator
function calculateMargin(costPricePaisa: number, sellPricePaisa: number) {
  const cost = costPricePaisa / 100;
  const sell = sellPricePaisa / 100;
  const profit = sell - cost;
  const marginPercent = sell > 0 ? (profit / sell) * 100 : 0;
  return { profit, marginPercent };
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function InventoryPage({ onOpenImport }: InventoryPageProps) {
  const isMobileHeader = useMediaQuery("(max-width: 36em)");
  const [isFormMode, setIsFormMode] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>("products");

  return (
    <Stack gap="lg">
      {!isFormMode && (
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
          <Stack gap={4}>
            <Box
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--app-accent-soft)",
                color: "var(--app-accent)",
                borderRadius: 999,
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.6px",
                textTransform: "uppercase",
                width: "fit-content",
              }}
            >
              <Package size={12} />
              <span>Inventory Workspace</span>
            </Box>
            <Title order={2} style={{ color: "var(--app-text)", letterSpacing: -0.4, fontWeight: 800 }}>
              Inventory Management
            </Title>
            <Text size="sm" c="dimmed">
              Unified catalog for live stock tracking, batch expirations, pricing margins, and supplier records.
            </Text>
          </Stack>
        </Group>
      )}

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        variant="pills"
        radius="md"
        className="inventory-tabs"
      >
        {!isFormMode && (
          <Tabs.List grow={isMobileHeader}>
            <Tabs.Tab value="products" leftSection={<Package size={15} />}>
              Products Catalog
            </Tabs.Tab>
            <Tabs.Tab value="categories" leftSection={<Tags size={15} />}>
              Categories
            </Tabs.Tab>
            <Tabs.Tab value="suppliers" leftSection={<Truck size={15} />}>
              Suppliers
            </Tabs.Tab>
          </Tabs.List>
        )}

        <Tabs.Panel value="products" pt={isFormMode ? 0 : "md"}>
          <ProductsTab onFormModeChange={setIsFormMode} onOpenImport={onOpenImport} />
        </Tabs.Panel>

        <Tabs.Panel value="categories" pt="md">
          <CategoriesTab />
        </Tabs.Panel>

        <Tabs.Panel value="suppliers" pt="md">
          <SuppliersTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

// ==========================================
// CATEGORIES TAB
// ==========================================

function CategoriesTab() {
  const perms = usePermissions();
  const canCreate = perms.can("inventory", "create");
  const canEdit = perms.can("inventory", "edit");
  const canDelete = perms.can("inventory", "delete");
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState(false);
  const [editingCategory, setEditingCategory] = useState<PublicCategory | null>(
    null,
  );
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await listCategories());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.description ?? "").toLowerCase().includes(q),
    );
  }, [categories, query]);

  function openCreate() {
    setEditingCategory(null);
    setFormMode(true);
  }

  function openEdit(cat: PublicCategory) {
    setEditingCategory(cat);
    setFormMode(true);
  }

  async function handleToggle(cat: PublicCategory) {
    try {
      await setCategoryActive({ categoryId: cat.id, active: !cat.isActive });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleDelete(cat: PublicCategory) {
    if (
      !confirm(
        `Delete category "${cat.name}"? Products in it are kept, just ungrouped.`,
      )
    )
      return;
    try {
      await deleteCategory(cat.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleSave(values: {
    name: string;
    description: string;
    skuPrefix: string;
  }) {
    try {
      if (editingCategory) {
        await updateCategory({
          categoryId: editingCategory.id,
          expectedVersion: editingCategory.version,
          ...values,
        });
      } else {
        await createCategory(values);
      }
      setFormMode(false);
      setEditingCategory(null);
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  if (formMode) {
    return (
      <CategoryFormView
        initial={editingCategory}
        onBack={() => {
          setFormMode(false);
          setEditingCategory(null);
        }}
        onSave={handleSave}
      />
    );
  }

  return (
    <Box
      style={{
        background: "var(--app-surface)",
        border: "1px solid var(--app-border)",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.04)",
      }}
    >
      <Box p="md" style={{ borderBottom: "1px solid var(--app-border)", background: "var(--app-soft)" }}>
        <Group justify="space-between" wrap="wrap" gap="sm">
          <TextInput
            placeholder="Search categories..."
            leftSection={<Search size={15} color="var(--app-muted)" />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            radius="md"
            w={{ base: "100%", sm: 300 }}
            styles={{
              input: {
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
                color: "var(--app-text)",
                fontSize: 13,
              },
            }}
          />
          <Group gap="sm">
            <Text size="xs" c="dimmed">
              Showing <strong style={{ color: "var(--app-text)" }}>{filtered.length}</strong> of {categories.length} categories
            </Text>
            {canCreate && (
              <Button
                size="sm"
                radius="md"
                leftSection={<Plus size={15} />}
                style={{ backgroundColor: "var(--app-accent)", color: "#ffffff", fontWeight: 600, fontSize: 13 }}
                onClick={openCreate}
              >
                Add Category
              </Button>
            )}
          </Group>
        </Group>
      </Box>

      {error && (
        <Box p="md">
          <Alert color="red" variant="light" radius="md" icon={<AlertTriangle size={16} />}>
            {error}
          </Alert>
        </Box>
      )}

      {loading ? (
        <Box p={40} ta="center">
          <Text c="dimmed" size="sm">
            Loading categories…
          </Text>
        </Box>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Tags size={20} />}
          title={categories.length === 0 ? "No categories yet" : "No matches"}
          description={
            categories.length === 0
              ? "Create a category to start organizing products by type."
              : "Try a different search term, or clear the search."
          }
        />
      ) : (
        <ScrollArea>
          <Table
            highlightOnHover
            verticalSpacing="md"
            horizontalSpacing="lg"
            miw={640}
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
                <Table.Th>Name</Table.Th>
                <Table.Th>SKU Prefix</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Created</Table.Th>
                {(canEdit || canDelete) && <Table.Th ta="right">Actions</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((cat) => (
                <Table.Tr key={cat.id}>
                  <Table.Td>
                    <Group gap="sm">
                      <Box
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: "var(--app-soft)",
                          color: "var(--app-accent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Tags size={15} />
                      </Box>
                      <Text fw={600} size="sm" style={{ color: "var(--app-text)" }}>
                        {cat.name}
                      </Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {cat.skuPrefix ? (
                      <Badge variant="light" color="violet" radius="sm">
                        {cat.skuPrefix}
                      </Badge>
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {cat.description || "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={cat.isActive ? "green" : "red"}
                      variant="light"
                      radius="sm"
                    >
                      {cat.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" style={LEDGER_NUM}>
                      {formatDate(cat.createdAt)}
                    </Text>
                  </Table.Td>
                  {(canEdit || canDelete) && (
                    <Table.Td ta="right">
                      <Group gap="xs" justify="flex-end">
                        {canEdit && (
                          <Tooltip label="Edit Category" withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="blue"
                              radius="md"
                              onClick={() => openEdit(cat)}
                            >
                              <Pencil size={15} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {canDelete && (
                          <Tooltip label="Delete Category" withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              radius="md"
                              onClick={() => handleDelete(cat)}
                            >
                              <Trash2 size={15} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {canEdit && (
                          <Switch
                            checked={cat.isActive}
                            onChange={() => handleToggle(cat)}
                            size="sm"
                            color="green"
                          />
                        )}
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

    </Box>
  );
}

// ---- Category Create/Edit Dedicated View ----

function CategoryFormView({
  initial,
  onBack,
  onSave,
}: {
  initial: PublicCategory | null;
  onBack: () => void;
  onSave: (values: {
    name: string;
    description: string;
    skuPrefix: string;
  }) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      skuPrefix: initial?.skuPrefix ?? "",
    },
    validate: {
      name: (v) => (v.trim().length < 1 ? "Category name is required" : null),
      skuPrefix: (v) =>
        v.trim().length > 6 ? "Keep SKU prefix to 6 characters" : null,
    },
  });

  useEffect(() => {
    form.setValues({
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      skuPrefix: initial?.skuPrefix ?? "",
    });
    setError(null);
  }, [initial]);

  function handleNameChange(value: string) {
    form.setFieldValue("name", value);
    if (!initial && !form.values.skuPrefix.trim()) {
      const prefix = value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
      if (prefix) {
        form.setFieldValue("skuPrefix", prefix);
      }
    }
  }

  async function handleSubmit(values: typeof form.values) {
    setLoading(true);
    setError(null);
    try {
      await onSave(values);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="xl" style={{ maxWidth: 860, margin: "0 auto", paddingBottom: 40 }}>
      <Box>
        <Button
          variant="subtle"
          color="gray"
          size="sm"
          leftSection={<ArrowLeft size={16} />}
          onClick={onBack}
          radius="md"
          mb="sm"
        >
          ← Back to Categories
        </Button>

        <Group justify="space-between" align="flex-end">
          <Box>
            <Title order={2} style={{ letterSpacing: -0.3 }}>
              {initial ? `Edit Category: ${initial.name}` : "Create New Product Category"}
            </Title>
            <Text size="sm" c="dimmed" mt={4}>
              Categories organize your inventory, drive POS filtering, and auto-generate SKU prefixes.
            </Text>
          </Box>

          <Group gap="sm">
            <Button variant="default" onClick={onBack} disabled={loading}>
              Cancel
            </Button>
            <Button
              loading={loading}
              onClick={() => void form.onSubmit(handleSubmit)()}
              style={{
                background: "var(--app-accent, #1d2b54)",
                color: "#ffffff",
                fontWeight: 600,
              }}
            >
              {initial ? "Save Changes" : "Create Category"}
            </Button>
          </Group>
        </Group>
      </Box>

      {error && (
        <Alert icon={<AlertTriangle size={16} />} color="red" radius="md">
          {error}
        </Alert>
      )}

      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="lg">
          <Card
            withBorder
            padding="xl"
            radius="md"
            style={{
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group gap="xs" mb="lg">
              <ThemeIcon size={34} radius="md" color="blue" variant="light">
                <Tags size={18} />
              </ThemeIcon>
              <Box>
                <Text fw={700} size="md">
                  Category Identity & Classification
                </Text>
                <Text size="xs" c="dimmed">
                  Official name and SKU shorthand prefix.
                </Text>
              </Box>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" mb="lg">
              <TextInput
                label="Category Name"
                placeholder="e.g. Beverages, Electronics, Hardware"
                required
                size="md"
                {...form.getInputProps("name")}
                onChange={(e) => handleNameChange(e.currentTarget.value)}
              />

              <TextInput
                label="SKU Shorthand Prefix"
                placeholder="e.g. BEV, ELEC"
                description="Auto-generates item SKUs: BEV-001, BEV-002"
                maxLength={6}
                size="md"
                {...form.getInputProps("skuPrefix")}
              />
            </SimpleGrid>

            <Textarea
              label="Description / Department Note"
              placeholder="Describe what items belong to this group (e.g. Cold drinks, juices and mineral waters)"
              minRows={3}
              {...form.getInputProps("description")}
            />
          </Card>

          <Group justify="flex-end" gap="sm">
            <Button variant="default" size="md" onClick={onBack} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="md"
              loading={loading}
              style={{
                background: "var(--app-accent, #1d2b54)",
                color: "#ffffff",
                fontWeight: 600,
                minWidth: 160,
              }}
            >
              {initial ? "Save Changes" : "Create Category"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}

// ==========================================
// SUPPLIERS TAB
// ==========================================

function SuppliersTab() {
  const perms = usePermissions();
  const canCreate = perms.can("inventory", "create");
  const canEdit = perms.can("inventory", "edit");
  const canDelete = perms.can("inventory", "delete");
  const [suppliers, setSuppliers] = useState<PublicSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<PublicSupplier | null>(
    null,
  );
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSuppliers(await listSuppliers());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.contactPerson ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q),
    );
  }, [suppliers, query]);

  function openCreate() {
    setEditingSupplier(null);
    setFormMode(true);
  }

  function openEdit(sup: PublicSupplier) {
    setEditingSupplier(sup);
    setFormMode(true);
  }

  async function handleToggle(sup: PublicSupplier) {
    try {
      await setSupplierActive({
        supplierId: sup.id,
        active: !sup.isActive,
      });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleDelete(sup: PublicSupplier) {
    if (!confirm(`Delete supplier "${sup.name}"? Purchase history is kept.`))
      return;
    try {
      await deleteSupplier(sup.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleSave(values: {
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
    address: string;
    taxNumber: string;
  }) {
    try {
      if (editingSupplier) {
        await updateSupplier({
          supplierId: editingSupplier.id,
          expectedVersion: editingSupplier.version,
          ...values,
        });
      } else {
        await createSupplier(values);
      }
      setFormMode(false);
      setEditingSupplier(null);
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  if (formMode) {
    return (
      <SupplierFormView
        initial={editingSupplier}
        onBack={() => {
          setFormMode(false);
          setEditingSupplier(null);
        }}
        onSave={handleSave}
      />
    );
  }

  return (
    <Box
      style={{
        background: "var(--app-surface)",
        border: "1px solid var(--app-border)",
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.04)",
      }}
    >
      <Box p="md" style={{ borderBottom: "1px solid var(--app-border)", background: "var(--app-soft)" }}>
        <Group justify="space-between" wrap="wrap" gap="sm">
          <TextInput
            placeholder="Search suppliers..."
            leftSection={<Search size={15} color="var(--app-muted)" />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            radius="md"
            w={{ base: "100%", sm: 300 }}
            styles={{
              input: {
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
                color: "var(--app-text)",
                fontSize: 13,
              },
            }}
          />
          <Group gap="sm">
            <Text size="xs" c="dimmed">
              Showing <strong style={{ color: "var(--app-text)" }}>{filtered.length}</strong> of {suppliers.length} suppliers
            </Text>
            {canCreate && (
              <Button
                size="sm"
                radius="md"
                leftSection={<Plus size={15} />}
                style={{ backgroundColor: "var(--app-accent)", color: "#ffffff", fontWeight: 600, fontSize: 13 }}
                onClick={openCreate}
              >
                Add Supplier
              </Button>
            )}
          </Group>
        </Group>
      </Box>

      {error && (
        <Box p="md">
          <Alert color="red" variant="light" radius="md" icon={<AlertTriangle size={16} />}>
            {error}
          </Alert>
        </Box>
      )}

      {loading ? (
        <Box p={40} ta="center">
          <Text c="dimmed" size="sm">
            Loading suppliers…
          </Text>
        </Box>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Truck size={20} />}
          title={suppliers.length === 0 ? "No suppliers yet" : "No matches"}
          description={
            suppliers.length === 0
              ? "Add a supplier to start linking products to where they're bought."
              : "Try a different search term, or clear the search."
          }
        />
      ) : (
        <ScrollArea>
          <Table
            highlightOnHover
            verticalSpacing="md"
            horizontalSpacing="lg"
            miw={640}
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
                <Table.Th>Name</Table.Th>
                <Table.Th>Contact Person</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Phone</Table.Th>
                <Table.Th>Status</Table.Th>
                {(canEdit || canDelete) && <Table.Th ta="right">Actions</Table.Th>}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map((sup) => (
                <Table.Tr key={sup.id}>
                  <Table.Td>
                    <Group gap="sm">
                      <Box
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: "var(--app-soft)",
                          color: "var(--app-accent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Truck size={15} />
                      </Box>
                      <Text fw={600} size="sm" style={{ color: "var(--app-text)" }}>
                        {sup.name}
                      </Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{sup.contactPerson || "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{sup.email || "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" style={LEDGER_NUM}>
                      {sup.phone || "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={sup.isActive ? "green" : "red"}
                      variant="light"
                      radius="sm"
                    >
                      {sup.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </Table.Td>
                  {(canEdit || canDelete) && (
                    <Table.Td ta="right">
                      <Group gap="xs" justify="flex-end">
                        {canEdit && (
                          <Tooltip label="Edit Supplier" withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="blue"
                              radius="md"
                              onClick={() => openEdit(sup)}
                            >
                              <Pencil size={15} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {canDelete && (
                          <Tooltip label="Delete Supplier" withArrow>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              radius="md"
                              onClick={() => handleDelete(sup)}
                            >
                              <Trash2 size={15} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {canEdit && (
                          <Switch
                            checked={sup.isActive}
                            onChange={() => handleToggle(sup)}
                            size="sm"
                            color="green"
                          />
                        )}
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

    </Box>
  );
}

// ---- Supplier Create/Edit Dedicated View ----

function SupplierFormView({
  initial,
  onBack,
  onSave,
}: {
  initial: PublicSupplier | null;
  onBack: () => void;
  onSave: (values: {
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
    address: string;
    taxNumber: string;
  }) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      name: initial?.name ?? "",
      contactPerson: initial?.contactPerson ?? "",
      email: initial?.email ?? "",
      phone: initial?.phone ?? "",
      address: initial?.address ?? "",
      taxNumber: initial?.taxNumber ?? "",
    },
    validate: {
      name: (v) => (v.trim().length < 1 ? "Supplier / Vendor name is required" : null),
    },
  });

  useEffect(() => {
    form.setValues({
      name: initial?.name ?? "",
      contactPerson: initial?.contactPerson ?? "",
      email: initial?.email ?? "",
      phone: initial?.phone ?? "",
      address: initial?.address ?? "",
      taxNumber: initial?.taxNumber ?? "",
    });
    setError(null);
  }, [initial]);

  async function handleSubmit(values: typeof form.values) {
    setLoading(true);
    setError(null);
    try {
      await onSave(values);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap="xl" style={{ maxWidth: 900, margin: "0 auto", paddingBottom: 40 }}>
      <Box>
        <Button
          variant="subtle"
          color="gray"
          size="sm"
          leftSection={<ArrowLeft size={16} />}
          onClick={onBack}
          radius="md"
          mb="sm"
        >
          ← Back to Suppliers
        </Button>

        <Group justify="space-between" align="flex-end">
          <Box>
            <Title order={2} style={{ letterSpacing: -0.3 }}>
              {initial ? `Edit Supplier: ${initial.name}` : "Register New Supplier / Vendor"}
            </Title>
            <Text size="sm" c="dimmed" mt={4}>
              Suppliers supply your purchase orders, stock restocking, and accounts payable.
            </Text>
          </Box>

          <Group gap="sm">
            <Button variant="default" onClick={onBack} disabled={loading}>
              Cancel
            </Button>
            <Button
              loading={loading}
              onClick={() => void form.onSubmit(handleSubmit)()}
              style={{
                background: "var(--app-accent, #1d2b54)",
                color: "#ffffff",
                fontWeight: 600,
              }}
            >
              {initial ? "Save Changes" : "Register Supplier"}
            </Button>
          </Group>
        </Group>
      </Box>

      {error && (
        <Alert icon={<AlertTriangle size={16} />} color="red" radius="md">
          {error}
        </Alert>
      )}

      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="lg">
          <Card
            withBorder
            padding="xl"
            radius="md"
            style={{
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group gap="xs" mb="lg">
              <ThemeIcon size={34} radius="md" color="teal" variant="light">
                <Truck size={18} />
              </ThemeIcon>
              <Box>
                <Text fw={700} size="md">
                  Vendor Identity & Contact Details
                </Text>
                <Text size="xs" c="dimmed">
                  Official vendor name, representative, and billing credentials.
                </Text>
              </Box>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" mb="lg">
              <TextInput
                label="Supplier / Vendor Company Name"
                placeholder="e.g. Nestlé Pakistan or Unilever Wholesale"
                required
                size="md"
                {...form.getInputProps("name")}
              />

              <TextInput
                label="Contact Person / Representative"
                placeholder="e.g. Ahmad Khan (Account Manager)"
                size="md"
                {...form.getInputProps("contactPerson")}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg" mb="lg">
              <TextInput
                label="Phone / Mobile (WhatsApp)"
                placeholder="e.g. 0300-1234567"
                size="md"
                {...form.getInputProps("phone")}
              />

              <TextInput
                label="Email Address"
                placeholder="orders@vendor.com"
                type="email"
                size="md"
                {...form.getInputProps("email")}
              />

              <TextInput
                label="Tax Number / NTN / STRN"
                placeholder="e.g. 1234567-8"
                size="md"
                {...form.getInputProps("taxNumber")}
              />
            </SimpleGrid>

            <Textarea
              label="Physical Warehouse / Office Address"
              placeholder="e.g. Plot 14, Sector 1-9, Industrial Area, Islamabad"
              minRows={3}
              {...form.getInputProps("address")}
            />
          </Card>

          <Group justify="flex-end" gap="sm">
            <Button variant="default" size="md" onClick={onBack} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="md"
              loading={loading}
              style={{
                background: "var(--app-accent, #1d2b54)",
                color: "#ffffff",
                fontWeight: 600,
                minWidth: 160,
              }}
            >
              {initial ? "Save Changes" : "Register Supplier"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}

// ==========================================
// PRODUCTS TAB
// ==========================================

// Colored badge for a product's soonest expiry date (based on its live batches).
function ExpiryBadge({ date }: { date: string }) {
  const days = daysUntil(date);
  const color = days < 0 ? "red" : days <= 30 ? "yellow" : "teal";
  const label =
    days < 0
      ? "Expired"
      : days <= 30
        ? `Expires in ${days} ${days === 1 ? "day" : "days"}`
        : `Expires ${formatDate(date)}`;
  return (
    <Badge color={color} variant="light" radius="sm" size="sm">
      {label}
    </Badge>
  );
}

// Helper to export products to CSV
function exportProductsToCsv(
  products: PublicProduct[],
  categoryMap: Map<string, string>,
  supplierMap: Map<string, string>,
) {
  const headers = [
    "SKU",
    "Product Name",
    "Category",
    "Supplier",
    "Cost Price",
    "Sell Price",
    "Stock Quantity",
    "Unit",
  ];
  const rows = products.map((p) => [
    `"${p.sku.replace(/"/g, '""')}"`,
    `"${p.name.replace(/"/g, '""')}"`,
    `"${(p.categoryId ? categoryMap.get(p.categoryId) ?? "" : "").replace(/"/g, '""')}"`,
    `"${(p.supplierId ? supplierMap.get(p.supplierId) ?? "" : "").replace(/"/g, '""')}"`,
    (p.costPrice / 100).toFixed(2),
    (p.sellPrice / 100).toFixed(2),
    p.quantityInStock,
    `"${(p.unit ?? "").replace(/"/g, '""')}"`,
  ]);
  const csvContent =
    "data:text/csv;charset=utf-8," +
    [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `products_export_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

interface ProductsTabProps {
  onFormModeChange?: (active: boolean) => void;
  onOpenImport?: () => void;
}

function ProductsTab({ onFormModeChange, onOpenImport }: ProductsTabProps) {
  const perms = usePermissions();
  const canCreate = perms.can("inventory", "create");
  const canEdit = perms.can("inventory", "edit");
  const canDelete = perms.can("inventory", "delete");
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [suppliers, setSuppliers] = useState<PublicSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Mode: list vs form (dedicated Kusale full-page)
  const [viewMode, setViewMode] = useState<"list" | "form">("list");
  const { dir } = useI18n();
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Editing product
  const [editingProduct, setEditingProduct] = useState<PublicProduct | null>(null);

  // Other Modals (stock, movements, batches, write-off)
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<PublicProduct | null>(null);
  const [movementsModalOpen, setMovementsModalOpen] = useState(false);
  const [movementsProduct, setMovementsProduct] =
    useState<PublicProduct | null>(null);
  const [expiringBatches, setExpiringBatches] = useState<PublicStockBatch[]>([]);
  const [batchesModalOpen, setBatchesModalOpen] = useState(false);
  const [batchesProduct, setBatchesProduct] = useState<PublicProduct | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<PublicStockBatch | null>(null);

  // Custom field definitions (created during import)
  const [customFieldDefs, setCustomFieldDefs] = useState<
    { fieldName: string; fieldLabel: string; fieldType: string }[]
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, cats, sups] = await Promise.all([
        listProducts(),
        listCategories(),
        listSuppliers(),
      ]);
      setProducts(prods);
      setCategories(cats);
      setSuppliers(sups);
      setError(null);

      // Load custom field definitions (created by import wizard)
      try {
        const fields = await listCustomFields();
        setCustomFieldDefs(
          fields
            .filter((f) => f.isVisible)
            .map((f) => ({
              fieldName: f.fieldName,
              fieldLabel: f.fieldLabel,
              fieldType: f.fieldType,
            })),
        );
      } catch {
        setCustomFieldDefs([]);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }

    // Expiry warning feed (best-effort — never blocks the products list)
    try {
      const batches = await listExpiringBatches(30);
      setExpiringBatches(batches);
    } catch {
      setExpiringBatches([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unlisten = listen(IMPORT_COMPLETE_EVENT, () => {
      load();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [load]);

  // Lookup maps for displaying names
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );
  const supplierMap = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  );

  const filtered = useMemo(() => {
    let result = products;

    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          (p.categoryId &&
            (categoryMap.get(p.categoryId) ?? "").toLowerCase().includes(q)) ||
          (p.supplierId &&
            (supplierMap.get(p.supplierId) ?? "").toLowerCase().includes(q)),
      );
    }

    if (selectedCategory && selectedCategory !== "all") {
      result = result.filter((p) => p.categoryId === selectedCategory);
    }

    if (selectedStatus === "in_stock") {
      result = result.filter((p) => p.quantityInStock >= 10);
    } else if (selectedStatus === "low_stock") {
      result = result.filter(
        (p) => p.quantityInStock > 0 && p.quantityInStock < 10,
      );
    } else if (selectedStatus === "out_of_stock") {
      result = result.filter((p) => p.quantityInStock <= 0);
    } else if (selectedStatus === "expiring") {
      const expiringIds = new Set(expiringBatches.map((b) => b.productId));
      result = result.filter(
        (p) => expiringIds.has(p.id) || (p.nextExpiryDate && daysUntil(p.nextExpiryDate) <= 30),
      );
    }

    return result;
  }, [products, query, selectedCategory, selectedStatus, categoryMap, supplierMap, expiringBatches]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function openCreate() {
    setEditingProduct(null);
    setViewMode("form");
    onFormModeChange?.(true);
  }

  function openEdit(prod: PublicProduct) {
    setEditingProduct(prod);
    setViewMode("form");
    onFormModeChange?.(true);
  }

  function closeForm() {
    setViewMode("list");
    setEditingProduct(null);
    onFormModeChange?.(false);
  }

  function openStock(prod: PublicProduct) {
    setStockProduct(prod);
    setStockModalOpen(true);
  }

  function openBatches(prod: PublicProduct) {
    setBatchesProduct(prod);
    setBatchesModalOpen(true);
  }

  function openMovements(prod: PublicProduct) {
    setMovementsProduct(prod);
    setMovementsModalOpen(true);
  }

  async function handleSaveProduct(values: {
    sku: string;
    name: string;
    categoryId: string;
    supplierId: string;
    costPrice: number;
    sellPrice: number;
    taxRate: number;
    quantityInStock: number;
    unit: string;
  }) {
    try {
      const costPricePaisa = displayToPaisa(values.costPrice);
      const sellPricePaisa = displayToPaisa(values.sellPrice);
      const taxRateBasisPoints = Math.round(values.taxRate * 100);

      if (editingProduct) {
        await updateProduct({
          productId: editingProduct.id,
          expectedVersion: editingProduct.version,
          sku: values.sku,
          name: values.name,
          categoryId: values.categoryId,
          supplierId: values.supplierId,
          costPrice: costPricePaisa,
          sellPrice: sellPricePaisa,
          taxRate: taxRateBasisPoints,
          unit: values.unit,
        });
      } else {
        await createProduct({
          sku: values.sku,
          name: values.name,
          categoryId: values.categoryId,
          supplierId: values.supplierId,
          costPrice: costPricePaisa,
          sellPrice: sellPricePaisa,
          taxRate: taxRateBasisPoints,
          quantityInStock: values.quantityInStock,
          unit: values.unit,
        });
        reportOnboardingEvent({ type: "product-created" });
      }
      closeForm();
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  async function handleDeleteProduct(prod: PublicProduct) {
    if (
      !confirm(
        `Delete product "${prod.name}" (${prod.sku})? Stock movements and history are kept.`,
      )
    )
      return;
    try {
      await deleteProduct(prod.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleStockAdjust(values: {
    movementType: string;
    quantity: number;
    referenceNote: string;
    expiryDate?: string;
    batchNumber?: string;
  }) {
    if (!stockProduct) return;
    try {
      await adjustStock({
        productId: stockProduct.id,
        movementType: values.movementType,
        quantity: values.quantity,
        referenceNote: values.referenceNote,
        expiryDate: values.expiryDate?.trim() ? values.expiryDate.trim() : null,
        batchNumber: values.batchNumber?.trim() ? values.batchNumber.trim() : null,
      });
      setStockModalOpen(false);
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  // If in form mode, render the dedicated Kusale full-page form
  if (viewMode === "form") {
    return (
      <ProductFormPage
        initial={editingProduct}
        categories={categories}
        suppliers={suppliers}
        onSave={handleSaveProduct}
        onCancel={closeForm}
        onCategoryCreated={(cat) => setCategories((prev) => [...prev, cat])}
        onSupplierCreated={(sup) => setSuppliers((prev) => [...prev, sup])}
      />
    );
  }

  // Calculate totals
  const totalProducts = products.length;
  const inStockProducts = products.filter((p) => p.quantityInStock >= 10);
  const lowStockCount = products.filter(
    (p) => p.quantityInStock > 0 && p.quantityInStock < 10,
  ).length;
  const outOfStockCount = products.filter((p) => p.quantityInStock <= 0).length;
  const totalStock = products.reduce((sum, p) => sum + p.quantityInStock, 0);
  const totalValue = products.reduce(
    (sum, p) => sum + p.sellPrice * p.quantityInStock,
    0,
  );

  return (
    <Stack gap="lg">
      {/* ---- Executive Metrics Ribbon (Interactive & Glancable) ---- */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {/* Metric 1: Total Catalog */}
        <Box
          p={16}
          onClick={() => {
            setSelectedStatus("all");
            setPage(1);
          }}
          style={{
            background: "var(--app-surface)",
            border: selectedStatus === "all" ? "2px solid var(--app-accent)" : "1px solid var(--app-border)",
            borderRadius: 14,
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 110,
          }}
        >
          <Group justify="space-between" align="center">
            <Text size="xs" fw={700} style={{ color: "var(--app-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Total Catalog
            </Text>
            <Badge size="xs" variant="light" color="blue">
              All SKUs
            </Badge>
          </Group>
          <Group justify="space-between" align="baseline" mt={6}>
            <Text fw={800} size="26px" style={{ ...LEDGER_NUM, color: "var(--app-text)", lineHeight: 1 }}>
              {totalProducts.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              Valuation: <strong style={{ color: "var(--app-text)", ...LEDGER_NUM }}>Rs. {(totalValue / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}</strong>
            </Text>
          </Group>
        </Box>

        {/* Metric 2: In Stock (Healthy) */}
        <Box
          p={16}
          onClick={() => {
            setSelectedStatus("in_stock");
            setPage(1);
          }}
          style={{
            background: "var(--app-surface)",
            border: selectedStatus === "in_stock" ? "2px solid #10b981" : "1px solid var(--app-border)",
            borderRadius: 14,
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 110,
          }}
        >
          <Group justify="space-between" align="center">
            <Text size="xs" fw={700} style={{ color: "var(--app-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              In Stock (Healthy)
            </Text>
            <Badge size="xs" variant="light" color="green" leftSection={<CheckCircle2 size={10} />}>
              ≥10 Units
            </Badge>
          </Group>
          <Group justify="space-between" align="baseline" mt={6}>
            <Text fw={800} size="26px" style={{ ...LEDGER_NUM, color: "var(--app-text)", lineHeight: 1 }}>
              {inStockProducts.length.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              Total Units: <strong style={{ color: "var(--app-text)", ...LEDGER_NUM }}>{totalStock.toLocaleString()}</strong>
            </Text>
          </Group>
        </Box>

        {/* Metric 3: Low Stock (<10) */}
        <Box
          p={16}
          onClick={() => {
            setSelectedStatus("low_stock");
            setPage(1);
          }}
          style={{
            background: "var(--app-surface)",
            border: selectedStatus === "low_stock" ? "2px solid #f59e0b" : "1px solid var(--app-border)",
            borderRadius: 14,
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 110,
          }}
        >
          <Group justify="space-between" align="center">
            <Text size="xs" fw={700} style={{ color: "var(--app-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Low Stock Warning
            </Text>
            <Badge size="xs" variant="light" color="yellow" leftSection={<AlertTriangle size={10} />}>
              &lt;10 Units
            </Badge>
          </Group>
          <Group justify="space-between" align="baseline" mt={6}>
            <Text fw={800} size="26px" style={{ ...LEDGER_NUM, color: lowStockCount > 0 ? "#f59e0b" : "var(--app-text)", lineHeight: 1 }}>
              {lowStockCount.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              {lowStockCount > 0 ? "Reorder needed" : "Adequately stocked"}
            </Text>
          </Group>
        </Box>

        {/* Metric 4: Out of Stock */}
        <Box
          p={16}
          onClick={() => {
            setSelectedStatus("out_of_stock");
            setPage(1);
          }}
          style={{
            background: "var(--app-surface)",
            border: selectedStatus === "out_of_stock" ? "2px solid #ef4444" : "1px solid var(--app-border)",
            borderRadius: 14,
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 110,
          }}
        >
          <Group justify="space-between" align="center">
            <Text size="xs" fw={700} style={{ color: "var(--app-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Out of Stock
            </Text>
            <Badge size="xs" variant="light" color="red">
              0 Units
            </Badge>
          </Group>
          <Group justify="space-between" align="baseline" mt={6}>
            <Text fw={800} size="26px" style={{ ...LEDGER_NUM, color: outOfStockCount > 0 ? "#ef4444" : "var(--app-text)", lineHeight: 1 }}>
              {outOfStockCount.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              {outOfStockCount > 0 ? "Unavailable for sale" : "No depleted items"}
            </Text>
          </Group>
        </Box>
      </SimpleGrid>

      {/* ---- Expiring Batches Quick Alert Banner (if any batches expire within 30 days) ---- */}
      {expiringBatches.length > 0 && selectedStatus !== "expiring" && (
        <Box
          p="sm"
          style={{
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <Group gap={8}>
            <CalendarClock size={17} color="#f59e0b" />
            <Text size="xs" fw={600} style={{ color: "var(--app-text)" }}>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>{expiringBatches.length} batch(es)</span> expire within 30 days. Review expiry dates and manage write-offs.
            </Text>
          </Group>
          <Button
            size="xs"
            variant="light"
            color="yellow"
            radius="md"
            onClick={() => {
              setSelectedStatus("expiring");
              setPage(1);
            }}
            rightSection={<ChevronRight size={13} />}
          >
            Review Expiring Batches ({expiringBatches.length})
          </Button>
        </Box>
      )}

      {/* ---- Segmented Status View Tabs & Action Bar ---- */}
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        {/* Status view pills */}
        <Group gap={6} wrap="wrap">
          {[
            { id: "all", label: "All Items", count: totalProducts },
            { id: "in_stock", label: "In Stock", count: inStockProducts.length, color: "green" },
            { id: "low_stock", label: "Low Stock", count: lowStockCount, color: "yellow" },
            { id: "out_of_stock", label: "Out of Stock", count: outOfStockCount, color: "red" },
            ...(expiringBatches.length > 0 ? [{ id: "expiring", label: "Expiring Soon", count: expiringBatches.length, color: "orange" }] : []),
          ].map((tab) => {
            const active = selectedStatus === tab.id;
            return (
              <Button
                key={tab.id}
                size="xs"
                variant={active ? "filled" : "subtle"}
                color={active ? (tab.color ?? "blue") : "gray"}
                radius="pill"
                onClick={() => {
                  setSelectedStatus(tab.id);
                  setPage(1);
                }}
                styles={{
                  root: {
                    fontWeight: active ? 700 : 500,
                    fontSize: 12,
                    background: active ? undefined : "transparent",
                    color: active ? "#ffffff" : "var(--app-text)",
                    border: active ? "none" : "1px solid var(--app-border)",
                    "&:hover": {
                      background: active ? undefined : "var(--app-soft)",
                    },
                  },
                }}
              >
                {tab.label}
                <Badge
                  size="xs"
                  variant={active ? "filled" : "outline"}
                  color={active ? "dark" : tab.color ?? "gray"}
                  ml={6}
                  style={{
                    backgroundColor: active ? "rgba(0,0,0,0.25)" : undefined,
                    color: active ? "#ffffff" : undefined,
                  }}
                >
                  {tab.count}
                </Badge>
              </Button>
            );
          })}
        </Group>

        {/* Actions: Import, Export & Add Product */}
        <Group gap="sm">
          {onOpenImport && perms.canManage && (
            <Button
              variant="default"
              radius="md"
              size="sm"
              leftSection={<FileSpreadsheet size={14} />}
              onClick={() => {
                onOpenImport();
                reportOnboardingEvent({ type: "wizard-opened" });
              }}
              data-tour="import-button"
              style={{
                borderColor: "var(--app-border)",
                background: "var(--app-surface)",
                color: "var(--app-text)",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Import
            </Button>
          )}

          <Button
            variant="default"
            radius="md"
            size="sm"
            leftSection={<Download size={14} />}
            onClick={() => exportProductsToCsv(filtered, categoryMap, supplierMap)}
            style={{
              borderColor: "var(--app-border)",
              background: "var(--app-surface)",
              color: "var(--app-text)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Export CSV
          </Button>

          {canCreate && (
            <Button
              radius="md"
              size="sm"
              onClick={openCreate}
              data-tour="add-product"
              leftSection={<Plus size={15} />}
              style={{
                background: "var(--app-accent)",
                color: "#ffffff",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Add Product
            </Button>
          )}
        </Group>
      </Group>

      {/* ---- Toolbar (Search + Category Select + Filter Drawer Trigger) ---- */}
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="sm" style={{ flex: 1, minWidth: 280 }}>
          <TextInput
            placeholder="Search by name, SKU, category, supplier..."
            leftSection={<Search size={15} color="var(--app-muted)" />}
            rightSection={
              query ? (
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setQuery("")}>
                  <X size={12} />
                </ActionIcon>
              ) : null
            }
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setPage(1);
            }}
            radius="md"
            style={{ flex: 1, minWidth: 220 }}
            styles={{
              input: {
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
                color: "var(--app-text)",
                fontSize: 13,
              },
            }}
          />

          <Select
            placeholder="All Categories"
            data={[{ value: "all", label: "All Categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
            value={selectedCategory}
            onChange={(val) => {
              setSelectedCategory(val ?? "all");
              setPage(1);
            }}
            radius="md"
            w={180}
            styles={{
              input: {
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
                color: "var(--app-text)",
                fontSize: 13,
              },
            }}
          />

          <Button
            variant="default"
            radius="md"
            leftSection={<SlidersHorizontal size={14} />}
            onClick={() => setFilterDrawerOpen(true)}
            style={{
              borderColor: (selectedCategory !== "all" || selectedStatus !== "all") ? "var(--app-accent)" : "var(--app-border)",
              background: (selectedCategory !== "all" || selectedStatus !== "all") ? "var(--app-accent-soft)" : "var(--app-surface)",
              color: (selectedCategory !== "all" || selectedStatus !== "all") ? "var(--app-accent)" : "var(--app-text)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Filters
            {(selectedCategory !== "all" || selectedStatus !== "all") && (
              <Badge size="xs" variant="filled" ml={6} style={{ background: "var(--app-accent)" }}>
                {(selectedCategory !== "all" ? 1 : 0) + (selectedStatus !== "all" ? 1 : 0)}
              </Badge>
            )}
          </Button>

          {(selectedCategory !== "all" || selectedStatus !== "all" || query) && (
            <Button
              variant="subtle"
              size="xs"
              color="gray"
              onClick={() => {
                setSelectedCategory("all");
                setSelectedStatus("all");
                setQuery("");
                setPage(1);
              }}
            >
              Reset All
            </Button>
          )}
        </Group>
      </Group>

      {/* ---- Slide-Over Filter Drawer (Radix UI Sheet Pattern) ---- */}
      <Drawer
        opened={filterDrawerOpen}
        onClose={() => setFilterDrawerOpen(false)}
        position={dir === "rtl" ? "left" : "right"}
        size={380}
        title={
          <Stack gap={2}>
            <Text fw={700} size="md" style={{ color: "var(--app-text)" }}>
              All Filters
            </Text>
            <Text size="xs" c="dimmed">
              Filter products by stock status and category
            </Text>
          </Stack>
        }
        styles={{
          content: { background: "var(--app-surface)", display: "flex", flexDirection: "column" },
          body: { flex: 1, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" },
          header: { borderBottom: "1px solid var(--app-border)", padding: "16px 20px" },
        }}
      >
        <Box style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          <Accordion defaultValue={["status", "category"]} multiple variant="separated" radius="md">
            {/* Stock Condition Accordion */}
            <Accordion.Item value="status" style={{ background: "transparent", border: "none" }}>
              <Accordion.Control style={{ padding: "10px 4px" }}>
                <Text size="sm" fw={600}>Stock Condition</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap={4}>
                  {[
                    { id: "all", label: "Any Condition", count: products.length },
                    { id: "in_stock", label: "In Stock (≥10)", count: inStockProducts.length },
                    { id: "low_stock", label: "Low Stock (<10)", count: lowStockCount },
                    { id: "out_of_stock", label: "Out of Stock (0)", count: outOfStockCount },
                  ].map((opt) => {
                    const active = selectedStatus === opt.id;
                    return (
                      <Box
                        key={opt.id}
                        onClick={() => {
                          setSelectedStatus(opt.id);
                          setPage(1);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          borderRadius: 8,
                          cursor: "pointer",
                          background: active ? "var(--app-accent-soft)" : "transparent",
                          color: active ? "var(--app-accent)" : "var(--app-text)",
                          fontWeight: active ? 600 : 500,
                          fontSize: 13,
                          transition: "all 0.15s ease",
                        }}
                      >
                        <Check
                          size={16}
                          style={{
                            opacity: active ? 1 : 0,
                            transition: "opacity 0.15s ease",
                          }}
                        />
                        <Text size="sm" style={{ flex: 1 }}>{opt.label}</Text>
                        <Badge size="xs" variant={active ? "filled" : "outline"}>
                          {opt.count}
                        </Badge>
                      </Box>
                    );
                  })}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>

            {/* Category Accordion */}
            <Accordion.Item value="category" style={{ background: "transparent", border: "none" }}>
              <Accordion.Control style={{ padding: "10px 4px" }}>
                <Text size="sm" fw={600}>Category</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap={4}>
                  <Box
                    onClick={() => {
                      setSelectedCategory("all");
                      setPage(1);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 8,
                      cursor: "pointer",
                      background: selectedCategory === "all" ? "var(--app-accent-soft)" : "transparent",
                      color: selectedCategory === "all" ? "var(--app-accent)" : "var(--app-text)",
                      fontWeight: selectedCategory === "all" ? 600 : 500,
                      fontSize: 13,
                    }}
                  >
                    <Check
                      size={16}
                      style={{
                        opacity: selectedCategory === "all" ? 1 : 0,
                        transition: "opacity 0.15s ease",
                      }}
                    />
                    <Text size="sm" style={{ flex: 1 }}>All Categories</Text>
                    <Badge size="xs" variant={selectedCategory === "all" ? "filled" : "outline"}>
                      {products.length}
                    </Badge>
                  </Box>
                  {categories.map((cat) => {
                    const active = selectedCategory === cat.id;
                    const count = products.filter((p) => p.categoryId === cat.id).length;
                    return (
                      <Box
                        key={cat.id}
                        onClick={() => {
                          setSelectedCategory(cat.id);
                          setPage(1);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          borderRadius: 8,
                          cursor: "pointer",
                          background: active ? "var(--app-accent-soft)" : "transparent",
                          color: active ? "var(--app-accent)" : "var(--app-text)",
                          fontWeight: active ? 600 : 500,
                          fontSize: 13,
                        }}
                      >
                        <Check
                          size={16}
                          style={{
                            opacity: active ? 1 : 0,
                            transition: "opacity 0.15s ease",
                          }}
                        />
                        <Text size="sm" style={{ flex: 1 }}>{cat.name}</Text>
                        <Badge size="xs" variant={active ? "filled" : "outline"}>
                          {count}
                        </Badge>
                      </Box>
                    );
                  })}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Box>

        {/* Sticky Bottom Primary Action Button */}
        <Box
          p={16}
          style={{
            borderTop: "1px solid var(--app-border)",
            background: "var(--app-surface)",
          }}
        >
          <Button
            fullWidth
            size="md"
            radius="md"
            onClick={() => setFilterDrawerOpen(false)}
            style={{
              background: "var(--app-accent)",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            Show {filtered.length} items
          </Button>
        </Box>
      </Drawer>

      {error && (
        <Alert
          color="red"
          variant="light"
          radius="md"
          icon={<AlertTriangle size={16} />}
        >
          {error}
        </Alert>
      )}

      {/* ---- Products Table Container (Anti-Slop Executive Layout) ---- */}
      <Box
        style={{
          background: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          borderRadius: 16,
          boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.04)",
          overflow: "hidden",
        }}
      >
        {selectedStatus === "expiring" ? (
          /* Dedicated Expiring Batches Table View */
          <Box>
            <Box p="md" style={{ background: "var(--app-soft)", borderBottom: "1px solid var(--app-border)" }}>
              <Group justify="space-between" align="center" wrap="wrap">
                <Group gap={8}>
                  <CalendarClock size={18} color="#f59e0b" />
                  <Text fw={700} size="sm" style={{ color: "var(--app-text)" }}>
                    Batches Expiring Within 30 Days ({expiringBatches.length})
                  </Text>
                </Group>
                <Button size="xs" variant="subtle" color="gray" onClick={() => setSelectedStatus("all")}>
                  ← Back to All Products
                </Button>
              </Group>
            </Box>

            {expiringBatches.length === 0 ? (
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
                    {expiringBatches.map((b) => {
                      const days = daysUntil(b.expiryDate);
                      return (
                        <Table.Tr key={b.id}>
                          <Table.Td>
                            <Stack gap={2}>
                              <Text fw={600} size="sm" style={{ color: "var(--app-text)" }}>
                                {b.productName}
                              </Text>
                              <Text size="xs" c="dimmed">
                                SKU: #{b.productSku}
                              </Text>
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" fw={600} style={{ ...LEDGER_NUM, color: "var(--app-text)" }}>
                              {b.batchNumber || "—"}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={2}>
                              <Text size="sm" style={{ ...LEDGER_NUM, color: "var(--app-text)" }}>
                                {formatDate(b.expiryDate)}
                              </Text>
                              <Badge size="xs" color={days < 0 ? "red" : days <= 7 ? "red" : "yellow"} variant="light">
                                {days < 0 ? `Expired ${Math.abs(days)}d ago` : `Expires in ${days}d`}
                              </Badge>
                            </Stack>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text size="sm" fw={800} style={{ ...LEDGER_NUM, color: "var(--app-text)" }}>
                              {b.quantity}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge color={b.status === "expired" ? "red" : "yellow"} variant="light" radius="sm">
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
                                onClick={() => setWriteOffTarget(b)}
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
        ) : loading ? (
          <Box p={40} ta="center">
            <Text c="dimmed" size="sm">
              Loading inventory catalog…
            </Text>
          </Box>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Package size={20} />}
            title={totalProducts === 0 ? "No products yet" : "No matching products"}
            description={
              totalProducts === 0
                ? "Add your first product or import a spreadsheet to populate the catalog."
                : "Try searching with a different keyword or reset active filters."
            }
          />
        ) : (
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
                {paginatedProducts.map((prod) => {
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
                          {/* Item Initial Avatar */}
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
                            <Text fw={600} size="sm" style={{ color: "var(--app-text)", lineHeight: 1.3 }}>
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
                          {prod.categoryId ? categoryMap.get(prod.categoryId) ?? "—" : "—"}
                        </Text>
                      </Table.Td>

                      {/* Supplier */}
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {prod.supplierId ? supplierMap.get(prod.supplierId) ?? "—" : "—"}
                        </Text>
                      </Table.Td>

                      {/* Pricing & Profit Margin */}
                      <Table.Td ta="right">
                        <Stack gap={2} align="flex-end">
                          <Text fw={700} size="sm" style={{ ...LEDGER_NUM, color: "var(--app-text)" }}>
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
                              {margin.profit >= 0 ? `+${margin.marginPercent.toFixed(0)}%` : `${margin.marginPercent.toFixed(0)}%`}
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
                                background: inStock ? "#10b981" : lowStock ? "#f59e0b" : "#ef4444",
                              }}
                            />
                            <Text
                              size="sm"
                              fw={700}
                              style={{
                                ...LEDGER_NUM,
                                color: inStock ? "#10b981" : lowStock ? "#f59e0b" : "#ef4444",
                              }}
                            >
                              {prod.quantityInStock} {prod.unit || "units"}
                            </Text>
                          </Group>

                          {/* Mini visual stock bar */}
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
                                width: `${Math.min(100, Math.max(5, (prod.quantityInStock / 15) * 100))}%`,
                                height: "100%",
                                background: inStock ? "#10b981" : lowStock ? "#f59e0b" : "#ef4444",
                                borderRadius: 999,
                              }}
                            />
                          </Box>

                          <Text size="11px" c="dimmed">
                            {inStock ? "Adequately stocked" : lowStock ? "Low buffer (<10)" : "Depleted"}
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
                                  leftSection={<PackagePlus size={13} color="var(--app-accent)" />}
                                  onClick={() => openStock(prod)}
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

                            <Menu shadow="md" width={180} position="bottom-end" radius="md">
                              <Menu.Target>
                                <ActionIcon variant="subtle" color="gray" size="md" radius="md">
                                  <MoreHorizontal size={16} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}>
                                {canEdit && (
                                  <Menu.Item
                                    leftSection={<Pencil size={14} />}
                                    onClick={() => openEdit(prod)}
                                  >
                                    Edit Details
                                  </Menu.Item>
                                )}
                                {canEdit && (
                                  <Menu.Item
                                    leftSection={<History size={14} />}
                                    onClick={() => openMovements(prod)}
                                  >
                                    Stock Movements
                                  </Menu.Item>
                                )}
                                {canEdit && (
                                  <Menu.Item
                                    leftSection={<CalendarDays size={14} />}
                                    onClick={() => openBatches(prod)}
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
                                      onClick={() => handleDeleteProduct(prod)}
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
        )}

        {/* Pagination Footer */}
        {!loading && filtered.length > 0 && selectedStatus !== "expiring" && (
          <Box
            p="md"
            style={{
              borderTop: "1px solid var(--app-border)",
              background: "var(--app-soft)",
            }}
          >
            <Group justify="space-between" align="center" wrap="wrap">
              <Text size="xs" c="dimmed">
                Showing{" "}
                <strong style={{ color: "var(--app-text)" }}>
                  {(page - 1) * pageSize + 1}
                </strong>{" "}
                –{" "}
                <strong style={{ color: "var(--app-text)" }}>
                  {Math.min(page * pageSize, filtered.length)}
                </strong>{" "}
                out of{" "}
                <strong style={{ color: "var(--app-text)" }}>
                  {filtered.length}
                </strong>{" "}
                products
              </Text>

              {totalPages > 1 && (
                <Pagination
                  total={totalPages}
                  value={page}
                  onChange={setPage}
                  radius="pill"
                  size="sm"
                  color="dark"
                />
              )}
            </Group>
          </Box>
        )}
      </Box>

      {/* ---- Stock Adjustment Modal ---- */}
      <StockAdjustModal
        opened={stockModalOpen}
        onClose={() => setStockModalOpen(false)}
        onSave={handleStockAdjust}
        product={stockProduct}
        categoryName={stockProduct?.categoryId ? categoryMap.get(stockProduct.categoryId) : undefined}
      />

      {/* ---- Stock Movements Modal ---- */}
      <MovementsModal
        opened={movementsModalOpen}
        onClose={() => setMovementsModalOpen(false)}
        product={movementsProduct}
      />

      {/* ---- Batches / Expiry Modal ---- */}
      <BatchesModal
        opened={batchesModalOpen}
        onClose={() => setBatchesModalOpen(false)}
        product={batchesProduct}
        onChanged={load}
      />

      {/* ---- Write-off confirm modal ---- */}
      <WriteOffModal
        batch={writeOffTarget}
        onClose={() => setWriteOffTarget(null)}
        onWrittenOff={async () => {
          setWriteOffTarget(null);
          await load();
        }}
      />
    </Stack>
  );
}

// ---- Stock Adjustment Modal ----

type AdjustMode = "receive" | "remove" | "count" | "expiry";

function StockAdjustModal({
  opened,
  onClose,
  onSave,
  product,
  categoryName,
}: {
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
}) {
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
        // Backend expects negative integer for stock out
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
          {/* ---- Product Overview Card ---- */}
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
                <Text
                  fw={700}
                  size="sm"
                  style={{ color: INK.text }}
                  truncate
                >
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

          {/* ---- Mode Switcher ---- */}
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

          {/* ---- Mode 1: Receive Stock ---- */}
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

          {/* ---- Mode 2: Remove Stock ---- */}
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

          {/* ---- Mode 3: Physical Shelf Count ---- */}
          {mode === "count" && (
            <Stack gap="sm">
              <Box>
                <Text size="xs" fw={600} style={{ color: INK.text }} mb={4}>
                  Actual Physical Count on Shelf
                </Text>
                <Text size="xs" c="dimmed" mb={8}>
                  Count the physical items in your shop or storage right now. The
                  system will automatically calculate the adjustment.
                </Text>
                <NumberInput
                  value={countedUnits}
                  onChange={setCountedUnits}
                  min={0}
                  step={1}
                  size="sm"
                  placeholder="Enter counted units"
                  allowNegative={false}
                  rightSection={
                    <Text size="xs" c="dimmed" pr="xs" fw={600}>
                      {unit}
                    </Text>
                  }
                />
              </Box>

              {/* Live Comparison Box */}
              <Box
                p="sm"
                style={{
                  background:
                    countDiff === 0
                      ? "var(--app-surface)"
                      : countDiff > 0
                      ? "rgba(5, 150, 105, 0.08)"
                      : "rgba(217, 119, 6, 0.08)",
                  border: `1px solid ${
                    countDiff === 0
                      ? INK.border
                      : countDiff > 0
                      ? "rgba(5, 150, 105, 0.3)"
                      : "rgba(217, 119, 6, 0.3)"
                  }`,
                  borderRadius: 10,
                }}
              >
                <Stack gap={6}>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      System Recorded Stock:
                    </Text>
                    <Text size="xs" fw={700} style={LEDGER_NUM}>
                      {currentStock.toLocaleString()} {unit}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Your Physical Count:
                    </Text>
                    <Text size="xs" fw={700} style={LEDGER_NUM}>
                      {numCountedUnits.toLocaleString()} {unit}
                    </Text>
                  </Group>
                  <Divider />
                  <Group justify="space-between" align="center">
                    <Text size="xs" fw={700} style={{ color: INK.text }}>
                      Adjustment Required:
                    </Text>
                    {countDiff === 0 ? (
                      <Badge color="gray" variant="light">
                        0 (Exact Match)
                      </Badge>
                    ) : countDiff > 0 ? (
                      <Badge color="teal" variant="filled">
                        +{countDiff} {unit} (Surplus)
                      </Badge>
                    ) : (
                      <Badge color="amber" variant="filled">
                        {countDiff} {unit} (Shortage)
                      </Badge>
                    )}
                  </Group>
                </Stack>
              </Box>

              {countDiff === 0 ? (
                <Text size="xs" c="dimmed" ta="center">
                  ✨ System records and physical shelf count are already identical. No adjustment required.
                </Text>
              ) : countDiff > 0 ? (
                <Text size="xs" c="teal" fw={500}>
                  📈 +{countDiff} units will be added to system inventory to match your shelf count.
                </Text>
              ) : (
                <Text size="xs" c="orange" fw={500}>
                  📉 {Math.abs(countDiff)} units will be deducted from system inventory to match your shelf count.
                </Text>
              )}
            </Stack>
          )}

          {/* ---- Mode 4: Set Expiry Date Only ---- */}
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

          {/* ---- Universal Reference Note ---- */}
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

          {/* ---- Action Buttons ---- */}
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

// ---- Stock Movements History Modal ----

function MovementsModal({
  opened,
  onClose,
  product,
}: {
  opened: boolean;
  onClose: () => void;
  product: PublicProduct | null;
}) {
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

// ---- Batches / Expiry Detail Modal ----

function BatchesModal({
  opened,
  onClose,
  product,
  onChanged,
}: {
  opened: boolean;
  onClose: () => void;
  product: PublicProduct | null;
  onChanged: () => Promise<void>;
}) {
  const { dir } = useI18n();
  const [batches, setBatches] = useState<PublicStockBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<PublicStockBatch | null>(
    null,
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

// ---- Write-off confirm modal ----

function WriteOffModal({
  batch,
  onClose,
  onWrittenOff,
}: {
  batch: PublicStockBatch | null;
  onClose: () => void;
  onWrittenOff: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("expiry write-off");
  const isMobile = useMediaQuery("(max-width: 48em)");

  useEffect(() => {
    if (batch) {
      setError(null);
    }
  }, [batch]);

  async function handleWriteOff() {
    if (!batch) return;
    if (batch.quantity <= 0) {
      setError("This batch is already depleted (0 units left).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await writeOffBatch({
        batchId: batch.id,
        quantity: batch.quantity,
        reason: reason.trim() || "expiry write-off",
      });
      await onWrittenOff();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={!!batch}
      onClose={onClose}
      title={
        <Group gap={8}>
          <Trash2 size={16} color="red" />
          <Text fw={700} style={{ color: INK.text }}>
            Write off batch
          </Text>
        </Group>
      }
      centered
      radius="md"
      fullScreen={isMobile}
      transitionProps={isMobile ? { transition: "slide-up" } : undefined}
    >
      <Stack gap="md">
        {batch && (
          <Card
            padding="sm"
            radius="sm"
            style={{ background: INK.paper, border: `1px solid ${INK.border}` }}
          >
            <Group justify="space-between" wrap="wrap">
              <Text size="sm" c="dimmed">
                Expiry {formatDate(batch.expiryDate)} · {batch.productName}
              </Text>
              <Text size="sm" c="dimmed">
                Batch {batch.batchNumber || "—"}
              </Text>
              <Text fw={700} style={{ ...LEDGER_NUM, color: INK.text }}>
                {batch.quantity} units will be written off
              </Text>
            </Group>
          </Card>
        )}

        <TextInput
          label="Reason"
          placeholder="e.g. expired, damaged"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />

        <Text size="xs" c="dimmed">
          The entire remaining quantity of this batch is written off: both the
          batch and the product's stock on hand drop to 0. It is recorded as an
          adjustment in stock history.
        </Text>

        {error && (
          <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
            {error}
          </Alert>
        )}

        <Divider />

        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={loading}
            leftSection={<Trash2 size={14} />}
            onClick={handleWriteOff}
          >
            Write Off
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
