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
} from "lucide-react";

import {
  listCategories,
  createCategory,
  updateCategory,
  setCategoryActive,
  listSuppliers,
  createSupplier,
  updateSupplier,
  setSupplierActive,
  listProducts,
  createProduct,
  updateProduct,
  adjustStock,
  listStockMovements,
  getErrorMessage,
} from "../../api/backend";

import type {
  PublicCategory,
  PublicProduct,
  PublicStockMovement,
  PublicSupplier,
  PublicUser,
} from "../../types/backend";

import ImportWizard from "./ImportWizard";

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
      <Text fw={600} size="sm" mt={8} style={{ color: INK.navy }}>
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
    <Stack gap="lg" style={{ background: INK.paper, margin: -16, padding: 16 }}>
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Stack gap={2}>
          <Eyebrow>Inventory</Eyebrow>
          <Title order={2} style={{ color: INK.navy, letterSpacing: -0.3 }}>
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
        styles={{
          tab: {
            fontWeight: 600,
            "&[data-active]": {
              color: INK.navy,
              borderColor: INK.gold,
            },
          },
        }}
      >
        <Tabs.List>
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

  async function handleSave(values: { name: string; description: string }) {
    try {
      if (editingCategory) {
        await updateCategory({
          categoryId: editingCategory.id,
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
            w={260}
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
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
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
                      <Text fw={600} size="sm" style={{ color: INK.navy }}>
                        {cat.name}
                      </Text>
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
  onSave: (values: { name: string; description: string }) => Promise<void>;
  initial: PublicCategory | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
    },
    validate: {
      name: (v) => (v.trim().length < 1 ? "Name is required" : null),
    },
  });

  // Reset form when initial changes (open new modal)
  useEffect(() => {
    form.setValues({
      name: initial?.name ?? "",
      description: initial?.description ?? "",
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
          <Tags size={16} color={INK.gold} />
          <Text fw={700} style={{ color: INK.navy }}>
            {initial ? "Edit Category" : "New Category"}
          </Text>
        </Group>
      }
      centered
      radius="md"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Category Name"
            placeholder="e.g. Electronics, Stationery"
            required
            {...form.getInputProps("name")}
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
            w={260}
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
                      <Text fw={600} size="sm" style={{ color: INK.navy }}>
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
          <Text fw={700} style={{ color: INK.navy }}>
            {initial ? "Edit Supplier" : "New Supplier"}
          </Text>
        </Group>
      }
      size="lg"
      centered
      radius="md"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Supplier Name"
            placeholder="e.g. Ali Traders"
            required
            {...form.getInputProps("name")}
          />
          <SimpleGrid cols={2}>
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
          <SimpleGrid cols={2}>
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

  async function handleStockAdjust(values: {
    movementType: string;
    quantity: number;
    referenceNote: string;
  }) {
    if (!stockProduct) return;
    try {
      await adjustStock({
        productId: stockProduct.id,
        movementType: values.movementType,
        quantity: values.quantity,
        referenceNote: values.referenceNote,
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
              placeholder="Search by SKU, name, category or supplier..."
              leftSection={<Search size={15} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              w={320}
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
                          <Text fw={600} size="sm" style={{ color: INK.navy }}>
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
                              <Tooltip label="Stock history">
                                <ActionIcon
                                  variant="subtle"
                                  color="gray"
                                  onClick={() => openMovements(prod)}
                                >
                                  <History size={15} />
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
          : INK.navy;

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
            background: accent ? INK.goldSoft : "#EEF0F5",
            color: accent ? INK.gold : INK.navy,
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
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      sku: (v) => (v.trim().length < 1 ? "SKU is required" : null),
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

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <Package size={16} color={INK.gold} />
          <Text fw={700} style={{ color: INK.navy }}>
            {isEdit ? "Edit Product" : "New Product"}
          </Text>
        </Group>
      }
      size="lg"
      centered
      radius="md"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <SimpleGrid cols={2}>
            <TextInput
              label="SKU"
              placeholder="ELEC-001"
              required
              {...form.getInputProps("sku")}
            />
            <TextInput
              label="Product Name"
              placeholder="Wireless Mouse"
              required
              {...form.getInputProps("name")}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <Select
              label="Category"
              data={categoryOptions}
              {...form.getInputProps("categoryId")}
            />
            <Select
              label="Supplier"
              data={supplierOptions}
              {...form.getInputProps("supplierId")}
            />
          </SimpleGrid>

          <Divider label="Pricing" labelPosition="left" />

          <SimpleGrid cols={3}>
            <NumberInput
              label="Cost Price"
              placeholder="0.00"
              decimalScale={2}
              fixedDecimalScale
              thousandSeparator=","
              min={0}
              {...form.getInputProps("costPrice")}
            />
            <NumberInput
              label="Sell Price"
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

          <SimpleGrid cols={2}>
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
  }) => Promise<void>;
  product: PublicProduct | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      movementType: "purchase",
      quantity: 1,
      referenceNote: "",
    },
    validate: {
      quantity: (v) => (v === 0 ? "Quantity cannot be zero" : null),
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
      // Convert quantity to negative for outgoing types
      let qty = values.quantity;
      if (values.movementType === "sale" || values.movementType === "damage") {
        qty = -Math.abs(qty);
      } else {
        qty = Math.abs(qty);
      }

      await onSave({
        movementType: values.movementType,
        quantity: qty,
        referenceNote: values.referenceNote,
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
          <Text fw={700} style={{ color: INK.navy }}>
            Adjust Stock: {product?.name ?? ""}
          </Text>
        </Group>
      }
      centered
      radius="md"
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
              <Text fw={700} style={{ ...LEDGER_NUM, color: INK.navy }}>
                {product?.quantityInStock ?? 0} {product?.unit ?? "units"}
              </Text>
            </Group>
          </Card>

          <Select
            label="Movement Type"
            data={movementTypes}
            required
            {...form.getInputProps("movementType")}
          />

          <NumberInput
            label="Quantity"
            placeholder="Enter amount"
            min={1}
            required
            {...form.getInputProps("quantity")}
          />

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
          <Text fw={700} style={{ color: INK.navy }}>
            Stock History: {product?.name ?? ""}
          </Text>
        </Group>
      }
      size="lg"
      centered
      radius="md"
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
          <Table striped highlightOnHover withTableBorder verticalSpacing="sm">
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
