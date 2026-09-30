import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  AlertTriangle,
  ArrowLeft,
  Pencil,
  Plus,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
import {
  createSupplier,
  deleteSupplier,
  getErrorMessage,
  listSuppliers,
  setSupplierActive,
  updateSupplier,
} from "../../../api/backend";
import { usePermissions } from "../../permissions/PermissionsProvider";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import type { PublicSupplier } from "../../../types/backend";
import { EmptyState, LEDGER_NUM } from "../utils/inventoryHelpers";

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
// SUPPLIERS TAB
// ==========================================

export function SuppliersTab() {
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
  const [deleteTarget, setDeleteTarget] = useState<PublicSupplier | null>(null);

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

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteSupplier(deleteTarget.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeleteTarget(null);
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
    <>
      <ConfirmDialog
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Supplier"
        message={`Delete supplier "${deleteTarget?.name}"? Purchase history is kept.`}
        confirmLabel="Delete Supplier"
        danger
      />

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
                                onClick={() => setDeleteTarget(sup)}
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
    </>
  );
}
