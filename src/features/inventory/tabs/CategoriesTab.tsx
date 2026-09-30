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
  Tags,
  Trash2,
} from "lucide-react";
import {
  createCategory,
  deleteCategory,
  getErrorMessage,
  listCategories,
  setCategoryActive,
  updateCategory,
} from "../../../api/backend";
import { usePermissions } from "../../permissions/PermissionsProvider";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import type { PublicCategory } from "../../../types/backend";
import { EmptyState, formatDate, LEDGER_NUM } from "../utils/inventoryHelpers";

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
// CATEGORIES TAB
// ==========================================

export function CategoriesTab() {
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
  const [deleteTarget, setDeleteTarget] = useState<PublicCategory | null>(null);

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

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteCategory(deleteTarget.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeleteTarget(null);
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
    <>
      <ConfirmDialog
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Category"
        message={`Delete category "${deleteTarget?.name}"? Products in it are kept, just ungrouped.`}
        confirmLabel="Delete Category"
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
                                onClick={() => setDeleteTarget(cat)}
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
    </>
  );
}
