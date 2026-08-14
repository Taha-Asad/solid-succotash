// ==========================================
// TENANTS — Super Admin company management
// ==========================================

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  LoadingOverlay,
  Modal,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  Archive,
  Building2,
  CheckCircle2,
  CreditCard,
  Info,
  Mail,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
} from "lucide-react";

import {
  activateCompany,
  archiveCompany,
  getErrorMessage,
  getTenantCompanyDetail,
  listPackages,
  listTenantCompanies,
  registerTenant,
  setCompanyModule,
  updateTenantCompany,
} from "../../api/backend";
import type {
  PublicCompany,
  PublicPackage,
  RegisterTenantInput,
  TenantCompanyDetail,
  TenantCompanySummary,
  UpdateTenantCompanyInput,
} from "../../types/backend";
import { useI18n } from "../../i18n/I18nProvider";
import LottieAnimation from "../../components/LottieAnimation";
import successCheck from "../../assets/lottie/success-check.json";
import { useSaTheme } from "./saTheme.tsx";

const SUB_STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  active: { bg: "rgba(52,211,153,0.12)", fg: "#34D399" },
  trial: { bg: "rgba(56,189,248,0.12)", fg: "#38BDF8" },
  past_due: { bg: "rgba(251,191,36,0.12)", fg: "#FBBF24" },
  suspended: { bg: "rgba(248,113,113,0.12)", fg: "#F87171" },
  cancelled: { bg: "rgba(154,166,196,0.12)", fg: "#9AA6C4" },
  ended: { bg: "rgba(154,166,196,0.12)", fg: "#9AA6C4" },
};

function SubBadge({ status }: { status: string | null }) {
  const { t } = useI18n();
  if (!status) return null;
  const c = SUB_STATUS_COLOR[status] ?? SUB_STATUS_COLOR.cancelled;
  return (
    <Badge
      size="sm"
      variant="light"
      styles={{
        root: { background: c.bg, color: c.fg, border: `1px solid ${c.fg}33` },
        label: { fontWeight: 700, textTransform: "capitalize" },
      }}
    >
      {t(`sa.sub.${status}`)}
    </Badge>
  );
}

const MODULE_LABELS: Record<string, string> = {
  dashboard: "sa.module.dashboard",
  inventory: "sa.module.inventory",
  sales: "sa.module.sales",
  purchases: "sa.module.purchases",
  reports: "sa.module.reports",
  employees: "sa.module.employees",
  branches: "sa.module.branches",
  invoices: "sa.module.invoices",
  import: "sa.module.import",
  data_import: "sa.module.dataImport",
};

// ==========================================
// REGISTER TENANT MODAL
// ==========================================

function RegisterTenantModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    companyName: "",
    adminFullName: "",
    adminEmail: "",
    adminPassword: "",
    packageId: "",
    phone: "",
    address: "",
    taxNumber: "",
    currencyCode: "PKR",
    ntn: "",
    strn: "",
    province: "",
  });

  useEffect(() => {
    if (opened) {
      listPackages(true).then(setPackages).catch(() => {});
    }
  }, [opened]);

  useEffect(() => {
    if (!opened) setCreated(false);
  }, [opened]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setError("");
    if (!form.companyName || !form.adminFullName || !form.adminEmail || !form.adminPassword) {
      setError(t("sa.tenants.register.required"));
      return;
    }
    if (!form.packageId) {
      setError(t("sa.tenants.register.needPackage"));
      return;
    }
    setLoading(true);
    try {
      const input: RegisterTenantInput = {
        companyName: form.companyName,
        adminFullName: form.adminFullName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
        packageId: form.packageId,
        phone: form.phone || null,
        address: form.address || null,
        taxNumber: form.taxNumber || null,
        currencyCode: form.currencyCode,
        ntn: form.ntn || null,
        strn: form.strn || null,
        province: form.province || null,
      };
      await registerTenant(input);
      setCreated(true);
      setForm({
        companyName: "",
        adminFullName: "",
        adminEmail: "",
        adminPassword: "",
        packageId: "",
        phone: "",
        address: "",
        taxNumber: "",
        currencyCode: "PKR",
        ntn: "",
        strn: "",
        province: "",
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <Modal
        opened={opened}
        onClose={onClose}
        size="sm"
        centered
        overlayProps={{ blur: 4, backgroundOpacity: 0.6 }}
      >
        <Stack align="center" gap={8} py="md">
          <LottieAnimation animationData={successCheck} size={190} />
          <Text fw={800} size="lg" style={{ color: SA.text }}>
            {t("sa.tenants.register.createdTitle")}
          </Text>
          <Text size="sm" ta="center" style={{ color: SA.muted }}>
            {t("sa.tenants.register.createdSubtitle")}
          </Text>
          <Button
            mt="sm"
            onClick={() => {
              onCreated();
              onClose();
              setCreated(false);
            }}
            styles={{
              root: {
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 700,
                "&:hover": { filter: "brightness(1.08)" },
              },
            }}
          >
            {t("sa.tenants.register.done")}
          </Button>
        </Stack>
      </Modal>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("sa.tenants.register.title")}
      size="lg"
      centered
      overlayProps={{ blur: 4, backgroundOpacity: 0.6 }}
      styles={{
        header: { fontWeight: 800 },
      }}
    >
      <LoadingOverlay visible={loading} />
      <Stack gap="sm">
        <Text size="xs" style={{ color: SA.muted }}>
          {t("sa.tenants.register.subtitle")}
        </Text>

        <Text size="xs" fw={700} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
          {t("sa.tenants.register.companySection")}
        </Text>
        <SimpleGrid cols={2} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.companyName")}
            placeholder={t("sa.tenants.register.companyNamePh")}
            required
            value={form.companyName}
            onChange={(e) => set("companyName", e.currentTarget.value)}
            leftSection={<Building2 size={15} />}
          />
          <Select
            label={t("sa.tenants.register.package")}
            placeholder={t("sa.tenants.register.packagePh")}
            required
            data={packages.map((p) => ({
              value: p.id,
              label: `${p.name} — ${p.price.toLocaleString()} / ${p.billingCycle}`,
            }))}
            value={form.packageId}
            onChange={(v) => set("packageId", v ?? "")}
            leftSection={<CreditCard size={15} />}
            searchable
          />
        </SimpleGrid>
        <SimpleGrid cols={2} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.phone")}
            value={form.phone}
            onChange={(e) => set("phone", e.currentTarget.value)}
            leftSection={<Phone size={15} />}
          />
          <TextInput
            label={t("sa.tenants.register.address")}
            value={form.address}
            onChange={(e) => set("address", e.currentTarget.value)}
          />
        </SimpleGrid>
        <SimpleGrid cols={3} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.taxNumber")}
            value={form.taxNumber}
            onChange={(e) => set("taxNumber", e.currentTarget.value)}
          />
          <TextInput
            label="NTN"
            value={form.ntn}
            onChange={(e) => set("ntn", e.currentTarget.value)}
          />
          <TextInput
            label="STRN"
            value={form.strn}
            onChange={(e) => set("strn", e.currentTarget.value)}
          />
        </SimpleGrid>
        <SimpleGrid cols={2} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.province")}
            value={form.province}
            onChange={(e) => set("province", e.currentTarget.value)}
          />
          <Select
            label={t("sa.tenants.register.currency")}
            data={["PKR", "USD", "GBP", "EUR", "AED", "SAR"]}
            value={form.currencyCode}
            onChange={(v) => set("currencyCode", v ?? "PKR")}
          />
        </SimpleGrid>

        <Text size="xs" fw={700} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
          {t("sa.tenants.register.adminSection")}
        </Text>
        <SimpleGrid cols={2} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.adminName")}
            required
            value={form.adminFullName}
            onChange={(e) => set("adminFullName", e.currentTarget.value)}
          />
          <TextInput
            label={t("sa.tenants.register.adminEmail")}
            type="email"
            required
            value={form.adminEmail}
            onChange={(e) => set("adminEmail", e.currentTarget.value)}
            leftSection={<Mail size={15} />}
          />
        </SimpleGrid>
        <PasswordInput
          label={t("sa.tenants.register.adminPassword")}
          required
          value={form.adminPassword}
          onChange={(e) => set("adminPassword", e.currentTarget.value)}
        />

        {error && (
          <Alert color="red" icon={<ShieldAlert size={16} />} styles={{ root: { color: "#F87171" } }}>
            {error}
          </Alert>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="light" onClick={onClose}>
            {t("sa.common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={loading}
            styles={{
              root: {
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 700,
                "&:hover": { filter: "brightness(1.08)" },
              },
            }}
          >
            {t("sa.tenants.register.create")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ==========================================
// EDIT TENANT MODAL
// ==========================================

function EditTenantModal({
  company,
  opened,
  onClose,
  onSaved,
}: {
  company: PublicCompany | null;
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    taxNumber: "",
    currencyCode: "PKR",
  });

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name ?? "",
        email: company.email ?? "",
        phone: company.phone ?? "",
        address: company.address ?? "",
        taxNumber: company.taxNumber ?? "",
        currencyCode: company.currencyCode ?? "PKR",
      });
      setSaved(false);
      setError("");
    }
  }, [company, opened]);

  async function handleSave() {
    if (!company) return;
    if (!form.name.trim()) {
      setError(t("sa.tenants.register.required"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const input: UpdateTenantCompanyInput = {
        companyId: company.id,
        name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        taxNumber: form.taxNumber || null,
        currencyCode: form.currencyCode,
      };
      await updateTenantCompany(input);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("sa.tenants.edit.title")}
      size="md"
      centered
      overlayProps={{ blur: 4, backgroundOpacity: 0.6 }}
      styles={{ header: { fontWeight: 800 } }}
    >
      <LoadingOverlay visible={saving} />
      {saved ? (
        <Stack align="center" gap={6} py="md">
          <LottieAnimation animationData={successCheck} size={150} />
          <Text fw={700} style={{ color: SA.success }}>
            {t("sa.tenants.edit.saved")}
          </Text>
          <Button
            mt="xs"
            variant="light"
            onClick={onClose}
            styles={{ root: { color: SA.text, border: `1px solid ${SA.border}` } }}
          >
            {t("sa.tenants.register.done")}
          </Button>
        </Stack>
      ) : (
        <Stack gap="sm">
          <TextInput
            label={t("sa.tenants.register.companyName")}
            required
            value={form.name}
            onChange={(e) => {
              const name = e.currentTarget.value;
              setForm((f) => ({ ...f, name }));
            }}
            leftSection={<Building2 size={15} />}
          />
          <SimpleGrid cols={2} spacing="sm">
            <TextInput
              label={t("sa.tenants.register.adminEmail")}
              type="email"
              value={form.email}
              onChange={(e) => {
                const email = e.currentTarget.value;
                setForm((f) => ({ ...f, email }));
              }}
              leftSection={<Mail size={15} />}
            />
            <TextInput
              label={t("sa.tenants.register.phone")}
              value={form.phone}
              onChange={(e) => {
                const phone = e.currentTarget.value;
                setForm((f) => ({ ...f, phone }));
              }}
              leftSection={<Phone size={15} />}
            />
          </SimpleGrid>
          <TextInput
            label={t("sa.tenants.register.address")}
            value={form.address}
            onChange={(e) => {
              const address = e.currentTarget.value;
              setForm((f) => ({ ...f, address }));
            }}
          />
          <SimpleGrid cols={2} spacing="sm">
            <TextInput
              label={t("sa.tenants.register.taxNumber")}
              value={form.taxNumber}
              onChange={(e) => {
                const taxNumber = e.currentTarget.value;
                setForm((f) => ({ ...f, taxNumber }));
              }}
            />
            <Select
              label={t("sa.tenants.register.currency")}
              data={["PKR", "USD", "GBP", "EUR", "AED", "SAR"]}
              value={form.currencyCode}
              onChange={(v) => setForm((f) => ({ ...f, currencyCode: v ?? "PKR" }))}
            />
          </SimpleGrid>

          {error && (
            <Alert color="red" icon={<ShieldAlert size={16} />} styles={{ root: { color: "#F87171" } }}>
              {error}
            </Alert>
          )}

          <Group justify="flex-end" mt="xs">
            <Button variant="light" onClick={onClose}>
              {t("sa.common.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              loading={saving}
              styles={{
                root: {
                  background: SA.gradient,
                  color: "#06121F",
                  fontWeight: 700,
                  "&:hover": { filter: "brightness(1.08)" },
                },
              }}
            >
              {t("sa.tenants.edit.save")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ==========================================
// TENANT DETAIL DRAWER
// ==========================================

function TenantDetailDrawer({
  tenant,
  onClose,
  onChanged,
  onEdit,
  refreshKey,
}: {
  tenant: TenantCompanySummary | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (company: PublicCompany) => void;
  refreshKey: number;
}) {
  const { t, dir } = useI18n();
  const SA = useSaTheme();
  const [detail, setDetail] = useState<TenantCompanyDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const opened = tenant !== null;

  useEffect(() => {
    if (!tenant) {
      setDetail(null);
      return;
    }
    setDetail(null);
    setBusy(true);
    getTenantCompanyDetail(tenant.id)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setBusy(false));
  }, [tenant, refreshKey]);

  async function toggleModule(moduleKey: string, enabled: boolean) {
    if (!tenant || !detail) return;
    setBusy(true);
    try {
      await setCompanyModule({ companyId: tenant.id, moduleKey, isEnabled: enabled });
      const fresh = await getTenantCompanyDetail(tenant.id);
      setDetail(fresh);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!tenant) return;
    setBusy(true);
    try {
      if (tenant.isActive) await archiveCompany(tenant.id);
      else await activateCompany(tenant.id);
      onChanged();
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  const sub = detail?.subscription;
  const pkg = detail?.package;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position={dir === "rtl" ? "left" : "right"}
      size={520}
      overlayProps={{ blur: 3, backgroundOpacity: 0.5 }}
      styles={{
        header: { fontWeight: 800 },
        body: { padding: 0 },
      }}
    >
      <LoadingOverlay visible={busy} />
      {detail && tenant && (
        <Stack gap={0}>
          {/* Header */}
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              padding: "22px 22px 18px",
              background: "linear-gradient(135deg, rgba(56,189,248,0.14), rgba(129,140,248,0.1))",
              borderBottom: `1px solid ${SA.border}`,
            }}
          >
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Stack gap={6}>
                <Group gap="sm">
                  <ThemeIcon
                    size={44}
                    radius="md"
                    styles={{
                      root: {
                        background: SA.gradient,
                        color: "#06121F",
                        boxShadow: "0 10px 24px -10px rgba(56,189,248,0.6)",
                      },
                    }}
                  >
                    <Building2 size={22} />
                  </ThemeIcon>
                  <Stack gap={0}>
                    <Text fw={800} size="lg" style={{ color: SA.text }}>
                      {detail.company.name}
                    </Text>
                    <Text size="xs" style={{ color: SA.textSoft }}>
                      {detail.company.email ?? "—"} {detail.company.phone ? `· ${detail.company.phone}` : ""}
                    </Text>
                  </Stack>
                </Group>
                <Group gap={6}>
                  <Badge
                    size="sm"
                    variant="light"
                    styles={{
                      root: {
                        background: tenant.isActive ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
                        color: tenant.isActive ? SA.success : SA.danger,
                        border: `1px solid ${tenant.isActive ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
                      },
                      label: { fontWeight: 700 },
                    }}
                  >
                    {t(tenant.isActive ? "sa.status.active" : "sa.status.archived")}
                  </Badge>
                  <SubBadge status={sub?.status ?? null} />
                  <Badge size="sm" variant="light" styles={{ root: { background: SA.panelStrong, color: SA.textSoft } }}>
                    <Group gap={4}>
                      <Users size={11} /> {detail.userCount}
                    </Group>
                  </Badge>
                </Group>
              </Stack>
              <Group gap={6}>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => onEdit(detail.company)}
                  leftSection={<Pencil size={14} />}
                  styles={{
                    root: {
                      color: SA.text,
                      border: `1px solid ${SA.border}`,
                      background: SA.panelStrong,
                      "&:hover": { background: SA.panelHover },
                    },
                  }}
                >
                  {t("sa.tenants.edit.button")}
                </Button>
                <Tooltip label={tenant.isActive ? t("sa.tenants.archive") : t("sa.tenants.activate")}>
                  <Button
                    size="xs"
                    variant="light"
                    color={tenant.isActive ? "red" : "green"}
                    onClick={toggleArchive}
                    leftSection={tenant.isActive ? <Archive size={14} /> : <CheckCircle2 size={14} />}
                  >
                    {tenant.isActive ? t("sa.tenants.archive") : t("sa.tenants.activate")}
                  </Button>
                </Tooltip>
              </Group>
            </Group>
          </div>

          {/* Subscription */}
          <div style={{ padding: "18px 22px", borderBottom: `1px solid ${SA.border}` }}>
            <Text size="xs" fw={700} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
              {t("sa.tenants.detail.subscription")}
            </Text>
            <Stack gap={8} mt="xs">
              {pkg ? (
                <>
                  <Group justify="space-between">
                    <Text size="sm" style={{ color: SA.textSoft }}>{t("sa.tenants.detail.package")}</Text>
                    <Text fw={700} size="sm" style={{ color: SA.text }}>{pkg.name}</Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" style={{ color: SA.textSoft }}>{t("sa.tenants.detail.price")}</Text>
                    <Text fw={700} size="sm" style={{ color: SA.text }}>
                      {pkg.price.toLocaleString()} / {pkg.billingCycle}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="sm" style={{ color: SA.textSoft }}>{t("sa.tenants.detail.period")}</Text>
                    <Text size="sm" style={{ color: SA.text }}>
                      {sub?.currentPeriodStart?.slice(0, 10)} → {sub?.currentPeriodEnd?.slice(0, 10)}
                    </Text>
                  </Group>
                  {sub?.trialEndsAt && (
                    <Group justify="space-between">
                      <Text size="sm" style={{ color: SA.textSoft }}>{t("sa.tenants.detail.trial")}</Text>
                      <Text size="sm" style={{ color: SA.warning }}>
                        {sub.trialEndsAt.slice(0, 10)}
                      </Text>
                    </Group>
                  )}
                </>
              ) : (
                <Text size="sm" style={{ color: SA.muted }}>{t("sa.tenants.detail.noSubscription")}</Text>
              )}
            </Stack>
          </div>

          {/* Modules */}
          <div style={{ padding: "18px 22px", borderBottom: `1px solid ${SA.border}` }}>
            <Text size="xs" fw={700} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
              {t("sa.tenants.detail.modules")}
            </Text>
            <Stack gap={4} mt="xs">
              {detail.modules.map((mod) => (
                <Group key={mod.id} justify="space-between" py={4}>
                  <Text size="sm" style={{ color: SA.text }}>
                    {t(MODULE_LABELS[mod.moduleKey] ?? mod.moduleKey)}
                  </Text>
                  <Switch
                    size="sm"
                    checked={mod.isEnabled}
                    onChange={(e) => toggleModule(mod.moduleKey, e.currentTarget.checked)}
                    color="cyan"
                  />
                </Group>
              ))}
            </Stack>
          </div>

          {/* Feature flags */}
          <div style={{ padding: "18px 22px" }}>
            <Text size="xs" fw={700} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
              {t("sa.tenants.detail.featureFlags")}
            </Text>
            {detail.featureFlags.length === 0 ? (
              <Text size="sm" style={{ color: SA.muted }} mt="xs">
                {t("sa.tenants.detail.noFlags")}
              </Text>
            ) : (
              <Stack gap={4} mt="xs">
                {detail.featureFlags.map((flag) => (
                  <Group key={flag.id} justify="space-between" py={4}>
                    <Text size="sm" style={{ color: SA.text }}>
                      {flag.featureKey}
                    </Text>
                    <Badge
                      size="sm"
                      variant="light"
                      styles={{
                        root: {
                          background: flag.isEnabled ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
                          color: flag.isEnabled ? SA.success : SA.danger,
                        },
                        label: { fontWeight: 700 },
                      }}
                    >
                      {flag.isEnabled ? "ON" : "OFF"}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            )}
          </div>
        </Stack>
      )}
    </Drawer>
  );
}

// ==========================================
// TENANTS PAGE
// ==========================================

export default function TenantsPage() {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [tenants, setTenants] = useState<TenantCompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "archived">("all");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selected, setSelected] = useState<TenantCompanySummary | null>(null);
  const [editCompany, setEditCompany] = useState<PublicCompany | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    listTenantCompanies()
      .then(setTenants)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = tenants.filter((tenant) => {
    const matchesQuery =
      !query ||
      tenant.name.toLowerCase().includes(query.toLowerCase()) ||
      (tenant.email ?? "").toLowerCase().includes(query.toLowerCase());
    const matchesStatus =
      status === "all" ||
      (status === "active" && tenant.isActive) ||
      (status === "archived" && !tenant.isActive);
    return matchesQuery && matchesStatus;
  });

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <LoadingOverlay visible={loading} />

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "20px 28px",
          flexWrap: "wrap",
        }}
      >
        <Group gap="sm">
          <TextInput
            placeholder={t("sa.tenants.searchPh")}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={260}
            leftSection={<Search size={15} />}
            radius="md"
          />
          <Select
            value={status}
            onChange={(v) => setStatus((v as typeof status) ?? "all")}
            data={[
              { value: "all", label: t("sa.tenants.filter.all") },
              { value: "active", label: t("sa.tenants.filter.active") },
              { value: "archived", label: t("sa.tenants.filter.archived") },
            ]}
            w={150}
            radius="md"
          />
        </Group>
        <Group gap="sm">
          <Button variant="light" size="sm" leftSection={<RefreshCw size={14} />} onClick={load}>
            {t("sa.tenants.refresh")}
          </Button>
          <Button
            size="sm"
            leftSection={<Plus size={15} />}
            onClick={() => setRegisterOpen(true)}
            styles={{
              root: {
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 700,
                boxShadow: "0 10px 26px -10px rgba(56,189,248,0.7)",
                "&:hover": { filter: "brightness(1.08)" },
              },
            }}
          >
            {t("sa.tenants.registerButton")}
          </Button>
        </Group>
      </div>

      {error && (
        <Alert color="red" mx={28} mb="sm" icon={<Info size={16} />}>
          {error}
        </Alert>
      )}

      {/* List */}
      <div style={{ padding: "0 28px 28px", maxWidth: 1180, margin: "0 auto" }}>
        <AnimatePresence>
          {filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                borderRadius: 18,
                border: `1px dashed ${SA.borderStrong}`,
                padding: 48,
                textAlign: "center",
                background: SA.panel,
              }}
            >
              <Text size="sm" style={{ color: SA.muted }}>
                {t("sa.tenants.empty")}
              </Text>
            </motion.div>
          ) : (
            <Stack gap={10}>
              {filtered.map((tenant, i) => (
                <motion.div
                  key={tenant.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.4), duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -2 }}
                  onClick={() => setSelected(tenant)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 18px",
                    borderRadius: 16,
                    background: SA.panel,
                    border: `1px solid ${SA.border}`,
                    cursor: "pointer",
                    transition: "border-color 0.2s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(56,189,248,0.5)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = SA.border)}
                >
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(56,189,248,0.1)",
                      border: `1px solid rgba(56,189,248,0.3)`,
                      color: SA.accent,
                      flexShrink: 0,
                    }}
                  >
                    <Building2 size={19} />
                  </div>
                  <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={700} size="sm" style={{ color: SA.text }} truncate>
                      {tenant.name}
                    </Text>
                    <Text size="xs" style={{ color: SA.muted }} truncate>
                      {tenant.email ?? "—"} · {tenant.userCount} {t("sa.overview.usersShort")}
                    </Text>
                  </Stack>
                  <Stack gap={1} align="flex-end" style={{ flexShrink: 0 }}>
                    <Text size="xs" fw={600} style={{ color: SA.textSoft }}>
                      {tenant.packageName ?? "—"}
                    </Text>
                    <Text size="xs" style={{ color: SA.muted }}>
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </Text>
                  </Stack>
                  <SubBadge status={tenant.subscriptionStatus} />
                  <Badge
                    size="sm"
                    variant="light"
                    styles={{
                      root: {
                        background: tenant.isActive ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
                        color: tenant.isActive ? SA.success : SA.danger,
                        border: `1px solid ${tenant.isActive ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
                        flexShrink: 0,
                      },
                      label: { fontWeight: 700 },
                    }}
                  >
                    {t(tenant.isActive ? "sa.status.active" : "sa.status.archived")}
                  </Badge>
                </motion.div>
              ))}
            </Stack>
          )}
        </AnimatePresence>
      </div>

      <RegisterTenantModal
        opened={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={load}
      />
      <TenantDetailDrawer
        tenant={selected}
        onClose={() => setSelected(null)}
        onChanged={load}
        onEdit={(company) => {
          setEditCompany(company);
          setEditOpen(true);
        }}
        refreshKey={refreshKey}
      />
      <EditTenantModal
        company={editCompany}
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          load();
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
