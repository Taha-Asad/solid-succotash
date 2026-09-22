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
} from "@mantine/core";

import { useForm } from "@mantine/form";

import { useMediaQuery } from "@mantine/hooks";
import {
  Package,
  PackagePlus,
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
  TrendingUp,
  Download,
  MoreVertical,
  CheckCircle2,
} from "lucide-react";

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
  const num = typeof display === "number" ? display : parseFloat(display);
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

// Small reusable "eyebrow" label — used above section titles to give
// each panel a consistent, formal document-like header rhythm.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="xs"
      fw={700}
      style={{
        color: INK.goldDeep,
        letterSpacing: 1.4,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
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

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function InventoryPage({ onOpenImport }: InventoryPageProps) {
  const perms = usePermissions();
  const isMobileHeader = useMediaQuery("(max-width: 36em)");
  const [isFormMode, setIsFormMode] = useState(false);

  return (
    <Stack gap="lg">
      {!isFormMode && (
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Stack gap={2}>
            <Eyebrow>Inventory</Eyebrow>
            <Title order={2} style={{ color: INK.text, letterSpacing: -0.3 }}>
              Inventory Management
            </Title>
            <Text size="sm" c="dimmed">
              Track products, stock levels, categories and suppliers in one place.
            </Text>
          </Stack>
          {perms.canManage && (
            <Button
              leftSection={<FileSpreadsheet size={16} />}
              variant="filled"
              color="dark"
              fullWidth={isMobileHeader}
              styles={{
                root: {
                  backgroundColor: INK.navy,
                  "&:hover": { backgroundColor: INK.navySoft },
                },
              }}
              onClick={() => {
                onOpenImport?.();
                reportOnboardingEvent({ type: "wizard-opened" });
              }}
              data-tour="import-button"
            >
              Import from Excel / CSV
            </Button>
          )}
        </Group>
      )}

      <Tabs
        defaultValue="products"
        variant="outline"
        styles={{
          tab: {
            fontWeight: 600,
            "&[data-active]": {
              color: INK.text,
              borderColor: INK.gold,
            },
          },
          list: {
            flexWrap: "wrap",
            rowGap: 4,
          },
        }}
      >
        {!isFormMode && (
          <Tabs.List grow={isMobileHeader}>
            <Tabs.Tab value="products" leftSection={<Package size={16} />}>
              Products
            </Tabs.Tab>
            <Tabs.Tab value="categories" leftSection={<Tags size={16} />}>
              Categories
            </Tabs.Tab>
            <Tabs.Tab value="suppliers" leftSection={<Truck size={16} />}>
              Suppliers
            </Tabs.Tab>
          </Tabs.List>
        )}

        <Tabs.Panel value="products" pt={isFormMode ? 0 : "md"}>
          <ProductsTab onFormModeChange={setIsFormMode} />
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
  const [modalOpen, setModalOpen] = useState(false);
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
    setModalOpen(true);
  }

  function openEdit(cat: PublicCategory) {
    setEditingCategory(cat);
    setModalOpen(true);
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
      setModalOpen(false);
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  return (
    <Card
      withBorder
      radius="md"
      padding="lg"
      style={{ borderColor: INK.border }}
    >
      <Stack>
        <Group justify="space-between" wrap="wrap">
          <TextInput
            placeholder="Search categories..."
            leftSection={<Search size={15} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={{ base: "100%", sm: 260 }}
          />
          <Group gap="sm">
            <Text size="sm" c="dimmed">
              {filtered.length} of {categories.length} categories
            </Text>
            {canCreate && (
              <Button
                size="sm"
                leftSection={<Plus size={16} />}
                style={{ backgroundColor: INK.navy }}
                onClick={openCreate}
              >
                Add Category
              </Button>
            )}
          </Group>
        </Group>

        {error && (
          <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Text c="dimmed" size="sm">
            Loading categories…
          </Text>
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
              striped
              highlightOnHover
              withTableBorder
              verticalSpacing="sm"
              miw={640}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>SKU Prefix</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Created</Table.Th>
                  {(canEdit || canDelete) && <Table.Th>Actions</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((cat) => (
                  <Table.Tr key={cat.id}>
                    <Table.Td>
                      <Text fw={600} size="sm" style={{ color: INK.text }}>
                        {cat.name}
                      </Text>
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
                      <Table.Td>
                        <Group gap="xs">
                          {canEdit && (
                            <Tooltip label="Edit">
                              <ActionIcon
                                variant="subtle"
                                color="dark"
                                onClick={() => openEdit(cat)}
                              >
                                <Pencil size={15} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {canDelete && (
                            <Tooltip label="Delete">
                              <ActionIcon
                                variant="subtle"
                                color="red"
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
      </Stack>

      <CategoryModal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        initial={editingCategory}
      />
    </Card>
  );
}

// ---- Category Create/Edit Modal ----

function CategoryModal({
  opened,
  onClose,
  onSave,
  initial,
}: {
  opened: boolean;
  onClose: () => void;
  onSave: (values: {
    name: string;
    description: string;
    skuPrefix: string;
  }) => Promise<void>;
  initial: PublicCategory | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 48em)");

  const form = useForm({
    initialValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      skuPrefix: initial?.skuPrefix ?? "",
    },
    validate: {
      name: (v) => (v.trim().length < 1 ? "Name is required" : null),
      skuPrefix: (v) =>
        v.trim().length > 6 ? "Keep it to 6 characters" : null,
    },
  });

  // Reset form when initial changes (open new modal)
  useEffect(() => {
    form.setValues({
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      skuPrefix: initial?.skuPrefix ?? "",
    });
    setError(null);
  }, [initial]);

  // Suggest a SKU prefix from the category name while typing
  // (only on new categories, and only if the user hasn't typed one).
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
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <Tags size={16} color={INK.gold} />
          <Text fw={700} style={{ color: INK.text }}>
            {initial ? "Edit Category" : "New Category"}
          </Text>
        </Group>
      }
      centered
      radius="md"
      fullScreen={isMobile}
      transitionProps={isMobile ? { transition: "slide-up" } : undefined}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Category Name"
            placeholder="e.g. Electronics, Stationery"
            required
            {...form.getInputProps("name")}
            onChange={(e) => handleNameChange(e.currentTarget.value)}
          />
          <TextInput
            label="SKU Prefix"
            placeholder="e.g. ELEC"
            description="Used to auto-generate SKUs: ELEC-001, ELEC-002, ..."
            maxLength={6}
            {...form.getInputProps("skuPrefix")}
          />
          <Textarea
            label="Description"
            placeholder="What kind of products go here?"
            rows={3}
            {...form.getInputProps("description")}
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
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={loading}
              style={{ backgroundColor: INK.navy }}
            >
              {initial ? "Save Changes" : "Create Category"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
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
  const [modalOpen, setModalOpen] = useState(false);
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
    setModalOpen(true);
  }

  function openEdit(sup: PublicSupplier) {
    setEditingSupplier(sup);
    setModalOpen(true);
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
      setModalOpen(false);
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  return (
    <Card
      withBorder
      radius="md"
      padding="lg"
      style={{ borderColor: INK.border }}
    >
      <Stack>
        <Group justify="space-between" wrap="wrap">
          <TextInput
            placeholder="Search suppliers..."
            leftSection={<Search size={15} />}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={{ base: "100%", sm: 260 }}
          />
          <Group gap="sm">
            <Text size="sm" c="dimmed">
              {filtered.length} of {suppliers.length} suppliers
            </Text>
            {canCreate && (
              <Button
                size="sm"
                leftSection={<Plus size={16} />}
                style={{ backgroundColor: INK.navy }}
                onClick={openCreate}
              >
                Add Supplier
              </Button>
            )}
          </Group>
        </Group>

        {error && (
          <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Text c="dimmed" size="sm">
            Loading suppliers…
          </Text>
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
              striped
              highlightOnHover
              withTableBorder
              verticalSpacing="sm"
              miw={640}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Contact</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Phone</Table.Th>
                  <Table.Th>Status</Table.Th>
                  {(canEdit || canDelete) && <Table.Th>Actions</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((sup) => (
                  <Table.Tr key={sup.id}>
                    <Table.Td>
                      <Text fw={600} size="sm" style={{ color: INK.text }}>
                        {sup.name}
                      </Text>
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
                      <Table.Td>
                        <Group gap="xs">
                          {canEdit && (
                            <Tooltip label="Edit">
                              <ActionIcon
                                variant="subtle"
                                color="dark"
                                onClick={() => openEdit(sup)}
                              >
                                <Pencil size={15} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {canDelete && (
                            <Tooltip label="Delete">
                              <ActionIcon
                                variant="subtle"
                                color="red"
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
      </Stack>

      <SupplierModal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        initial={editingSupplier}
      />
    </Card>
  );
}

// ---- Supplier Create/Edit Modal ----

function SupplierModal({
  opened,
  onClose,
  onSave,
  initial,
}: {
  opened: boolean;
  onClose: () => void;
  onSave: (values: {
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
    address: string;
    taxNumber: string;
  }) => Promise<void>;
  initial: PublicSupplier | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 48em)");

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
      name: (v) => (v.trim().length < 1 ? "Name is required" : null),
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
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <Truck size={16} color={INK.gold} />
          <Text fw={700} style={{ color: INK.text }}>
            {initial ? "Edit Supplier" : "New Supplier"}
          </Text>
        </Group>
      }
      size="lg"
      centered
      radius="md"
      fullScreen={isMobile}
      transitionProps={isMobile ? { transition: "slide-up" } : undefined}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Supplier Name"
            placeholder="e.g. Ali Traders"
            required
            {...form.getInputProps("name")}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Contact Person"
              placeholder="Ahmad Khan"
              {...form.getInputProps("contactPerson")}
            />
            <TextInput
              label="Phone"
              placeholder="+92 300 1234567"
              {...form.getInputProps("phone")}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Email"
              placeholder="info@supplier.com"
              {...form.getInputProps("email")}
            />
            <TextInput
              label="Tax Number"
              placeholder="NTN or STRN"
              {...form.getInputProps("taxNumber")}
            />
          </SimpleGrid>
          <Textarea
            label="Address"
            placeholder="Full address"
            rows={2}
            {...form.getInputProps("address")}
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
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={loading}
              style={{ backgroundColor: INK.navy }}
            >
              {initial ? "Save Changes" : "Create Supplier"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
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
}

function ProductsTab({ onFormModeChange }: ProductsTabProps) {
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
    }

    return result;
  }, [products, query, selectedCategory, selectedStatus, categoryMap, supplierMap]);

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
    <Stack gap="xl">
      {/* ---- 4 Summary Cards (Directly Modeled on Pharmly Reference) ---- */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        {/* Card 1: Total Products (Hero Emerald) */}
        <Box
          p={22}
          style={{
            background: "#103830",
            borderRadius: 20,
            color: "#ffffff",
            boxShadow: "0 6px 20px -4px rgba(16, 56, 48, 0.25)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 140,
          }}
        >
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text size="sm" fw={600} style={{ color: "#ffffff", letterSpacing: -0.2 }}>
                Total Products
              </Text>
              <Text size="xs" style={{ color: "#82a8a0" }}>
                Active in catalog
              </Text>
            </Stack>
            <ActionIcon variant="subtle" color="gray" size="sm" radius="pill">
              <MoreVertical size={16} color="#82a8a0" />
            </ActionIcon>
          </Group>

          <Group justify="space-between" align="baseline" mt={12}>
            <Text fw={800} size="30px" style={{ ...LEDGER_NUM, color: "#ffffff", lineHeight: 1 }}>
              {totalProducts.toLocaleString()}
            </Text>
            <Box
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "#1a4940",
                color: "#6ee7b7",
                borderRadius: 999,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <TrendingUp size={12} strokeWidth={2.5} />
              <span>100% Tracked</span>
            </Box>
          </Group>

          <Text size="xs" mt={10} style={{ color: "#82a8a0" }}>
            Stock Valuation:{" "}
            <strong style={{ color: "#ffffff", ...LEDGER_NUM }}>
              Rs. {(totalValue / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </strong>
          </Text>
        </Box>

        {/* Card 2: In Stock */}
        <Box
          p={22}
          style={{
            background: "var(--app-surface)",
            border: "1px solid var(--app-border)",
            borderRadius: 20,
            boxShadow: "0 4px 18px -4px rgba(18, 28, 56, 0.03)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 140,
          }}
        >
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text size="sm" fw={600} style={{ color: "var(--app-text)", letterSpacing: -0.2 }}>
                In Stock
              </Text>
              <Text size="xs" c="dimmed">
                Healthy levels (≥10)
              </Text>
            </Stack>
            <ActionIcon variant="subtle" color="gray" size="sm" radius="pill">
              <MoreVertical size={16} />
            </ActionIcon>
          </Group>

          <Group justify="space-between" align="baseline" mt={12}>
            <Text fw={800} size="30px" style={{ ...LEDGER_NUM, color: "var(--app-text)", lineHeight: 1 }}>
              {inStockProducts.length.toLocaleString()}
            </Text>
            <Box
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "#ecfdf5",
                color: "#059669",
                borderRadius: 999,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <CheckCircle2 size={12} strokeWidth={2.5} />
              <span>Healthy</span>
            </Box>
          </Group>

          <Text size="xs" mt={10} c="dimmed">
            Total Units:{" "}
            <strong style={{ color: "var(--app-text)", ...LEDGER_NUM }}>
              {totalStock.toLocaleString()} units
            </strong>
          </Text>
        </Box>

        {/* Card 3: Low Stock */}
        <Box
          p={22}
          style={{
            background: "var(--app-surface)",
            border: "1px solid var(--app-border)",
            borderRadius: 20,
            boxShadow: "0 4px 18px -4px rgba(18, 28, 56, 0.03)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 140,
          }}
        >
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text size="sm" fw={600} style={{ color: "var(--app-text)", letterSpacing: -0.2 }}>
                Low Stock
              </Text>
              <Text size="xs" c="dimmed">
                Running low (&lt;10)
              </Text>
            </Stack>
            <ActionIcon variant="subtle" color="gray" size="sm" radius="pill">
              <MoreVertical size={16} />
            </ActionIcon>
          </Group>

          <Group justify="space-between" align="baseline" mt={12}>
            <Text fw={800} size="30px" style={{ ...LEDGER_NUM, color: "var(--app-text)", lineHeight: 1 }}>
              {lowStockCount.toLocaleString()}
            </Text>
            <Box
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "#fffbeb",
                color: "#d97706",
                borderRadius: 999,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <AlertTriangle size={12} strokeWidth={2.5} />
              <span>Needs Reorder</span>
            </Box>
          </Group>

          <Text size="xs" mt={10} c="dimmed">
            {lowStockCount > 0
              ? `${lowStockCount} items below safety buffer`
              : "All items adequately stocked"}
          </Text>
        </Box>

        {/* Card 4: Out of Stock */}
        <Box
          p={22}
          style={{
            background: "var(--app-surface)",
            border: "1px solid var(--app-border)",
            borderRadius: 20,
            boxShadow: "0 4px 18px -4px rgba(18, 28, 56, 0.03)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 140,
          }}
        >
          <Group justify="space-between" align="flex-start">
            <Stack gap={2}>
              <Text size="sm" fw={600} style={{ color: "var(--app-text)", letterSpacing: -0.2 }}>
                Out of Stock
              </Text>
              <Text size="xs" c="dimmed">
                Zero units remaining
              </Text>
            </Stack>
            <ActionIcon variant="subtle" color="gray" size="sm" radius="pill">
              <MoreVertical size={16} />
            </ActionIcon>
          </Group>

          <Group justify="space-between" align="baseline" mt={12}>
            <Text
              fw={800}
              size="30px"
              style={{
                ...LEDGER_NUM,
                color: outOfStockCount > 0 ? "#e11d48" : "var(--app-text)",
                lineHeight: 1,
              }}
            >
              {outOfStockCount.toLocaleString()}
            </Text>
            <Box
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: outOfStockCount > 0 ? "#fef2f2" : "#ecfdf5",
                color: outOfStockCount > 0 ? "#e11d48" : "#059669",
                borderRadius: 999,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {outOfStockCount > 0 ? (
                <AlertTriangle size={12} strokeWidth={2.5} />
              ) : (
                <CheckCircle2 size={12} strokeWidth={2.5} />
              )}
              <span>{outOfStockCount > 0 ? "Depleted" : "Zero Out"}</span>
            </Box>
          </Group>

          <Text size="xs" mt={10} c="dimmed">
            {outOfStockCount > 0
              ? "Immediate supplier restock required"
              : "No unfulfilled product demand"}
          </Text>
        </Box>
      </SimpleGrid>

      {/* ---- Expiring Batches Notice (if any) ---- */}
      {expiringBatches.length > 0 && (
        <Card
          withBorder
          radius="md"
          padding="lg"
          style={{ borderColor: INK.border }}
        >
          <Stack>
            <Group justify="space-between" wrap="wrap">
              <Group gap={8}>
                <CalendarClock size={18} color={INK.warning} />
                <Text fw={700} style={{ color: INK.text }}>
                  Expiring Stock
                </Text>
              </Group>
              <Text size="sm" c="dimmed">
                {expiringBatches.length}{" "}
                {expiringBatches.length === 1 ? "batch" : "batches"} expiring
                within 30 days
              </Text>
            </Group>
            <ScrollArea>
              <Table
                striped
                highlightOnHover
                withTableBorder
                verticalSpacing="xs"
                miw={720}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Product</Table.Th>
                    <Table.Th>Batch</Table.Th>
                    <Table.Th>Expiry Date</Table.Th>
                    <Table.Th ta="right">Qty</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Source</Table.Th>
                    <Table.Th ta="right">Action</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {expiringBatches.map((b) => (
                    <Table.Tr key={b.id}>
                      <Table.Td>
                        <Text size="sm" fw={600} style={{ color: INK.text }}>
                          {b.productName}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {b.productSku}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
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
                      <Table.Td>
                        <Badge
                          color={b.status === "expired" ? "red" : "yellow"}
                          variant="light"
                          radius="sm"
                        >
                          {b.status === "expired" ? "Expired" : "Expiring"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {b.source}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        {b.quantity > 0 && (
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
          </Stack>
        </Card>
      )}

      {/* ---- Toolbar (Directly from Pharmly Reference) ---- */}
      <Group justify="space-between" align="center" wrap="wrap" gap="md">
        {/* Left: Search & Dropdowns */}
        <Group gap="sm" wrap="wrap" style={{ flex: 1 }}>
          <TextInput
            placeholder="Search products by name, SKU, category..."
            leftSection={<Search size={16} color="#94a3b8" />}
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setPage(1);
            }}
            radius="pill"
            style={{ minWidth: 260, flex: 1, maxWidth: 360 }}
            styles={{
              input: {
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
                fontSize: 13,
              },
            }}
          />

          <Select
            placeholder="All Categories"
            data={[
              { value: "all", label: "All Categories" },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
            value={selectedCategory}
            onChange={(val) => {
              setSelectedCategory(val ?? "all");
              setPage(1);
            }}
            radius="pill"
            w={170}
            styles={{
              input: {
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
                fontSize: 13,
              },
            }}
          />

          <Select
            placeholder="All Stock Levels"
            data={[
              { value: "all", label: "All Stock Levels" },
              { value: "in_stock", label: "In Stock (≥10)" },
              { value: "low_stock", label: "Low Stock (<10)" },
              { value: "out_of_stock", label: "Out of Stock" },
            ]}
            value={selectedStatus}
            onChange={(val) => {
              setSelectedStatus(val ?? "all");
              setPage(1);
            }}
            radius="pill"
            w={160}
            styles={{
              input: {
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
                fontSize: 13,
              },
            }}
          />
        </Group>

        {/* Right: Actions */}
        <Group gap="sm">
          <Button
            variant="default"
            radius="pill"
            size="sm"
            leftSection={<Download size={14} />}
            onClick={() => exportProductsToCsv(filtered, categoryMap, supplierMap)}
            style={{
              borderColor: "var(--app-border)",
              background: "var(--app-surface)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Export CSV
          </Button>

          {canCreate && (
            <Button
              radius="pill"
              size="sm"
              onClick={openCreate}
              data-tour="add-product"
              leftSection={
                <Box
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: "#0c2722",
                    color: "#cbf849",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Plus size={13} strokeWidth={3} />
                </Box>
              }
              style={{
                backgroundColor: "#cbf849",
                color: "#0c2722",
                fontWeight: 700,
                fontSize: 13,
                paddingLeft: 12,
                paddingRight: 18,
                border: "none",
                boxShadow: "0 2px 10px rgba(203, 248, 73, 0.35)",
              }}
            >
              Add New Product
            </Button>
          )}
        </Group>
      </Group>

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

      {/* ---- Products Table Card (Pharmly Style) ---- */}
      <Box
        style={{
          background: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          borderRadius: 22,
          boxShadow: "0 4px 18px -4px rgba(18, 28, 56, 0.03)",
          overflow: "hidden",
        }}
      >
        {loading ? (
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
                  color: "#64748b",
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
                  <Table.Th>Product ID / SKU</Table.Th>
                  <Table.Th>Product Name</Table.Th>
                  <Table.Th>Category</Table.Th>
                  <Table.Th>Supplier</Table.Th>
                  <Table.Th ta="right">Cost Price</Table.Th>
                  <Table.Th ta="right">Selling Price</Table.Th>
                  <Table.Th ta="center">Stock Level</Table.Th>
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

                  return (
                    <Table.Tr key={prod.id}>
                      {/* SKU */}
                      <Table.Td>
                        <Text
                          size="xs"
                          fw={600}
                          style={{
                            ...LEDGER_NUM,
                            color: "var(--app-text-muted)",
                            background: "var(--app-soft)",
                            padding: "4px 8px",
                            borderRadius: 6,
                            display: "inline-block",
                          }}
                        >
                          #{prod.sku}
                        </Text>
                      </Table.Td>

                      {/* Name */}
                      <Table.Td>
                        <Stack gap={2}>
                          <Text fw={600} size="sm" style={{ color: "var(--app-text)" }}>
                            {prod.name}
                          </Text>
                          {prod.unit && (
                            <Text size="xs" c="dimmed">
                              Unit: {prod.unit}
                            </Text>
                          )}
                        </Stack>
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

                      {/* Cost Price */}
                      <Table.Td ta="right">
                        <Text size="sm" c="dimmed" style={LEDGER_NUM}>
                          Rs. {paisaToDisplay(prod.costPrice)}
                        </Text>
                      </Table.Td>

                      {/* Selling Price */}
                      <Table.Td ta="right">
                        <Text
                          size="sm"
                          fw={700}
                          style={{ ...LEDGER_NUM, color: INK.goldDeep }}
                        >
                          Rs. {paisaToDisplay(prod.sellPrice)}
                        </Text>
                      </Table.Td>

                      {/* Stock Status Pill Badge (Matching Pharmly) */}
                      <Table.Td ta="center">
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            background: inStock ? "#ecfdf5" : lowStock ? "#fffbeb" : "#fef2f2",
                            color: inStock ? "#047857" : lowStock ? "#b45309" : "#b91c1c",
                            padding: "4px 12px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: inStock ? "#10b981" : lowStock ? "#f59e0b" : "#ef4444",
                            }}
                          />
                          {inStock
                            ? `In Stock (${prod.quantityInStock})`
                            : lowStock
                            ? `Low Stock (${prod.quantityInStock})`
                            : "Out of Stock"}
                        </span>
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

                      {/* Actions */}
                      {(canEdit || canDelete) && (
                        <Table.Td ta="right">
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            {canEdit && (
                              <Tooltip label="Stock Movements" withArrow>
                                <ActionIcon
                                  variant="subtle"
                                  color="gray"
                                  size="sm"
                                  radius="md"
                                  onClick={() => openMovements(prod)}
                                >
                                  <History size={15} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {canEdit && (
                              <Tooltip label="Quick Adjust Stock" withArrow>
                                <ActionIcon
                                  variant="subtle"
                                  color="blue"
                                  size="sm"
                                  radius="md"
                                  onClick={() => openStock(prod)}
                                >
                                  <PackagePlus size={15} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {canEdit && prod.nextExpiryDate && (
                              <Tooltip label="Batches / expiry" withArrow>
                                <ActionIcon
                                  variant="subtle"
                                  color="orange"
                                  size="sm"
                                  radius="md"
                                  onClick={() => openBatches(prod)}
                                >
                                  <CalendarDays size={15} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {canEdit && (
                              <Tooltip label="Edit Product" withArrow>
                                <ActionIcon
                                  variant="subtle"
                                  color="indigo"
                                  size="sm"
                                  radius="md"
                                  onClick={() => openEdit(prod)}
                                >
                                  <Pencil size={15} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {canDelete && (
                              <Tooltip label="Delete Product" withArrow>
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  size="sm"
                                  radius="md"
                                  onClick={() => handleDeleteProduct(prod)}
                                >
                                  <Trash2 size={15} />
                                </ActionIcon>
                              </Tooltip>
                            )}
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

        {/* Pagination Footer (Matching Pharmly) */}
        {!loading && filtered.length > 0 && (
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

function StockAdjustModal({
  opened,
  onClose,
  onSave,
  product,
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
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 48em)");

  const form = useForm({
    initialValues: {
      movementType: "purchase",
      quantity: 1,
      referenceNote: "",
      expiryDate: "",
      batchNumber: "",
      expiryOnly: false,
    },
    validate: {
      quantity: (v, values) => {
        if (v === 0) {
          // Quantity 0 is only valid as an "expiry-only" manual adjustment:
          // attach the expiry date to the current stock without moving units.
          if (values.expiryOnly || values.expiryDate?.trim()) return null;
          return "Quantity cannot be zero";
        }
        if (v < 0 && values.movementType !== "adjustment")
          return "Quantity must be positive for this movement type";
        return null;
      },
      expiryDate: (v, values) => {
        if (values.expiryOnly && !v?.trim())
          return "Pick an expiry date to attach to the current stock";
        return null;
      },
    },
  });

  useEffect(() => {
    form.reset();
    setError(null);
  }, [product]);

  async function handleSubmit(values: typeof form.values) {
    setLoading(true);
    setError(null);
    try {
      // Convert quantity to negative for outgoing types.
      // "adjustment" passes through signed so the user can fix an
      // incorrectly-entered quantity in either direction without touching
      // sales or damage reporting. "Expiry only" forces quantity 0 so the
      // stock count never moves.
      let qty = values.expiryOnly ? 0 : values.quantity;
      if (!values.expiryOnly) {
        if (
          values.movementType === "sale" ||
          values.movementType === "damage"
        ) {
          qty = -Math.abs(qty);
        } else if (
          values.movementType === "purchase" ||
          values.movementType === "return"
        ) {
          qty = Math.abs(qty);
        }
      }

      await onSave({
        movementType: values.expiryOnly ? "adjustment" : values.movementType,
        quantity: qty,
        referenceNote: values.referenceNote,
        expiryDate: values.expiryDate || undefined,
        batchNumber: values.batchNumber?.trim() || undefined,
      });
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const movementTypes = [
    { value: "purchase", label: "Purchase (stock IN)" },
    { value: "return", label: "Customer Return (stock IN)" },
    { value: "adjustment", label: "Manual Adjustment" },
    { value: "sale", label: "Sale (stock OUT)" },
    { value: "damage", label: "Damage/Loss (stock OUT)" },
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <PackagePlus size={16} color={INK.gold} />
          <Text fw={700} style={{ color: INK.text }}>
            Adjust Stock: {product?.name ?? ""}
          </Text>
        </Group>
      }
      centered
      radius="md"
      fullScreen={isMobile}
      transitionProps={isMobile ? { transition: "slide-up" } : undefined}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Card
            padding="sm"
            radius="sm"
            style={{ background: INK.paper, border: `1px solid ${INK.border}` }}
          >
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Current stock
              </Text>
              <Text fw={700} style={{ ...LEDGER_NUM, color: INK.text }}>
                {product?.quantityInStock ?? 0} {product?.unit ?? "units"}
              </Text>
            </Group>
          </Card>

          <Switch
            label="Expiry only — don't change stock quantity"
            description="Attach an expiry date to the stock this product already has. Nothing is added or removed."
            checked={form.values.expiryOnly}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              form.setValues({
                expiryOnly: on,
                movementType: on ? "adjustment" : form.values.movementType,
                quantity: on ? 0 : form.values.quantity,
              });
            }}
          />

          <Select
            label="What kind of change is this?"
            data={movementTypes}
            required
            disabled={form.values.expiryOnly}
            {...form.getInputProps("movementType")}
          />

          <NumberInput
            label="How many units?"
            placeholder="Enter amount"
            min={form.values.movementType === "adjustment" ? undefined : 1}
            required
            disabled={form.values.expiryOnly}
            description={
              form.values.movementType === "adjustment" &&
              !form.values.expiryOnly
                ? "Positive adds stock, negative (e.g. -5) removes it. For expiry only, use the switch above."
                : form.values.expiryOnly
                  ? "Quantity is locked at 0 in expiry-only mode."
                  : undefined
            }
            {...form.getInputProps("quantity")}
          />

          {form.values.movementType === "adjustment" &&
            form.values.quantity !== 0 &&
            !form.values.expiryOnly &&
            product && (
              <Text size="sm" c="dimmed">
                Resulting stock:{" "}
                <Text component="span" fw={700} style={{ color: INK.text }}>
                  {(
                    product.quantityInStock + form.values.quantity
                  ).toLocaleString()}{" "}
                  {product.unit ?? "units"}
                </Text>
              </Text>
            )}

          {form.values.movementType === "adjustment" &&
            form.values.quantity === 0 &&
            form.values.expiryDate?.trim() &&
            product && (
              <Text size="sm" c="dimmed">
                Quantity stays{" "}
                <Text component="span" fw={700} style={{ color: INK.text }}>
                  {product.quantityInStock.toLocaleString()}{" "}
                  {product.unit ?? "units"}
                </Text>{" "}
                — the expiry date is attached to the stock that has no expiry
                yet.
              </Text>
            )}

          {(form.values.movementType === "purchase" ||
            form.values.movementType === "return" ||
            form.values.movementType === "adjustment") && (
            <>
              <AppDateInput
                label="Expiry date (optional)"
                description={
                  form.values.movementType === "adjustment"
                    ? "Pick a date to track this batch's expiry. With quantity 0 this attaches the date to the stock you already have."
                    : "Pick a date to track this batch's expiry. Leave blank if this stock doesn't expire."
                }
                placeholder="Select a date"
                size="sm"
                value={form.values.expiryDate}
                onChange={(value) => form.setFieldValue("expiryDate", value)}
              />
              <Text size="xs" c="dimmed">
                Once this product has any batch with an expiry date, sales and
                write-offs will automatically use up the stock that expires
                soonest first — so nothing gets left to expire unnecessarily.
              </Text>
              <TextInput
                label="Batch number (optional)"
                description="e.g. LOT-001 or 2026-A. Leave blank to auto-generate one (B-0001, B-0002, …)."
                placeholder="Batch number"
                size="sm"
                {...form.getInputProps("batchNumber")}
              />
            </>
          )}

          <TextInput
            label="Reference Note"
            placeholder="e.g. PO-001, Invoice #123"
            {...form.getInputProps("referenceNote")}
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

          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={loading}
              style={{ backgroundColor: INK.navy }}
            >
              Apply Adjustment
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
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
  const [movements, setMovements] = useState<PublicStockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 48em)");

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
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <History size={16} color={INK.gold} />
          <Text fw={700} style={{ color: INK.text }}>
            Stock History: {product?.name ?? ""}
          </Text>
        </Group>
      }
      size="lg"
      centered
      radius="md"
      fullScreen={isMobile}
      transitionProps={isMobile ? { transition: "slide-up" } : undefined}
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
    </Modal>
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
  const [batches, setBatches] = useState<PublicStockBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<PublicStockBatch | null>(
    null,
  );
  const isMobile = useMediaQuery("(max-width: 48em)");

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
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          <Group gap={8}>
            <CalendarDays size={16} color={INK.gold} />
            <Text fw={700} style={{ color: INK.text }}>
              Expiry Batches: {product?.name ?? ""}
            </Text>
          </Group>
        }
        size="lg"
        centered
        radius="md"
        fullScreen={isMobile}
        transitionProps={isMobile ? { transition: "slide-up" } : undefined}
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
      </Modal>

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
