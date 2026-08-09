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

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
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
  Boxes,
  Package,
  PackagePlus,
  Tags,
  Truck,
  Plus,
  Pencil,
  History,
  Search,
  FileSpreadsheet,
  Wallet,
  AlertTriangle,
  Info,
  CalendarClock,
  CalendarDays,
  Trash2,
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
} from "../../api/backend";

import type {
  PublicCategory,
  PublicProduct,
  PublicStockBatch,
  PublicStockMovement,
  PublicSupplier,
  PublicUser,
} from "../../types/backend";

import ImportWizard from "./ImportWizard";

import {
  AppDateInput,
  parseDateOnly,
} from "../../components/AppDateInput";
import { INK } from "../../theme";

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

export default function InventoryPage({ user }: InventoryPageProps) {
  const canManage = user.role === "owner" || user.role === "admin";
  const [showWizard, setShowWizard] = useState(false);
  const [wizardKey, setWizardKey] = useState(0); // force re-mount on new import
  const isMobileHeader = useMediaQuery("(max-width: 36em)");

  // If wizard is open, show it instead of the tabs
  if (showWizard) {
    return (
      <ImportWizard
        key={wizardKey}
        user={user}
        onComplete={() => {
          setShowWizard(false);
          setWizardKey((k) => k + 1); // force fresh state next time
        }}
      />
    );
  }

  return (
    <Stack gap="lg">
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
        {canManage && (
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
            onClick={() => setShowWizard(true)}
          >
            Import from Excel / CSV
          </Button>
        )}
      </Group>

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

        <Tabs.Panel value="products" pt="md">
          <ProductsTab canManage={canManage} />
        </Tabs.Panel>

        <Tabs.Panel value="categories" pt="md">
          <CategoriesTab canManage={canManage} />
        </Tabs.Panel>

        <Tabs.Panel value="suppliers" pt="md">
          <SuppliersTab canManage={canManage} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

// ==========================================
// CATEGORIES TAB
// ==========================================

function CategoriesTab({ canManage }: { canManage: boolean }) {
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
            {canManage && (
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
                  {canManage && <Table.Th>Actions</Table.Th>}
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
                    {canManage && (
                      <Table.Td>
                        <Group gap="xs">
                          <Tooltip label="Edit">
                            <ActionIcon
                              variant="subtle"
                              color="dark"
                              onClick={() => openEdit(cat)}
                            >
                              <Pencil size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={() => handleDelete(cat)}
                            >
                              <Trash2 size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <Switch
                            checked={cat.isActive}
                            onChange={() => handleToggle(cat)}
                            size="sm"
                            color="green"
                          />
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

function SuppliersTab({ canManage }: { canManage: boolean }) {
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
            {canManage && (
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
                  {canManage && <Table.Th>Actions</Table.Th>}
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
                    {canManage && (
                      <Table.Td>
                        <Group gap="xs">
                          <Tooltip label="Edit">
                            <ActionIcon
                              variant="subtle"
                              color="dark"
                              onClick={() => openEdit(sup)}
                            >
                              <Pencil size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={() => handleDelete(sup)}
                            >
                              <Trash2 size={15} />
                            </ActionIcon>
                          </Tooltip>
                          <Switch
                            checked={sup.isActive}
                            onChange={() => handleToggle(sup)}
                            size="sm"
                            color="green"
                          />
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

function ProductsTab({ canManage }: { canManage: boolean }) {
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [suppliers, setSuppliers] = useState<PublicSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Modals
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PublicProduct | null>(
    null,
  );
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<PublicProduct | null>(null);
  const [movementsModalOpen, setMovementsModalOpen] = useState(false);
  const [movementsProduct, setMovementsProduct] =
    useState<PublicProduct | null>(null);
  const [expiringBatches, setExpiringBatches] = useState<PublicStockBatch[]>(
    [],
  );
  const [batchesModalOpen, setBatchesModalOpen] = useState(false);
  const [batchesProduct, setBatchesProduct] = useState<PublicProduct | null>(
    null,
  );
  const [writeOffTarget, setWriteOffTarget] = useState<PublicStockBatch | null>(
    null,
  );

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

  // Lookup maps for displaying names
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.categoryId &&
          (categoryMap.get(p.categoryId) ?? "").toLowerCase().includes(q)) ||
        (p.supplierId &&
          (supplierMap.get(p.supplierId) ?? "").toLowerCase().includes(q)),
    );
  }, [products, query, categoryMap, supplierMap]);

  function openCreate() {
    setEditingProduct(null);
    setProductModalOpen(true);
  }

  function openEdit(prod: PublicProduct) {
    setEditingProduct(prod);
    setProductModalOpen(true);
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
      // Convert display prices to paisa
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
      }
      setProductModalOpen(false);
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

  // Calculate totals
  const totalProducts = products.length;
  const totalStock = products.reduce((sum, p) => sum + p.quantityInStock, 0);
  const totalValue = products.reduce(
    (sum, p) => sum + p.sellPrice * p.quantityInStock,
    0,
  );
  const lowStockCount = products.filter(
    (p) => p.quantityInStock > 0 && p.quantityInStock < 10,
  ).length;
  const outOfStockCount = products.filter((p) => p.quantityInStock <= 0).length;

  return (
    <Stack>
      {/* ---- Summary cards ---- */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <StatCard
          icon={<Package size={18} />}
          label="Total Products"
          value={totalProducts.toLocaleString()}
        />
        <StatCard
          icon={<Boxes size={18} />}
          label="Total Stock Units"
          value={totalStock.toLocaleString()}
        />
        <StatCard
          icon={<Wallet size={18} />}
          label="Stock Value (at sell price)"
          value={(totalValue / 100).toLocaleString(undefined, {
            minimumFractionDigits: 2,
          })}
          accent
        />
        <StatCard
          icon={<AlertTriangle size={18} />}
          label="Needs Attention"
          value={`${lowStockCount + outOfStockCount}`}
          hint={
            outOfStockCount > 0
              ? `${outOfStockCount} out of stock`
              : lowStockCount > 0
                ? `${lowStockCount} running low`
                : "All stocked"
          }
          tone={
            outOfStockCount > 0
              ? "danger"
              : lowStockCount > 0
                ? "warning"
                : "success"
          }
        />
      </SimpleGrid>

      {/* ---- Expiry warning feed ---- */}
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
                        <Button
                          size="xs"
                          color="red"
                          variant="light"
                          leftSection={<Trash2 size={13} />}
                          onClick={() => setWriteOffTarget(b)}
                        >
                          Write off
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Stack>
        </Card>
      )}

      {/* ---- List card ---- */}
      <Card
        withBorder
        radius="md"
        padding="lg"
        style={{ borderColor: INK.border }}
      >
        <Stack>
          <Group justify="space-between" wrap="wrap">
            <TextInput
              placeholder="Search by name, SKU, category or supplier..."
              leftSection={<Search size={15} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              w={{ base: "100%", sm: 320 }}
            />
            <Group gap="sm">
              <Text size="sm" c="dimmed">
                {filtered.length} of {totalProducts} products
              </Text>
              {canManage && (
                <Button
                  size="sm"
                  leftSection={<Plus size={16} />}
                  style={{ backgroundColor: INK.navy }}
                  onClick={openCreate}
                >
                  Add Product
                </Button>
              )}
            </Group>
          </Group>

          {error && (
            <Alert
              color="red"
              variant="light"
              icon={<AlertTriangle size={16} />}
            >
              {error}
            </Alert>
          )}

          {/* ---- Products table ---- */}
          {loading ? (
            <Text c="dimmed" size="sm">
              Loading products…
            </Text>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Package size={20} />}
              title={totalProducts === 0 ? "No products yet" : "No matches"}
              description={
                totalProducts === 0
                  ? "Add your first product, or import a spreadsheet to bring in many at once."
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
                miw={1040}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>SKU</Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Category</Table.Th>
                    <Table.Th>Supplier</Table.Th>
                    <Table.Th ta="right">Cost</Table.Th>
                    <Table.Th ta="right">Sell</Table.Th>
                    <Table.Th ta="right">Stock</Table.Th>
                    <Table.Th>Unit</Table.Th>
                    <Table.Th>Expiry</Table.Th>
                    {canManage && <Table.Th>Actions</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filtered.map((prod) => {
                    const stockTone =
                      prod.quantityInStock <= 0
                        ? "red"
                        : prod.quantityInStock < 10
                          ? "yellow"
                          : "green";
                    return (
                      <Table.Tr key={prod.id}>
                        <Table.Td>
                          <Badge
                            variant="outline"
                            size="sm"
                            radius="sm"
                            color="dark"
                            style={LEDGER_NUM}
                          >
                            {prod.sku}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text fw={600} size="sm" style={{ color: INK.text }}>
                            {prod.name}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {prod.categoryId
                              ? (categoryMap.get(prod.categoryId) ?? "—")
                              : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {prod.supplierId
                              ? (supplierMap.get(prod.supplierId) ?? "—")
                              : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text size="sm" c="dimmed" style={LEDGER_NUM}>
                            {paisaToDisplay(prod.costPrice)}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text
                            size="sm"
                            fw={700}
                            style={{ ...LEDGER_NUM, color: INK.goldDeep }}
                          >
                            {paisaToDisplay(prod.sellPrice)}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Badge
                            color={stockTone}
                            variant="light"
                            radius="sm"
                            style={LEDGER_NUM}
                          >
                            {prod.quantityInStock}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{prod.unit}</Text>
                        </Table.Td>
                        <Table.Td>
                          {prod.nextExpiryDate ? (
                            <ExpiryBadge date={prod.nextExpiryDate} />
                          ) : (
                            <Text size="sm" c="dimmed">
                              —
                            </Text>
                          )}
                        </Table.Td>
                        {canManage && (
                          <Table.Td>
                            <Group gap="xs">
                              <Tooltip label="Edit product">
                                <ActionIcon
                                  variant="subtle"
                                  color="dark"
                                  onClick={() => openEdit(prod)}
                                >
                                  <Pencil size={15} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Adjust stock">
                                <ActionIcon
                                  variant="subtle"
                                  color="blue"
                                  onClick={() => openStock(prod)}
                                >
                                  <PackagePlus size={15} />
                                </ActionIcon>
                              </Tooltip>
                              {prod.nextExpiryDate && (
                                <Tooltip label="Batches / expiry">
                                  <ActionIcon
                                    variant="subtle"
                                    color="orange"
                                    onClick={() => openBatches(prod)}
                                  >
                                    <CalendarDays size={15} />
                                  </ActionIcon>
                                </Tooltip>
                              )}
                              <Tooltip label="Stock history">
                                <ActionIcon
                                  variant="subtle"
                                  color="gray"
                                  onClick={() => openMovements(prod)}
                                >
                                  <History size={15} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Delete product">
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  onClick={() => handleDeleteProduct(prod)}
                                >
                                  <Trash2 size={15} />
                                </ActionIcon>
                              </Tooltip>
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
        </Stack>
      </Card>

      {/* ---- Product Create/Edit Modal ---- */}
      <ProductModal
        opened={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        onSave={handleSaveProduct}
        initial={editingProduct}
        categories={categories}
        suppliers={suppliers}
        products={products}
      />

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

// ---- Stat card used in the products header ----

function StatCard({
  icon,
  label,
  value,
  hint,
  accent = false,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  tone?: "success" | "warning" | "danger";
}) {
  const toneColor =
    tone === "danger"
      ? INK.danger
      : tone === "warning"
        ? INK.warning
        : tone === "success"
          ? INK.success
          : INK.text;

  return (
    <Card
      withBorder
      radius="md"
      padding="md"
      style={{
        borderColor: INK.border,
        borderLeft: `3px solid ${accent ? INK.gold : toneColor}`,
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2}>
          <Text
            size="xs"
            c="dimmed"
            fw={600}
            tt="uppercase"
            style={{ letterSpacing: 0.5 }}
          >
            {label}
          </Text>
          <Text
            fw={800}
            size="xl"
            style={{
              ...LEDGER_NUM,
              color: accent ? INK.goldDeep : toneColor,
            }}
          >
            {value}
          </Text>
          {hint && (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          )}
        </Stack>
        <Box
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: accent ? INK.goldSoft : "var(--app-soft)",
            color: accent ? INK.gold : INK.text,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
      </Group>
    </Card>
  );
}

// ---- Product Create/Edit Modal ----

function ProductModal({
  opened,
  onClose,
  onSave,
  initial,
  categories,
  suppliers,
  products,
}: {
  opened: boolean;
  onClose: () => void;
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
  initial: PublicProduct | null;
  categories: PublicCategory[];
  suppliers: PublicSupplier[];
  products: PublicProduct[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useMediaQuery("(max-width: 48em)");

  const isEdit = initial !== null;

  const form = useForm({
    initialValues: {
      sku: initial?.sku ?? "",
      name: initial?.name ?? "",
      categoryId: initial?.categoryId ?? "",
      supplierId: initial?.supplierId ?? "",
      costPrice: initial ? parseFloat(paisaToDisplay(initial.costPrice)) : 0,
      sellPrice: initial ? parseFloat(paisaToDisplay(initial.sellPrice)) : 0,
      taxRate: initial ? initial.taxRate / 100 : 0,
      quantityInStock: initial?.quantityInStock ?? 0,
      unit: initial?.unit ?? "pcs",
    },
    validate: {
      name: (v) => (v.trim().length < 1 ? "Name is required" : null),
    },
  });

  useEffect(() => {
    form.setValues({
      sku: initial?.sku ?? "",
      name: initial?.name ?? "",
      categoryId: initial?.categoryId ?? "",
      supplierId: initial?.supplierId ?? "",
      costPrice: initial ? parseFloat(paisaToDisplay(initial.costPrice)) : 0,
      sellPrice: initial ? parseFloat(paisaToDisplay(initial.sellPrice)) : 0,
      taxRate: initial ? initial.taxRate / 100 : 0,
      quantityInStock: initial?.quantityInStock ?? 0,
      unit: initial?.unit ?? "pcs",
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

  const categoryOptions = [
    { value: "", label: "None" },
    ...categories
      .filter((c) => c.isActive)
      .map((c) => ({ value: c.id, label: c.name })),
  ];

  const supplierOptions = [
    { value: "", label: "None" },
    ...suppliers
      .filter((s) => s.isActive)
      .map((s) => ({ value: s.id, label: s.name })),
  ];

  const unitOptions = [
    "pcs",
    "kg",
    "g",
    "liters",
    "ml",
    "meters",
    "cm",
    "box",
    "pack",
    "dozen",
    "set",
  ];

  // Preview the SKU that will be auto-generated for the selected category.
  const selectedCategory = categories.find(
    (c) => c.id === form.values.categoryId,
  );
  const previewSku = useMemo(() => {
    if (isEdit) return null;
    if (form.values.sku.trim()) return null;
    const prefix = (selectedCategory?.skuPrefix ?? "").trim();
    if (!prefix) return null;
    const used = selectedCategory
      ? products.filter((p) => p.categoryId === selectedCategory.id)
      : [];
    const next = used.length + 1;
    return `${prefix}-${String(next).padStart(3, "0")}`;
  }, [
    isEdit,
    form.values.sku,
    form.values.categoryId,
    selectedCategory,
    products,
  ]);

  function handleNameChange(value: string) {
    form.setFieldValue("name", value);
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <Package size={16} color={INK.gold} />
          <Text fw={700} style={{ color: INK.text }}>
            {isEdit ? "Edit Product" : "New Product"}
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
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="SKU"
              placeholder={previewSku ?? "Auto-generated"}
              description={
                previewSku
                  ? `Next automatic SKU: ${previewSku}`
                  : "A short code that identifies this product. Leave blank to auto-generate one from the category."
              }
              {...form.getInputProps("sku")}
            />
            <TextInput
              label="Product Name"
              placeholder="Wireless Mouse"
              required
              {...form.getInputProps("name")}
              onChange={(e) => handleNameChange(e.currentTarget.value)}
            />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Category (optional)"
              data={categoryOptions}
              {...form.getInputProps("categoryId")}
            />
            <Select
              label="Supplier (optional)"
              data={supplierOptions}
              {...form.getInputProps("supplierId")}
            />
          </SimpleGrid>

          <Divider label="Pricing" labelPosition="left" />

          <SimpleGrid cols={{ base: 1, xs: 3 }}>
            <NumberInput
              label="Cost Price"
              description="What you pay to buy or make one unit"
              placeholder="0.00"
              decimalScale={2}
              fixedDecimalScale
              thousandSeparator=","
              min={0}
              {...form.getInputProps("costPrice")}
            />
            <NumberInput
              label="Sell Price"
              description="What the customer pays for one unit"
              placeholder="0.00"
              decimalScale={2}
              fixedDecimalScale
              thousandSeparator=","
              min={0}
              {...form.getInputProps("sellPrice")}
            />
            <NumberInput
              label="Tax Rate %"
              placeholder="17"
              decimalScale={2}
              fixedDecimalScale
              suffix="%"
              min={0}
              max={100}
              {...form.getInputProps("taxRate")}
            />
          </SimpleGrid>

          <Divider label="Stock" labelPosition="left" />

          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <NumberInput
              label={
                isEdit ? "Stock (use Adjust Stock to change)" : "Initial Stock"
              }
              placeholder="0"
              min={0}
              disabled={isEdit}
              {...form.getInputProps("quantityInStock")}
            />
            <Select
              label="Unit"
              data={unitOptions}
              {...form.getInputProps("unit")}
            />
          </SimpleGrid>

          {isEdit && (
            <Alert color="blue" variant="light" icon={<Info size={16} />}>
              To change stock quantity, close this and use the stock adjustment
              control on the product row.
            </Alert>
          )}

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
              {isEdit ? "Save Changes" : "Create Product"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
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

  useEffect(() => {
    if (opened && product) {
      setLoading(true);
      setError(null);
      listProductBatches(product.id)
        .then(setBatches)
        .catch((err) => setError(getErrorMessage(err)))
        .finally(() => setLoading(false));
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
  const [quantity, setQuantity] = useState<number>(1);
  const [reason, setReason] = useState("expiry write-off");
  const isMobile = useMediaQuery("(max-width: 48em)");

  useEffect(() => {
    if (batch) {
      setQuantity(batch.quantity);
      setError(null);
    }
  }, [batch]);

  async function handleWriteOff() {
    if (!batch) return;
    setLoading(true);
    setError(null);
    try {
      await writeOffBatch({
        batchId: batch.id,
        quantity,
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
                {batch.quantity} available
              </Text>
            </Group>
          </Card>
        )}

        <NumberInput
          label="Quantity to write off"
          min={1}
          max={batch?.quantity ?? 1}
          value={quantity}
          onChange={(v) => setQuantity(Number(v) || 1)}
          required
        />

        <TextInput
          label="Reason"
          placeholder="e.g. expired, damaged"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />

        <Text size="xs" c="dimmed">
          Writing off removes this quantity from both the batch and the
          product's stock on hand. It is recorded as an adjustment in stock
          history.
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
