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
//
// ---- Visual identity ----
// Shares the "ledger" identity used on the Inventory page: deep navy
// for structure and authority, a brass/gold accent reserved for the
// things that matter most (the hero banner, the primary CTA), and
// tabular monospace figures for anything numeric or dated. The shared
// tokens live in `src/theme.ts`.

import { useEffect, useMemo, useState } from "react";

import {
  Avatar,
  Badge,
  Box,
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
  Alert,
} from "@mantine/core";

import { useForm } from "@mantine/form";

import {
  Building2,
  LogOut,
  ShieldCheck,
  Boxes,
  Receipt,
  Users,
  CheckCircle2,
  ChevronRight,
  Search,
  UserPlus,
  AlertTriangle,
  Crown,
} from "lucide-react";

import {
  getCompany,
  getErrorMessage,
  listCompanyUsers,
  createCompanyUser,
  updateCompanyUserRole,
  setCompanyUserActive,
} from "../../api/backend";

import InventoryPage from "../inventory/InventoryPage";

import { INK } from "../../theme";

import type { PublicCompany, PublicUser, UserRole } from "../../types/backend";

// ==========================================
// SHARED DESIGN TOKENS — defined once in src/theme.ts
// ==========================================

const LEDGER_NUM: React.CSSProperties = {
  fontFamily:
    'ui-monospace, "SF Mono", "Roboto Mono", "JetBrains Mono", Menlo, monospace',
  fontVariantNumeric: "tabular-nums",
};

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

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  owner: <Crown size={13} />,
  admin: <ShieldCheck size={13} />,
  employee: <Users size={13} />,
};

// ==========================================
// DASHBOARD VIEWS (local "tabs" without a router)
// ==========================================

type DashboardView = "home" | "users" | "inventory";

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
    <Box style={{ background: INK.paper, minHeight: "100vh" }}>
      {/* Local styles for hover/focus states — kept scoped to this page */}
      <style>{`
        .dash-module-card {
          transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
        }
        .dash-module-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(31,43,71,0.10);
          border-color: ${INK.gold} !important;
        }
        .dash-module-card:focus-visible {
          outline: 2px solid ${INK.gold};
          outline-offset: 2px;
        }
        .dash-nav-btn:focus-visible {
          outline: 2px solid ${INK.gold};
          outline-offset: 2px;
        }
      `}</style>

      {/* ---- HERO BANNER ---- */}
      <Box
        style={{
          background: `linear-gradient(135deg, ${INK.navyDeep} 0%, ${INK.navy} 55%, ${INK.navySoft} 100%)`,
          borderBottom: `3px solid ${INK.gold}`,
        }}
      >
        <Container size="lg" py="lg">
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="md">
              <Box
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255,255,255,0.08)",
                  border: `1px solid ${INK.gold}`,
                  color: INK.gold,
                  flexShrink: 0,
                }}
              >
                <Building2 size={22} />
              </Box>
              <Stack gap={0}>
                <Text
                  size="xs"
                  fw={600}
                  style={{
                    color: INK.goldSoft,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  Welcome back, {user.fullName.split(" ")[0]}
                </Text>
                <Title
                  order={3}
                  style={{ color: "white", letterSpacing: -0.3 }}
                >
                  {company ? company.name : "Ijaz & Company"}
                </Title>
                <Text size="xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                  {company?.currencyCode ?? "PKR"} · Desktop ERP
                </Text>
              </Stack>
            </Group>

            <Group gap="md">
              <Badge
                leftSection={ROLE_ICONS[user.role]}
                color={ROLE_COLORS[user.role]}
                variant="filled"
                size="lg"
                radius="sm"
              >
                {user.role.toUpperCase()}
              </Badge>
              <Group gap="xs">
                <Avatar
                  color="dark"
                  radius="xl"
                  style={{ border: `2px solid ${INK.gold}` }}
                >
                  {user.fullName.charAt(0).toUpperCase()}
                </Avatar>
                <Stack gap={0}>
                  <Text size="sm" fw={600} style={{ color: "white" }}>
                    {user.fullName}
                  </Text>
                  <Text size="xs" style={{ color: "rgba(255,255,255,0.55)" }}>
                    {user.email}
                  </Text>
                </Stack>
              </Group>
              <Button
                variant="outline"
                color="gray.0"
                leftSection={<LogOut size={15} />}
                onClick={onLogout}
                styles={{
                  root: {
                    borderColor: "rgba(255,255,255,0.3)",
                    color: "white",
                    "&:hover": { backgroundColor: "rgba(255,255,255,0.08)" },
                  },
                }}
              >
                Logout
              </Button>
            </Group>
          </Group>
        </Container>
      </Box>

      <Container size="lg" py="xl">
        {/* ---- VIEW SWITCHER ---- */}
        <Group mb="xl" gap="xs">
          <NavButton
            active={view === "home"}
            onClick={() => setView("home")}
            icon={<Building2 size={15} />}
          >
            Dashboard
          </NavButton>
          <NavButton
            active={view === "inventory"}
            onClick={() => setView("inventory")}
            icon={<Boxes size={15} />}
          >
            Inventory
          </NavButton>
          {canManageUsers && (
            <NavButton
              active={view === "users"}
              onClick={() => setView("users")}
              icon={<Users size={15} />}
            >
              Company Users
            </NavButton>
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

        {/* ---- USER MANAGEMENT VIEW ---- */}
        {view === "users" && canManageUsers && (
          <UserManagementView currentUser={user} />
        )}
      </Container>
    </Box>
  );
}

// ---- Nav button used in the view switcher ----

function NavButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Button
      className="dash-nav-btn"
      leftSection={icon}
      variant={active ? "filled" : "subtle"}
      color="dark"
      onClick={onClick}
      styles={{
        root: active
          ? { backgroundColor: INK.navy }
          : { color: INK.navy, "&:hover": { backgroundColor: INK.goldSoft } },
      }}
    >
      {children}
    </Button>
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
    <Grid gap="lg">
      {/* ---- COMPANY CARD ---- */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card
          withBorder
          padding="lg"
          radius="md"
          h="100%"
          style={{ borderColor: INK.border }}
        >
          <Group gap={8} mb="md">
            <Building2 size={16} color={INK.gold} />
            <Eyebrow>Company Information</Eyebrow>
          </Group>
          {companyError && (
            <Alert
              color="red"
              variant="light"
              icon={<AlertTriangle size={16} />}
              mb="sm"
            >
              {companyError}
            </Alert>
          )}
          {company ? (
            <Stack gap={6}>
              <InfoRow label="Name" value={company.name} />
              <InfoRow label="Currency" value={company.currencyCode} mono />
              <InfoRow label="Email" value={company.email ?? "—"} />
              <InfoRow label="Phone" value={company.phone ?? "—"} mono />
              <InfoRow label="Address" value={company.address ?? "—"} />
              <InfoRow
                label="Tax Number"
                value={company.taxNumber ?? "—"}
                mono
              />
              <InfoRow label="Created" value={company.createdAt} mono />
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">
              Loading company details…
            </Text>
          )}
        </Card>
      </Grid.Col>

      {/* ---- PERMISSIONS CARD ---- */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card
          withBorder
          padding="lg"
          radius="md"
          h="100%"
          style={{ borderColor: INK.border }}
        >
          <Group gap={8} mb="md">
            <ShieldCheck size={16} color={INK.gold} />
            <Eyebrow>Your Permissions</Eyebrow>
          </Group>
          <Stack gap={8}>
            {ROLE_CAPABILITIES[user.role].map((cap) => (
              <Group key={cap} gap={8} wrap="nowrap" align="flex-start">
                <CheckCircle2
                  size={15}
                  color={INK.success}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <Text size="sm">{cap}</Text>
              </Group>
            ))}
          </Stack>
        </Card>
      </Grid.Col>

      {/* ---- MODULE CARDS ---- */}
      <Grid.Col span={12}>
        <Group gap={8} mt="md" mb="md">
          <Eyebrow>ERP Modules</Eyebrow>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <ModuleCard
            title="Inventory"
            description="Manage products, stock, categories and suppliers"
            icon={<Boxes size={20} />}
            onClick={() => onNavigate("inventory")}
          />
          <ModuleCard
            title="Invoices"
            description="Create bills and track payments"
            icon={<Receipt size={20} />}
            comingSoon
          />
          {(user.role === "owner" || user.role === "admin") && (
            <ModuleCard
              title="Company Users"
              description="Manage administrators and employees"
              icon={<Users size={20} />}
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
  const [query, setQuery] = useState("");

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    );
  }, [users, query]);

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
    <Card
      withBorder
      radius="md"
      padding="lg"
      style={{ borderColor: INK.border }}
    >
      <Stack>
        <Group justify="space-between" wrap="wrap">
          <Stack gap={0}>
            <Eyebrow>Company Users</Eyebrow>
            <Text size="xs" c="dimmed">
              Owners and admins manage who has access to this company.
            </Text>
          </Stack>
          <Button
            leftSection={<UserPlus size={16} />}
            style={{ backgroundColor: INK.navy }}
            onClick={() => setCreateModalOpen(true)}
          >
            Add User
          </Button>
        </Group>

        <TextInput
          placeholder="Search by name, email or role..."
          leftSection={<Search size={15} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          w={300}
        />

        {error && (
          <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Text c="dimmed" size="sm">
            Loading users…
          </Text>
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
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Role</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Created</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((u) => (
                  <Table.Tr key={u.id}>
                    <Table.Td>
                      <Group gap="sm">
                        <Avatar size="sm" color="dark" radius="xl">
                          {u.fullName.charAt(0).toUpperCase()}
                        </Avatar>
                        <Text size="sm" fw={600} style={{ color: INK.navy }}>
                          {u.fullName}
                        </Text>
                        {u.id === currentUser.id && (
                          <Badge size="xs" variant="light" color="gray">
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
                        <Badge
                          leftSection={ROLE_ICONS[u.role]}
                          color={ROLE_COLORS[u.role]}
                          variant="light"
                        >
                          {u.role}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={u.isActive ? "green" : "red"}
                        variant="light"
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" style={LEDGER_NUM}>
                        {u.createdAt}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {canToggleActive(u) && (
                        <Tooltip
                          label={u.isActive ? "Deactivate" : "Reactivate"}
                        >
                          <Switch
                            checked={u.isActive}
                            onChange={() =>
                              handleToggleActive(u.id, u.isActive)
                            }
                            disabled={actionLoading === u.id}
                            color="green"
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
      </Stack>

      {/* ---- CREATE USER MODAL ---- */}
      <CreateUserModal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateUser}
        currentUser={currentUser}
      />
    </Card>
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
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={8}>
          <UserPlus size={16} color={INK.gold} />
          <Text fw={700} style={{ color: INK.navy }}>
            Add New User
          </Text>
        </Group>
      }
      centered
      radius="md"
    >
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

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Group wrap="nowrap" align="flex-start">
      <Text size="sm" fw={600} w={100} c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="sm" style={mono ? LEDGER_NUM : undefined}>
        {value}
      </Text>
    </Group>
  );
}

function ModuleCard({
  title,
  description,
  icon,
  onClick,
  comingSoon = false,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick?: () => void;
  comingSoon?: boolean;
}) {
  const clickable = !!onClick && !comingSoon;
  return (
    <Card
      withBorder
      padding="lg"
      radius="md"
      className={clickable ? "dash-module-card" : undefined}
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? "button" : undefined}
      style={{
        cursor: clickable ? "pointer" : "default",
        borderColor: INK.border,
        opacity: comingSoon ? 0.7 : 1,
      }}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick?.();
            }
          : undefined
      }
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <Box
            style={{
              width: 38,
              height: 38,
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: INK.goldSoft,
              color: INK.gold,
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
          <Stack gap={2}>
            <Group gap={6}>
              <Text fw={700} size="sm" style={{ color: INK.navy }}>
                {title}
              </Text>
              {comingSoon && (
                <Badge size="xs" variant="light" color="gray">
                  Coming soon
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          </Stack>
        </Group>
        {clickable && (
          <ChevronRight
            size={16}
            color={INK.muted}
            style={{ flexShrink: 0, marginTop: 4 }}
          />
        )}
      </Group>
    </Card>
  );
}
