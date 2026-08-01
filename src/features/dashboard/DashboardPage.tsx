// ==========================================
// DASHBOARD PAGE
// ==========================================
//
// The main screen after login. Shows:
//   - Company info card
//   - Current user role and permissions
//   - Quick-access cards for ERP modules
//   - User management (owner/admin only)
//   - Inventory management (all roles, Rust enforces real permissions)
//
// Because we have no React Router yet, module panels are shown
// using local state ("tabs"). When you add a real router later,
// each module gets its own URL instead.

import { useEffect, useState } from "react";

import {
  Avatar,
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Grid,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  PasswordInput,
  Select,
  Title,
  Tooltip,
  Switch,
  ScrollArea,
} from "@mantine/core";

import { useForm } from "@mantine/form";

import {
  getCompany,
  getErrorMessage,
  listCompanyUsers,
  createCompanyUser,
  updateCompanyUserRole,
  setCompanyUserActive,
} from "../../api/backend";

import InventoryPage from "../inventory/InventoryPage";
import InvoicePage from "../invoices/InvoicePage";

import type { PublicCompany, PublicUser, UserRole } from "../../types/backend";

// ==========================================
// PROPS
// ==========================================

interface DashboardPageProps {
  user: PublicUser;
  onLogout: () => Promise<void>;
}

// ==========================================
// WHAT EACH ROLE CAN SEE (frontend UX only — Rust enforces real security)
// ==========================================

const ROLE_CAPABILITIES: Record<UserRole, string[]> = {
  owner: [
    "Full company control",
    "Create administrators and employees",
    "Change user roles",
    "Activate / deactivate users",
    "Manage inventory and invoices",
  ],
  admin: [
    "Update company information",
    "Create and manage employees",
    "Manage inventory and invoices",
  ],
  employee: ["Access assigned ERP modules", "Cannot manage company users"],
};

const ROLE_COLORS: Record<UserRole, string> = {
  owner: "violet",
  admin: "blue",
  employee: "green",
};

// ==========================================
// DASHBOARD VIEWS (local "tabs" without a router)
// ==========================================

type DashboardView = "home" | "users" | "inventory" | "invoices";

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function DashboardPage({ user, onLogout }: DashboardPageProps) {
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [view, setView] = useState<DashboardView>("home");
  const [companyError, setCompanyError] = useState<string | null>(null);

  // Load company info on mount
  useEffect(() => {
    getCompany()
      .then(setCompany)
      .catch((err) => setCompanyError(getErrorMessage(err)));
  }, []);

  // Can this user see the "Company Users" management section?
  const canManageUsers = user.role === "owner" || user.role === "admin";

  return (
    <Container size="lg" py="xl">
      {/* ---- TOP BAR ---- */}
      <Group justify="space-between" mb="xl">
        <Stack gap={0}>
          <Title order={3}>{company ? company.name : "Ijaz & Company"}</Title>
          <Text size="sm" c="dimmed">
            {company?.currencyCode ?? "PKR"} — Desktop ERP
          </Text>
        </Stack>

        <Group>
          <Badge color={ROLE_COLORS[user.role]} variant="light" size="lg">
            {user.role.toUpperCase()}
          </Badge>
          <Avatar color="blue" radius="xl">
            {user.fullName.charAt(0).toUpperCase()}
          </Avatar>
          <Stack gap={0} align="flex-end">
            <Text size="sm" fw={500}>
              {user.fullName}
            </Text>
            <Text size="xs" c="dimmed">
              {user.email}
            </Text>
          </Stack>
          <Button variant="outline" color="red" onClick={onLogout}>
            Logout
          </Button>
        </Group>
      </Group>

      <Divider mb="xl" />

      {/* ---- VIEW SWITCHER ---- */}
      <Group mb="xl">
        <Button
          variant={view === "home" ? "filled" : "subtle"}
          onClick={() => setView("home")}
        >
          Dashboard
        </Button>
        <Button
          variant={view === "inventory" ? "filled" : "subtle"}
          onClick={() => setView("inventory")}
        >
          Inventory
        </Button>
        <Button
          variant={view === "invoices" ? "filled" : "subtle"}
          onClick={() => setView("invoices")}
        >
          Invoices
        </Button>
        {canManageUsers && (
          <Button
            variant={view === "users" ? "filled" : "subtle"}
            onClick={() => setView("users")}
          >
            Company Users
          </Button>
        )}
      </Group>

      {/* ---- HOME VIEW ---- */}
      {view === "home" && (
        <HomeView
          user={user}
          company={company}
          companyError={companyError}
          onNavigate={setView}
        />
      )}

      {/* ---- INVENTORY VIEW ---- */}
      {view === "inventory" && <InventoryPage user={user} />}

      {/* ---- INVOICES VIEW ---- */}
      {view === "invoices" && <InvoicePage user={user} />}

      {/* ---- USER MANAGEMENT VIEW ---- */}
      {view === "users" && canManageUsers && (
        <UserManagementView currentUser={user} />
      )}
    </Container>
  );
}

// ==========================================
// HOME VIEW — Company card + permissions + module cards
// ==========================================

function HomeView({
  user,
  company,
  companyError,
  onNavigate,
}: {
  user: PublicUser;
  company: PublicCompany | null;
  companyError: string | null;
  onNavigate: (view: DashboardView) => void;
}) {
  return (
    <Grid>
      {/* ---- COMPANY CARD ---- */}
      <Grid.Col span={6}>
        <Card withBorder padding="lg" radius="md" h="100%">
          <Title order={5} mb="md">
            Company Information
          </Title>
          {companyError && (
            <Text c="red" size="sm" mb="sm">
              {companyError}
            </Text>
          )}
          {company ? (
            <Stack gap="xs">
              <InfoRow label="Name" value={company.name} />
              <InfoRow label="Currency" value={company.currencyCode} />
              <InfoRow label="Email" value={company.email ?? "—"} />
              <InfoRow label="Phone" value={company.phone ?? "—"} />
              <InfoRow label="Address" value={company.address ?? "—"} />
              <InfoRow label="Tax Number" value={company.taxNumber ?? "—"} />
              <InfoRow label="Created" value={company.createdAt} />
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              Loading company details...
            </Text>
          )}
        </Card>
      </Grid.Col>

      {/* ---- PERMISSIONS CARD ---- */}
      <Grid.Col span={6}>
        <Card withBorder padding="lg" radius="md" h="100%">
          <Title order={5} mb="md">
            Your Permissions
          </Title>
          <Stack gap="xs">
            {ROLE_CAPABILITIES[user.role].map((cap) => (
              <Text key={cap} size="sm">
                • {cap}
              </Text>
            ))}
          </Stack>
        </Card>
      </Grid.Col>

      {/* ---- MODULE CARDS ---- */}
      <Grid.Col span={12}>
        <Title order={5} mb="md" mt="md">
          ERP Modules
        </Title>
        <SimpleGrid cols={3}>
          <ModuleCard
            title="Inventory"
            description="Manage products, stock, categories"
            color="teal"
            onClick={() => onNavigate("inventory")}
          />
          <ModuleCard
            title="Invoices"
            description="Create bills and track payments"
            color="orange"
          />
          {(user.role === "owner" || user.role === "admin") && (
            <ModuleCard
              title="Company Users"
              description="Manage admins and employees"
              color="blue"
              onClick={() => onNavigate("users")}
            />
          )}
        </SimpleGrid>
      </Grid.Col>
    </Grid>
  );
}

// ==========================================
// USER MANAGEMENT VIEW — Full CRUD table
// ==========================================

function UserManagementView({ currentUser }: { currentUser: PublicUser }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ---- Load users ----
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

  // ---- Create user handler ----
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

  // ---- Change role handler ----
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

  // ---- Toggle active handler ----
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

  // ---- Permission checks ----
  // Frontend hides buttons for UX. Rust still enforces the real rules.

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
    <Stack>
      <Group justify="space-between">
        <Title order={4}>Company Users</Title>
        <Button onClick={() => setCreateModalOpen(true)}>+ Add User</Button>
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {loading ? (
        <Text c="dimmed">Loading users...</Text>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td>
                    <Group gap="sm">
                      <Avatar size="sm" color="blue" radius="xl">
                        {u.fullName.charAt(0).toUpperCase()}
                      </Avatar>
                      <Text size="sm" fw={500}>
                        {u.fullName}
                      </Text>
                      {u.id === currentUser.id && (
                        <Badge size="xs" variant="light">
                          You
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{u.email}</Text>
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
                    <Text size="xs" c="dimmed">
                      {u.createdAt}
                    </Text>
                  </Table.Td>
                  <Table.Td>
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
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      {/* ---- CREATE USER MODAL ---- */}
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

  // Owner can create admin or employee; admin can only create employee
  const roleOptions =
    currentUser.role === "owner"
      ? [
          { value: "admin", label: "Administrator" },
          { value: "employee", label: "Employee" },
        ]
      : [{ value: "employee", label: "Employee" }];

  return (
    <Modal opened={opened} onClose={onClose} title="Add New User" centered>
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
// SMALL HELPER COMPONENTS
// ==========================================

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <Group>
      <Text size="sm" fw={500} w={100}>
        {label}
      </Text>
      <Text size="sm">{value}</Text>
    </Group>
  );
}

function ModuleCard({
  title,
  description,
  color,
  onClick,
}: {
  title: string;
  description: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <Card
      withBorder
      padding="lg"
      radius="md"
      style={{ cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}
    >
      <Stack gap="xs">
        <Badge color={color} variant="light" w="fit-content">
          Module
        </Badge>
        <Title order={5}>{title}</Title>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </Stack>
    </Card>
  );
}
