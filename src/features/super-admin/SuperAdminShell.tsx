import { useEffect, useState, useMemo } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Drawer,
  Grid,
  Group,
  Modal,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  Activity,
  Building2,
  CreditCard,
  Eye,
  Layers,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Users,
  Wallet,
} from "lucide-react";

import {
  adminCreateCompany,
  adminGetCompanyDetails,
  adminGetSystemAnalytics,
  adminListCompanies,
  adminListPackages,
  adminToggleFeatureFlag,
  adminUpdateCompanyPackage,
  adminUpdateCompanyStatus,
  adminBootstrapSuperAdmin,
  type AdminCompanyDetail,
  type AdminCompanySummary,
  type PackageRecord,
  type SystemAnalytics,
} from "../../api/superAdmin";
import { getErrorMessage } from "../../api/backend";
import { CorbelSquircle } from "../../components/CorbelLogo";
import type { PublicUser } from "../../types/backend";

interface SuperAdminShellProps {
  user: PublicUser;
  onLogout: () => Promise<void>;
}

export default function SuperAdminShell({ user, onLogout }: SuperAdminShellProps) {
  const [activeTab, setActiveTab] = useState<string | null>("overview");
  const [analytics, setAnalytics] = useState<SystemAnalytics | null>(null);
  const [companies, setCompanies] = useState<AdminCompanySummary[]>([]);
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Selected company detail drawer
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [companyDetail, setCompanyDetail] = useState<AdminCompanyDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);

  // Provision Tenant Modal
  const [provisionOpened, { open: openProvision, close: closeProvision }] = useDisclosure(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyEmail, setNewCompanyEmail] = useState("");
  const [newCompanyPhone, setNewCompanyPhone] = useState("");
  const [newAdminName, setNewAdminName] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [newPackageId, setNewPackageId] = useState("pkg-standard");

  // Create Super Admin Modal
  const [adminModalOpened, { open: openAdminModal, close: closeAdminModal }] = useDisclosure(false);
  const [adminCreating, setAdminCreating] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);
  const [newSaName, setNewSaName] = useState("");
  const [newSaEmail, setNewSaEmail] = useState("");
  const [newSaPassword, setNewSaPassword] = useState("");

  const refreshData = async () => {
    setLoading(true);
    try {
      const [an, comps, pkgs] = await Promise.all([
        adminGetSystemAnalytics(),
        adminListCompanies(),
        adminListPackages(),
      ]);
      setAnalytics(an);
      setCompanies(comps);
      setPackages(pkgs);
    } catch (err) {
      console.error("Failed to load admin data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshData();
  }, []);

  const handleInspectCompany = async (companyId: string) => {
    setSelectedCompanyId(companyId);
    setLoadingDetail(true);
    openDrawer();
    try {
      const detail = await adminGetCompanyDetails(companyId);
      setCompanyDetail(detail);
    } catch (err) {
      console.error("Failed to fetch company details:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleToggleStatus = async (companyId: string, currentActive: boolean) => {
    try {
      await adminUpdateCompanyStatus(companyId, !currentActive);
      setCompanies((prev) =>
        prev.map((c) => (c.id === companyId ? { ...c, isActive: !currentActive } : c))
      );
      if (companyDetail && companyDetail.company.id === companyId) {
        setCompanyDetail({
          ...companyDetail,
          company: { ...companyDetail.company, isActive: !currentActive },
        });
      }
    } catch (err) {
      alert(`Error toggling status: ${getErrorMessage(err)}`);
    }
  };

  const handleChangePackage = async (packageId: string) => {
    if (!selectedCompanyId) return;
    try {
      await adminUpdateCompanyPackage(selectedCompanyId, packageId);
      const updated = await adminGetCompanyDetails(selectedCompanyId);
      setCompanyDetail(updated);
      setCompanies((prev) =>
        prev.map((c) =>
          c.id === selectedCompanyId
            ? { ...c, packageId, packageName: packages.find((p) => p.id === packageId)?.name ?? packageId }
            : c
        )
      );
    } catch (err) {
      alert(`Error updating package: ${getErrorMessage(err)}`);
    }
  };

  const handleToggleFeature = async (featureKey: string, currentEnabled: boolean) => {
    if (!selectedCompanyId) return;
    try {
      await adminToggleFeatureFlag(selectedCompanyId, featureKey, !currentEnabled);
      const updated = await adminGetCompanyDetails(selectedCompanyId);
      setCompanyDetail(updated);
    } catch (err) {
      alert(`Error updating feature flag: ${getErrorMessage(err)}`);
    }
  };

  const handleProvisionTenant = async () => {
    setProvisioning(true);
    setProvisionError(null);
    try {
      await adminCreateCompany({
        companyName: newCompanyName,
        email: newCompanyEmail || undefined,
        phone: newCompanyPhone || undefined,
        adminName: newAdminName,
        adminEmail: newAdminEmail,
        adminPassword: newAdminPassword,
        packageId: newPackageId,
      });
      closeProvision();
      setNewCompanyName("");
      setNewCompanyEmail("");
      setNewCompanyPhone("");
      setNewAdminName("");
      setNewAdminEmail("");
      setNewAdminPassword("");
      await refreshData();
    } catch (err) {
      setProvisionError(getErrorMessage(err));
    } finally {
      setProvisioning(false);
    }
  };

  const handleCreateSuperAdmin = async () => {
    setAdminCreating(true);
    setAdminError(null);
    setAdminSuccess(null);
    try {
      await adminBootstrapSuperAdmin(newSaEmail, newSaPassword, newSaName);
      setAdminSuccess(`Super Admin ${newSaEmail} successfully registered.`);
      setNewSaName("");
      setNewSaEmail("");
      setNewSaPassword("");
    } catch (err) {
      setAdminError(getErrorMessage(err));
    } finally {
      setAdminCreating(false);
    }
  };

  const filteredCompanies = useMemo(() => {
    return companies.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.email && c.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.phone && c.phone.includes(searchQuery));
      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "active"
          ? c.isActive
          : !c.isActive;
      return matchesSearch && matchesStatus;
    });
  }, [companies, searchQuery, statusFilter]);

  const formatPKR = (paisas: number) => {
    const rupees = paisas / 100;
    return `PKR ${rupees.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
  };

  return (
    <Box
      style={{
        minHeight: "100vh",
        background: "#070B19",
        color: "#F8FAFC",
        fontFamily: "'Outfit', sans-serif",
      }}
    >
      {/* Top Header */}
      <Box
        style={{
          borderBottom: "1px solid rgba(201, 149, 42, 0.2)",
          background: "#0E1528",
          padding: "16px 32px",
        }}
      >
        <Group justify="space-between" align="center">
          <Group gap="md">
            <CorbelSquircle size={38} variant="gold" />
            <Stack gap={0}>
              <Group gap="xs">
                <Text fw={700} size="lg" style={{ letterSpacing: 0.5, color: "#F8FAFC" }}>
                  CORBEL
                </Text>
                <Badge
                  color="yellow"
                  variant="filled"
                  size="sm"
                  style={{
                    background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
                    color: "#070B19",
                    fontWeight: 700,
                  }}
                >
                  SUPER ADMIN
                </Badge>
                <Badge size="xs" color={loading ? "yellow" : "teal"} variant="light">
                  {loading ? "Syncing..." : "Live Telemetry"}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                Multi-Tenant SaaS Operations & Governance Command Center
              </Text>
            </Stack>
          </Group>

          <Group gap="sm">
            <Button
              leftSection={<Plus size={16} />}
              onClick={openProvision}
              variant="gradient"
              gradient={{ from: "#C9952A", to: "#E6C965", deg: 135 }}
              style={{ color: "#070B19", fontWeight: 600 }}
            >
              Provision Tenant
            </Button>
            <Button
              leftSection={<Shield size={16} />}
              onClick={openAdminModal}
              variant="outline"
              color="yellow"
              style={{ borderColor: "rgba(201, 149, 42, 0.4)" }}
            >
              Add Super Admin
            </Button>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={() => void refreshData()}
              title="Refresh Analytics"
            >
              <RefreshCw size={18} />
            </ActionIcon>
            <Box style={{ textAlign: "right" }} mr="xs">
              <Text size="xs" fw={600} style={{ color: "#F8FAFC" }}>
                {user.fullName || user.email}
              </Text>
              <Text size="xs" c="dimmed">
                {user.email}
              </Text>
            </Box>
            <Button
              leftSection={<LogOut size={16} />}
              onClick={() => void onLogout()}
              variant="subtle"
              color="red"
            >
              Logout
            </Button>
          </Group>
        </Group>
      </Box>

      {/* Main Body */}
      <Container size="xl" py="xl">
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          color="yellow"
          styles={{
            tab: {
              color: "#94A3B8",
              fontWeight: 600,
              fontSize: 14,
              padding: "12px 20px",
              "&[data-active]": {
                color: "#E6C965",
                borderColor: "#C9952A",
              },
            },
          }}
        >
          <Tabs.List mb="xl">
            <Tabs.Tab value="overview" leftSection={<Activity size={16} />}>
              System Overview
            </Tabs.Tab>
            <Tabs.Tab value="tenants" leftSection={<Building2 size={16} />}>
              Tenants Directory ({companies.length})
            </Tabs.Tab>
            <Tabs.Tab value="packages" leftSection={<CreditCard size={16} />}>
              Subscription Tiers
            </Tabs.Tab>
          </Tabs.List>

          {/* TAB 1: SYSTEM OVERVIEW */}
          <Tabs.Panel value="overview">
            <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="lg" mb="xl">
              <Card
                padding="lg"
                style={{
                  background: "#0E1528",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 12,
                }}
              >
                <Group justify="space-between">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Active Tenants
                  </Text>
                  <ThemeIcon color="green" variant="light" size="md">
                    <Building2 size={16} />
                  </ThemeIcon>
                </Group>
                <Text fw={700} size="28px" mt="sm">
                  {analytics?.activeCompanies ?? 0}
                  <Text span size="sm" c="dimmed" fw={400} ml={6}>
                    / {analytics?.totalCompanies ?? 0} total
                  </Text>
                </Text>
              </Card>

              <Card
                padding="lg"
                style={{
                  background: "#0E1528",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 12,
                }}
              >
                <Group justify="space-between">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Active Users
                  </Text>
                  <ThemeIcon color="blue" variant="light" size="md">
                    <Users size={16} />
                  </ThemeIcon>
                </Group>
                <Text fw={700} size="28px" mt="sm">
                  {analytics?.totalUsers ?? 0}
                </Text>
              </Card>

              <Card
                padding="lg"
                style={{
                  background: "#0E1528",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 12,
                }}
              >
                <Group justify="space-between">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Invoices Processed
                  </Text>
                  <ThemeIcon color="yellow" variant="light" size="md">
                    <Layers size={16} />
                  </ThemeIcon>
                </Group>
                <Text fw={700} size="28px" mt="sm">
                  {analytics?.totalInvoices ?? 0}
                </Text>
              </Card>

              <Card
                padding="lg"
                style={{
                  background: "#0E1528",
                  border: "1px solid rgba(201, 149, 42, 0.3)",
                  borderRadius: 12,
                }}
              >
                <Group justify="space-between">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Platform GMV
                  </Text>
                  <ThemeIcon color="yellow" variant="filled" size="md" style={{ background: "#C9952A" }}>
                    <Wallet size={16} color="#070B19" />
                  </ThemeIcon>
                </Group>
                <Text fw={700} size="22px" mt="sm" style={{ color: "#E6C965" }}>
                  {formatPKR(analytics?.totalVolumePaisas ?? 0)}
                </Text>
              </Card>
            </SimpleGrid>

            {/* Package Distribution & Activity Stream */}
            <Grid>
              <Grid.Col span={{ base: 12, md: 5 }}>
                <Card
                  padding="lg"
                  style={{
                    background: "#0E1528",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 12,
                    height: "100%",
                  }}
                >
                  <Title order={5} mb="md">
                    Subscription Distribution
                  </Title>
                  <Stack gap="sm">
                    {analytics?.packageDistribution.map((p) => (
                      <Group
                        key={p.packageId}
                        justify="space-between"
                        p="sm"
                        style={{
                          background: "rgba(255, 255, 255, 0.03)",
                          borderRadius: 8,
                        }}
                      >
                        <Group gap="xs">
                          <CreditCard size={16} color="#C9952A" />
                          <Text fw={600} size="sm">
                            {p.packageName}
                          </Text>
                        </Group>
                        <Badge variant="light" color="yellow">
                          {p.tenantCount} tenants
                        </Badge>
                      </Group>
                    ))}
                  </Stack>
                </Card>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 7 }}>
                <Card
                  padding="lg"
                  style={{
                    background: "#0E1528",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 12,
                    height: "100%",
                  }}
                >
                  <Title order={5} mb="md">
                    Recent Global Audit Stream
                  </Title>
                  <Stack gap="xs">
                    {analytics?.recentActivities.map((act) => (
                      <Group
                        key={act.id}
                        justify="space-between"
                        p="xs"
                        style={{
                          borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                        }}
                      >
                        <Stack gap={2}>
                          <Text size="xs" fw={600} c="#E2E8F0">
                            {act.action.toUpperCase()} • {act.entityType}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {act.details ?? "No details"}
                          </Text>
                        </Stack>
                        <Text size="xs" c="dimmed">
                          {new Date(act.createdAt).toLocaleTimeString()}
                        </Text>
                      </Group>
                    ))}
                    {(!analytics?.recentActivities || analytics.recentActivities.length === 0) && (
                      <Text size="sm" c="dimmed" ta="center" py="xl">
                        No recent activity recorded.
                      </Text>
                    )}
                  </Stack>
                </Card>
              </Grid.Col>
            </Grid>
          </Tabs.Panel>

          {/* TAB 2: TENANTS DIRECTORY */}
          <Tabs.Panel value="tenants">
            <Card
              padding="lg"
              style={{
                background: "#0E1528",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 12,
              }}
            >
              <Group justify="space-between" mb="lg">
                <Group gap="md">
                  <TextInput
                    placeholder="Search company name, email, phone..."
                    leftSection={<Search size={16} />}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.currentTarget.value)}
                    w={320}
                  />
                  <Select
                    data={[
                      { value: "all", label: "All Statuses" },
                      { value: "active", label: "Active Only" },
                      { value: "suspended", label: "Suspended Only" },
                    ]}
                    value={statusFilter}
                    onChange={(val) => setStatusFilter(val || "all")}
                    w={160}
                  />
                </Group>
                <Text size="xs" c="dimmed">
                  Showing {filteredCompanies.length} of {companies.length} tenants
                </Text>
              </Group>

              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)" }}>
                    <Table.Th style={{ color: "#94A3B8" }}>Company</Table.Th>
                    <Table.Th style={{ color: "#94A3B8" }}>Plan</Table.Th>
                    <Table.Th style={{ color: "#94A3B8" }}>Users</Table.Th>
                    <Table.Th style={{ color: "#94A3B8" }}>Invoices</Table.Th>
                    <Table.Th style={{ color: "#94A3B8" }}>Volume</Table.Th>
                    <Table.Th style={{ color: "#94A3B8" }}>Status</Table.Th>
                    <Table.Th style={{ color: "#94A3B8" }} ta="right">
                      Actions
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredCompanies.map((c) => (
                    <Table.Tr
                      key={c.id}
                      style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.04)" }}
                    >
                      <Table.Td>
                        <Stack gap={2}>
                          <Text fw={600} size="sm" c="#F8FAFC">
                            {c.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {c.email || c.phone || "No contact info"}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Badge variant="outline" color="yellow" size="sm">
                          {c.packageName || "Basic"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{c.userCount}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{c.invoiceCount}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={600} c="#E6C965">
                          {formatPKR(c.totalRevenue)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={c.isActive ? "green" : "red"} variant="light" size="sm">
                          {c.isActive ? "Active" : "Suspended"}
                        </Badge>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Group justify="flex-end" gap="xs">
                          <Button
                            size="xs"
                            variant="subtle"
                            color="yellow"
                            leftSection={<Eye size={14} />}
                            onClick={() => void handleInspectCompany(c.id)}
                          >
                            Manage
                          </Button>
                          <Button
                            size="xs"
                            variant="subtle"
                            color={c.isActive ? "red" : "green"}
                            onClick={() => void handleToggleStatus(c.id, c.isActive)}
                          >
                            {c.isActive ? "Suspend" : "Activate"}
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {filteredCompanies.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={7} ta="center" py="xl">
                        <Text size="sm" c="dimmed">
                          No tenant companies found.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Card>
          </Tabs.Panel>

          {/* TAB 3: PACKAGES */}
          <Tabs.Panel value="packages">
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
              {packages.map((pkg) => (
                <Card
                  key={pkg.id}
                  padding="xl"
                  style={{
                    background: "#0E1528",
                    border:
                      pkg.id === "pkg-premium"
                        ? "1px solid rgba(201, 149, 42, 0.6)"
                        : "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: 16,
                  }}
                >
                  <Group justify="space-between" mb="xs">
                    <Title order={4} style={{ color: "#F8FAFC" }}>
                      {pkg.name}
                    </Title>
                    {pkg.id === "pkg-premium" && (
                      <Badge color="yellow" variant="filled">
                        POPULAR
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" mb="md">
                    {pkg.description}
                  </Text>
                  <Text fw={700} size="28px" mb="lg" style={{ color: "#E6C965" }}>
                    PKR {pkg.price.toLocaleString()}
                    <Text span size="xs" c="dimmed" fw={400} ml={4}>
                      / {pkg.billingCycle}
                    </Text>
                  </Text>

                  <Divider mb="md" color="rgba(255, 255, 255, 0.08)" />

                  <Stack gap="xs" mb="lg">
                    <Text size="xs" c="#E2E8F0">
                      • Max Users: <strong>{pkg.maxUsers}</strong>
                    </Text>
                    <Text size="xs" c="#E2E8F0">
                      • Max Outlets / Branches: <strong>{pkg.maxBranches}</strong>
                    </Text>
                    <Text size="xs" c="#E2E8F0">
                      • Max Storage: <strong>{pkg.maxStorageMb} MB</strong>
                    </Text>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          </Tabs.Panel>
        </Tabs>
      </Container>

      {/* INSPECT TENANT DRAWER */}
      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        position="right"
        size="lg"
        title={
          <Group gap="xs">
            <Building2 size={20} color="#C9952A" />
            <Text fw={700} size="md">
              Tenant Management: {companyDetail?.company.name}
            </Text>
          </Group>
        }
        styles={{
          header: { background: "#0E1528", color: "#F8FAFC" },
          content: { background: "#0E1528", color: "#F8FAFC" },
        }}
      >
        {loadingDetail && (
          <Text size="sm" c="dimmed" py="xl" ta="center">
            Loading tenant telemetry & database statistics...
          </Text>
        )}
        {!loadingDetail && companyDetail && (
          <Stack gap="lg" py="md">
            {/* Status & Package Banner */}
            <Card padding="md" style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: 10 }}>
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Current Subscription
                </Text>
                <Badge color={companyDetail.company.isActive ? "green" : "red"}>
                  {companyDetail.company.isActive ? "Active" : "Suspended"}
                </Badge>
              </Group>
              <Select
                label="Assigned Plan Tier"
                data={packages.map((p) => ({ value: p.id, label: `${p.name} (PKR ${p.price}/mo)` }))}
                value={companyDetail.subscription?.packageId ?? "pkg-basic"}
                onChange={(val) => val && void handleChangePackage(val)}
                mb="sm"
              />
            </Card>

            {/* Feature Flags */}
            <Card padding="md" style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: 10 }}>
              <Title order={6} mb="sm">
                Tenant Feature Flags
              </Title>
              <Stack gap="sm">
                {["ai_insights", "fbr", "data_import"].map((flagKey) => {
                  const flag = companyDetail.featureFlags.find((f) => f.featureKey === flagKey);
                  const isEnabled = flag?.isEnabled ?? false;
                  return (
                    <Group key={flagKey} justify="space-between">
                      <Text size="sm" tt="capitalize">
                        {flagKey.replace("_", " ")}
                      </Text>
                      <Switch
                        checked={isEnabled}
                        onChange={() => void handleToggleFeature(flagKey, isEnabled)}
                        color="teal"
                      />
                    </Group>
                  );
                })}
              </Stack>
            </Card>

            {/* Tenant Users */}
            <Card padding="md" style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: 10 }}>
              <Title order={6} mb="sm">
                Registered Users ({companyDetail.users.length})
              </Title>
              <Stack gap="xs">
                {companyDetail.users.map((u) => (
                  <Group key={u.id} justify="space-between" p="xs" style={{ background: "rgba(255, 255, 255, 0.02)", borderRadius: 6 }}>
                    <Stack gap={2}>
                      <Text size="xs" fw={600}>
                        {u.fullName}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {u.email}
                      </Text>
                    </Stack>
                    <Badge size="xs" variant="outline">
                      {u.role}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            </Card>
          </Stack>
        )}
      </Drawer>

      {/* PROVISION TENANT MODAL */}
      <Modal
        opened={provisionOpened}
        onClose={closeProvision}
        title={
          <Group gap="xs">
            <Plus size={18} color="#C9952A" />
            <Text fw={700}>Provision New Tenant</Text>
          </Group>
        }
        styles={{
          header: { background: "#0E1528", color: "#F8FAFC" },
          content: { background: "#0E1528", color: "#F8FAFC" },
        }}
      >
        <Stack gap="md">
          {provisionError && (
            <Badge color="red" size="lg" fullWidth>
              {provisionError}
            </Badge>
          )}
          <TextInput
            label="Company Name"
            placeholder="e.g. Apex Traders"
            required
            value={newCompanyName}
            onChange={(e) => setNewCompanyName(e.currentTarget.value)}
          />
          <TextInput
            label="Company Email"
            placeholder="info@company.com"
            value={newCompanyEmail}
            onChange={(e) => setNewCompanyEmail(e.currentTarget.value)}
          />
          <TextInput
            label="Phone"
            placeholder="0300-1234567"
            value={newCompanyPhone}
            onChange={(e) => setNewCompanyPhone(e.currentTarget.value)}
          />
          <Divider label="Initial Admin Account" labelPosition="center" color="rgba(255, 255, 255, 0.1)" />
          <TextInput
            label="Admin Full Name"
            placeholder="e.g. Tariq Mahmood"
            required
            value={newAdminName}
            onChange={(e) => setNewAdminName(e.currentTarget.value)}
          />
          <TextInput
            label="Admin Email"
            placeholder="admin@company.com"
            required
            value={newAdminEmail}
            onChange={(e) => setNewAdminEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label="Initial Password"
            placeholder="Minimum 8 characters"
            required
            value={newAdminPassword}
            onChange={(e) => setNewAdminPassword(e.currentTarget.value)}
          />
          <Select
            label="Subscription Package"
            data={packages.map((p) => ({ value: p.id, label: `${p.name} (PKR ${p.price}/mo)` }))}
            value={newPackageId}
            onChange={(val) => val && setNewPackageId(val)}
          />
          <Button
            onClick={() => void handleProvisionTenant()}
            loading={provisioning}
            variant="gradient"
            gradient={{ from: "#C9952A", to: "#E6C965", deg: 135 }}
            style={{ color: "#070B19", fontWeight: 700 }}
          >
            Create Tenant Organization
          </Button>
        </Stack>
      </Modal>

      {/* ADD SUPER ADMIN MODAL */}
      <Modal
        opened={adminModalOpened}
        onClose={closeAdminModal}
        title={
          <Group gap="xs">
            <Shield size={18} color="#C9952A" />
            <Text fw={700}>Add Cross-Tenant Super Admin</Text>
          </Group>
        }
        styles={{
          header: { background: "#0E1528", color: "#F8FAFC" },
          content: { background: "#0E1528", color: "#F8FAFC" },
        }}
      >
        <Stack gap="md">
          {adminError && <Badge color="red" size="lg">{adminError}</Badge>}
          {adminSuccess && <Badge color="green" size="lg">{adminSuccess}</Badge>}
          <TextInput
            label="Full Name"
            placeholder="e.g. Chief Systems Administrator"
            required
            value={newSaName}
            onChange={(e) => setNewSaName(e.currentTarget.value)}
          />
          <TextInput
            label="Super Admin Email"
            placeholder="root@corbel.internal"
            required
            value={newSaEmail}
            onChange={(e) => setNewSaEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label="Master Password"
            placeholder="Minimum 8 characters"
            required
            value={newSaPassword}
            onChange={(e) => setNewSaPassword(e.currentTarget.value)}
          />
          <Button
            onClick={() => void handleCreateSuperAdmin()}
            loading={adminCreating}
            color="yellow"
            style={{ fontWeight: 700 }}
          >
            Register Super Admin
          </Button>
        </Stack>
      </Modal>
    </Box>
  );
}
