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
} from "@mantine/core";

import { useForm } from "@mantine/form";
import { UserPlus, Users } from "lucide-react";

import {
  listCompanyUsers,
  createCompanyUser,
  updateCompanyUserRole,
  setCompanyUserActive,
  getErrorMessage,
} from "../../api/backend";

import type { PublicUser } from "../../types/backend";
import { INK } from "../../theme";

const ROLE_COLORS: Record<string, string> = {
  owner: "gold",
  admin: "blue",
  employee: "teal",
};

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

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreateUser(values: {
    fullName: string;
    email: string;
    password: string;
    role: "admin" | "employee";
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
    newRole: "admin" | "employee",
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
                            ]}
                            value={u.role}
                            onChange={(value) => {
                              if (value)
                                handleChangeRole(
                                  u.id,
                                  value as "admin" | "employee",
                                );
                            }}
                            disabled={actionLoading === u.id}
                            w={130}
                          />
                        ) : (
                          <Badge color={ROLE_COLORS[u.role]} variant="light">
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

      <CreateUserModal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateUser}
        currentUser={currentUser}
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
}: {
  opened: boolean;
  onClose: () => void;
  onCreate: (values: {
    fullName: string;
    email: string;
    password: string;
    role: "admin" | "employee";
  }) => Promise<void>;
  currentUser: PublicUser;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      fullName: "",
      email: "",
      password: "",
      role: "employee" as "admin" | "employee",
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
