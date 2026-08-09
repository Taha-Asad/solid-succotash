// ==========================================
// USER MANAGEMENT VIEW — Full CRUD table
// ==========================================
// Owner/admin only. Rust enforces the real security rules.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import {
  Avatar,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  PasswordInput,
  Title,
  Tooltip,
  Checkbox,
  Divider,
} from "@mantine/core";

import { useForm } from "@mantine/form";
import { Shield, UserPlus, Users, Trash2, Plus } from "lucide-react";

import {
  listCompanyUsers,
  createCompanyUser,
  updateCompanyUserRole,
  setCompanyUserActive,
  listRoles,
  createCustomRole,
  updateRolePermissions,
  deleteCustomRole,
  getErrorMessage,
} from "../../api/backend";

import type { PublicUser, RoleInfo } from "../../types/backend";
import { INK } from "../../theme";

const ROLE_COLORS: Record<string, string> = {
  owner: "gold",
  admin: "blue",
  employee: "teal",
};

const MODULE_LABELS: Record<string, string> = {
  inventory: "Inventory",
  invoices: "Invoices",
  purchase_orders: "Purchase Orders",
  reports: "Reports",
  ledger: "Ledger",
  users: "Users",
  settings: "Settings",
};

const PERMISSION_LABELS: Record<string, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  finalize: "Finalize",
  export: "Export",
  post: "Post",
};

const PERMISSION_ORDER = [
  "view",
  "create",
  "edit",
  "finalize",
  "delete",
  "export",
  "post",
];

const MODULE_ORDER = [
  "inventory",
  "invoices",
  "purchase_orders",
  "reports",
  "ledger",
  "users",
  "settings",
];

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

export default function UserManagementView({
  currentUser,
}: {
  currentUser: PublicUser;
}) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await listCompanyUsers();
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadRoles() {
    setRolesLoading(true);
    try {
      const data = await listRoles();
      setRoles(data);
    } catch {
      // Roles are owner-only; non-owners see an empty state instead of an error.
    } finally {
      setRolesLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
    loadRoles();
  }, []);

  async function handleCreateUser(values: {
    fullName: string;
    email: string;
    password: string;
    role: string;
  }) {
    try {
      await createCompanyUser(values);
      setCreateModalOpen(false);
      await loadUsers();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  async function handleChangeRole(
    userId: string,
    newRole: string,
  ) {
    setActionLoading(userId);
    try {
      await updateCompanyUserRole({ userId, role: newRole });
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleToggleActive(userId: string, currentActive: boolean) {
    setActionLoading(userId);
    try {
      await setCompanyUserActive({ userId, active: !currentActive });
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActionLoading(null);
    }
  }

  function canChangeRole(targetUser: PublicUser): boolean {
    if (currentUser.role !== "owner") return false;
    if (targetUser.id === currentUser.id) return false;
    if (targetUser.role === "owner") return false;
    return true;
  }

  const customRoleNames = roles
    .filter((r) => r.isCustom)
    .map((r) => ({ value: r.role, label: r.role }));

  function canToggleActive(targetUser: PublicUser): boolean {
    if (targetUser.id === currentUser.id) return false;
    if (targetUser.role === "owner") return false;
    if (currentUser.role === "admin" && targetUser.role !== "employee")
      return false;
    return true;
  }

  return (
    <Stack gap="lg">
      <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
        <Card withBorder shadow="sm" p="lg">
          <Group justify="space-between" wrap="wrap">
            <Group gap="sm">
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: `${INK.chart.violet}18`,
                  color: INK.chart.violet,
                }}
              >
                <Users size={20} />
              </div>
              <Stack gap={0}>
                <Title order={3} style={{ color: INK.navy, letterSpacing: -0.3 }}>
                  Team Members
                </Title>
                <Text size="sm" c="dimmed">
                  Manage who can access your company workspace.
                </Text>
              </Stack>
            </Group>
            <Button
              leftSection={<UserPlus size={16} />}
              onClick={() => setCreateModalOpen(true)}
              styles={{
                root: {
                  background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
                  color: "#131C39",
                  fontWeight: 700,
                  "&:hover": { filter: "brightness(1.05)" },
                },
              }}
            >
              Add User
            </Button>
          </Group>
        </Card>
      </motion.div>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.08 }}>
        <Card withBorder shadow="sm" p="lg">
          {loading ? (
            <Text c="dimmed" size="sm" py="xl" ta="center">
              Loading team…
            </Text>
          ) : (
            <ScrollArea>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>Role</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Created</Table.Th>
                    <Table.Th ta="center">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {users.map((u, i) => (
                    <motion.tr
                      key={u.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.04 * i, duration: 0.3 }}
                    >
                      <Table.Td>
                        <Group gap="sm">
                          <Avatar color={ROLE_COLORS[u.role]} radius="xl" size="sm" style={{ fontWeight: 700 }}>
                            {u.fullName.charAt(0).toUpperCase()}
                          </Avatar>
                          <Text size="sm" fw={600} style={{ color: INK.navy }}>
                            {u.fullName}
                          </Text>
                          {u.id === currentUser.id && (
                            <Badge size="xs" color="gold" variant="light">
                              You
                            </Badge>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">{u.email}</Text>
                      </Table.Td>
                      <Table.Td>
                        {canChangeRole(u) ? (
                          <Select
                            size="xs"
                            data={[
                              { value: "admin", label: "Admin" },
                              { value: "employee", label: "Employee" },
                              ...customRoleNames,
                            ]}
                            value={u.role}
                            onChange={(value) => {
                              if (value) handleChangeRole(u.id, value);
                            }}
                            disabled={actionLoading === u.id}
                            w={130}
                          />
                        ) : (
                          <Badge color={ROLE_COLORS[u.role] ?? "gray"} variant="light">
                            {u.role}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={u.isActive ? "green" : "red"} variant="light">
                          {u.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">{u.createdAt}</Text>
                      </Table.Td>
                      <Table.Td ta="center">
                        {canToggleActive(u) && (
                          <Tooltip label={u.isActive ? "Deactivate" : "Reactivate"}>
                            <Switch
                              checked={u.isActive}
                              onChange={() => handleToggleActive(u.id, u.isActive)}
                              disabled={actionLoading === u.id}
                              color="red"
                              onLabel="ON"
                              offLabel="OFF"
                            />
                          </Tooltip>
                        )}
                      </Table.Td>
                    </motion.tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Card>
      </motion.div>

      <RolesPermissionsCard
        currentUser={currentUser}
        roles={roles}
        loading={rolesLoading}
        onChanged={() => {
          loadRoles();
          loadUsers();
        }}
        onCreateRole={() => setCreateRoleOpen(true)}
      />

      <CreateUserModal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateUser}
        currentUser={currentUser}
        customRoleNames={customRoleNames}
      />

      <CreateRoleModal
        opened={createRoleOpen}
        onClose={() => setCreateRoleOpen(false)}
        onCreated={() => {
          setCreateRoleOpen(false);
          loadRoles();
        }}
      />
    </Stack>
  );
}

// ==========================================
// CREATE USER MODAL
// ==========================================

function CreateUserModal({
  opened,
  onClose,
  onCreate,
  currentUser,
  customRoleNames,
}: {
  opened: boolean;
  onClose: () => void;
  onCreate: (values: {
    fullName: string;
    email: string;
    password: string;
    role: string;
  }) => Promise<void>;
  currentUser: PublicUser;
  customRoleNames: { value: string; label: string }[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      fullName: "",
      email: "",
      password: "",
      role: "employee",
    },
    validate: {
      fullName: (value) =>
        value.trim().length < 2 ? "Name must be at least 2 characters" : null,
      email: (value) =>
        /^\S+@\S+\.\S+$/.test(value) ? null : "Invalid email address",
      password: (value) =>
        value.length < 6 ? "Password must be at least 6 characters" : null,
    },
  });

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    try {
      await onCreate(values);
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const roleOptions =
    currentUser.role === "owner"
      ? [
          { value: "admin", label: "Administrator" },
          { value: "employee", label: "Employee" },
          ...customRoleNames,
        ]
      : [{ value: "employee", label: "Employee" }];

  return (
    <Modal opened={opened} onClose={onClose} title="Add New User" centered radius="lg">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Full Name"
            placeholder="John Doe"
            required
            {...form.getInputProps("fullName")}
          />

          <TextInput
            label="Email"
            placeholder="john@company.com"
            type="email"
            required
            {...form.getInputProps("email")}
          />

          <PasswordInput
            label="Password"
            placeholder="Minimum 6 characters"
            required
            {...form.getInputProps("password")}
          />

          <Select
            label="Role"
            data={roleOptions}
            required
            {...form.getInputProps("role")}
          />

          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create User
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ==========================================
// ROLES & PERMISSIONS CARD
// ==========================================

function RolesPermissionsCard({
  currentUser,
  roles,
  loading,
  onChanged,
  onCreateRole,
}: {
  currentUser: PublicUser;
  roles: RoleInfo[];
  loading: boolean;
  onChanged: () => void;
  onCreateRole: () => void;
}) {
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = roles.find((r) => r.role === selectedRole);

  useEffect(() => {
    if (selectedRole && roles.length > 0) {
      const next: Record<string, boolean> = {};
      for (const p of roles.find((r) => r.role === selectedRole)?.permissions ?? []) {
        next[`${p.module}:${p.permission}`] = p.allowed;
      }
      setMatrix(next);
    }
  }, [selectedRole, roles]);

  if (currentUser.role !== "owner") return null;

  async function handleSave() {
    if (!selectedRole) return;
    setSaving(true);
    setError(null);
    try {
      const current = roles.find((r) => r.role === selectedRole);
      const changed = (current?.permissions ?? [])
        .map((p) => ({ p, now: matrix[`${p.module}:${p.permission}`] ?? false }))
        .filter(({ p, now }) => now !== p.allowed)
        .map(({ p, now }) => ({ module: p.module, permission: p.permission, allowed: now }));
      if (changed.length > 0) {
        await updateRolePermissions(selectedRole, changed);
        onChanged();
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedRole) return;
    const role = roles.find((r) => r.role === selectedRole);
    if (!role?.isCustom) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteCustomRole(selectedRole);
      setSelectedRole(null);
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.12 }}>
      <Card withBorder shadow="sm" p="lg">
        <Group justify="space-between" wrap="wrap">
          <Group gap="sm">
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `${INK.chart.violet}18`,
                color: INK.chart.violet,
              }}
            >
              <Shield size={20} />
            </div>
            <Stack gap={0}>
              <Title order={3} style={{ color: INK.navy, letterSpacing: -0.3 }}>
                Roles & Permissions
              </Title>
              <Text size="sm" c="dimmed">
                Define what each role can see and do across the app.
              </Text>
            </Stack>
          </Group>
          <Button
            leftSection={<Plus size={16} />}
            onClick={onCreateRole}
            styles={{
              root: {
                background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
                color: "#131C39",
                fontWeight: 700,
                "&:hover": { filter: "brightness(1.05)" },
              },
            }}
          >
            Create Role
          </Button>
        </Group>

        <Divider my="lg" />

        {loading ? (
          <Text c="dimmed" size="sm" py="xl" ta="center">
            Loading roles…
          </Text>
        ) : (
          <>
            <Group wrap="wrap" gap="xs">
              {roles.map((r) => (
                <Button
                  key={r.role}
                  size="xs"
                  variant={selectedRole === r.role ? "filled" : "default"}
                  color={selectedRole === r.role ? INK.chart.violet : undefined}
                  onClick={() => setSelectedRole(r.role)}
                  rightSection={
                    r.isCustom ? (
                      <Badge size="xs" color="violet" variant="filled">
                        custom
                      </Badge>
                    ) : undefined
                  }
                >
                  {r.role}
                </Button>
              ))}
            </Group>

            {selected ? (
              <>
                <ScrollArea mt="lg" style={{ maxWidth: "100%" }}>
                  <Table verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={180}>Module</Table.Th>
                        {PERMISSION_ORDER.map((perm) => (
                          <Table.Th key={perm} ta="center">
                            {PERMISSION_LABELS[perm] ?? perm}
                          </Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {MODULE_ORDER.map((module) => {
                        const perms =
                          selected.permissions.filter((p) => p.module === module);
                        if (perms.length === 0) return null;
                        return (
                          <Table.Tr key={module}>
                            <Table.Td>
                              <Text size="sm" fw={600} style={{ color: INK.navy }}>
                                {MODULE_LABELS[module] ?? module}
                              </Text>
                            </Table.Td>
                            {PERMISSION_ORDER.map((perm) => {
                              const entry = perms.find((p) => p.permission === perm);
                              if (!entry) {
                                return (
                                  <Table.Td key={perm} ta="center">
                                    <Text size="xs" c="dimmed">
                                      —
                                    </Text>
                                  </Table.Td>
                                );
                              }
                              return (
                                <Table.Td key={perm} ta="center">
                                  <Checkbox
                                    checked={matrix[`${module}:${perm}`] ?? false}
                                    onChange={(event) =>
                                      setMatrix((prev) => ({
                                        ...prev,
                                        [`${module}:${perm}`]: event.currentTarget.checked,
                                      }))
                                    }
                                    color={INK.chart.violet}
                                  />
                                </Table.Td>
                              );
                            })}
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>

                <Group mt="lg" justify="space-between" wrap="wrap">
                  <Text size="xs" c="dimmed">
                    {selected.description || "No description."}
                  </Text>
                  <Group gap="sm">
                    {selected.isCustom && (
                      <Button
                        variant="subtle"
                        color="red"
                        leftSection={<Trash2 size={16} />}
                        loading={deleting}
                        onClick={handleDelete}
                      >
                        Delete Role
                      </Button>
                    )}
                    <Button onClick={handleSave} loading={saving}>
                      Save Permissions
                    </Button>
                  </Group>
                </Group>
              </>
            ) : (
              <Text c="dimmed" size="sm" py="xl" ta="center">
                Select a role to edit its permissions.
              </Text>
            )}

            {error && (
              <Text c="red" size="sm" mt="sm">
                {error}
              </Text>
            )}
          </>
        )}
      </Card>
    </motion.div>
  );
}

// ==========================================
// CREATE ROLE MODAL
// ==========================================

function CreateRoleModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: { name: "", description: "" },
    validate: {
      name: (value) =>
        value.trim().length < 2 ? "Role name must be at least 2 characters" : null,
    },
  });

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    try {
      await createCustomRole(values.name.trim(), values.description.trim() || undefined);
      form.reset();
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Create Custom Role" centered radius="lg">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label="Role Name"
            placeholder="e.g. Warehouse Manager"
            required
            {...form.getInputProps("name")}
          />
          <TextInput
            label="Description"
            placeholder="What is this role for?"
            {...form.getInputProps("description")}
          />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create Role
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
