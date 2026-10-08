import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  CopyButton,
  Drawer,
  Group,
  LoadingOverlay,
  ScrollArea,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  Archive,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  KeyRound,
  Lock,
  Mail,
  Pencil,
  Phone,
  Sparkles,
  Users,
} from "lucide-react";

import {
  activateCompany,
  archiveCompany,
  getTenantCompanyDetail,
  setCompanyModule,
} from "../../api/backend";
import type {
  PublicCompany,
  TenantCompanyDetail,
  TenantCompanySummary,
} from "../../types/backend";
import { useI18n } from "../../i18n/I18nProvider";
import { useSaTheme } from "./saTheme.tsx";
import { MODULE_CATALOG, MODULE_LABELS, SubBadge } from "./TenantComponents";
import { ChangeSubscriptionModal } from "./ChangeSubscriptionModal";
import { IssueOtpModal } from "./IssueOtpModal";

const CORE_MODULES = new Set(["dashboard", "inventory", "invoices", "settings", "users"]);

const ALL_MODULE_KEYS = [
  "dashboard",
  "inventory",
  "invoices",
  "customers",
  "purchase_orders",
  "pos",
  "ledger",
  "reports",
  "settings",
  "import",
  "users",
  "fbr",
];

export default function TenantDetailDrawer({
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
  const [changeSubOpen, setChangeSubOpen] = useState(false);
  const [issueOtpOpen, setIssueOtpOpen] = useState(false);

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
    if (CORE_MODULES.has(moduleKey)) return;
    setBusy(true);
    try {
      await setCompanyModule({ companyId: tenant.id, moduleKey, isEnabled: enabled });
      const fresh = await getTenantCompanyDetail(tenant.id);
      setDetail(fresh);
      onChanged();
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
      size={560}
      overlayProps={{ blur: 4, backgroundOpacity: 0.55 }}
      styles={{
        header: {
          background: SA.bgSidebar,
          borderBottom: `1px solid ${SA.border}`,
          padding: "16px 20px",
          color: SA.text,
        },
        body: { padding: 0, background: SA.bg, color: SA.text },
      }}
      title={
        <Group gap="xs">
          <Sparkles size={16} style={{ color: SA.accent }} />
          <Text fw={650} size="sm" style={{ letterSpacing: -0.2 }}>
            Workspace Inspector
          </Text>
        </Group>
      }
    >
      <LoadingOverlay visible={busy} />
      {detail && tenant && (
        <ScrollArea h="calc(100vh - 65px)">
          <Stack gap={0}>
            {/* Header Identity Card */}
            <div
              style={{
                padding: "24px 24px 20px",
                background: SA.panelStrong,
                borderBottom: `1px solid ${SA.border}`,
              }}
            >
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="md" wrap="nowrap">
                    <ThemeIcon
                      size={48}
                      radius="md"
                      styles={{
                        root: {
                          background: SA.gradient,
                          color: SA.dockActiveColor,
                          fontWeight: 800,
                          fontSize: 20,
                          boxShadow: "0 8px 24px -6px rgba(2,132,199,0.5)",
                          flexShrink: 0,
                        },
                      }}
                    >
                      {detail.company.name.slice(0, 1).toUpperCase()}
                    </ThemeIcon>
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Text fw={650} size="lg" style={{ color: SA.text, letterSpacing: -0.3 }} truncate>
                        {detail.company.name}
                      </Text>
                      <Text size="xs" style={{ color: SA.muted }}>
                        ID: {tenant.id.slice(0, 13)}...
                      </Text>
                    </Stack>
                  </Group>

                  {/* Direct Contact Links */}
                  <Group gap="xs" wrap="wrap" mt={4}>
                    {detail.company.email && (
                      <CopyButton value={detail.company.email} timeout={2000}>
                        {({ copied, copy }) => (
                          <Button
                            size="compact-xs"
                            variant="light"
                            onClick={copy}
                            leftSection={copied ? <Check size={11} /> : <Mail size={11} />}
                            rightSection={<Copy size={10} />}
                            styles={{
                              root: {
                                background: SA.panel,
                                color: SA.textSoft,
                                border: `1px solid ${SA.border}`,
                              },
                            }}
                          >
                            {detail.company.email}
                          </Button>
                        )}
                      </CopyButton>
                    )}
                    {detail.company.phone && (
                      <CopyButton value={detail.company.phone} timeout={2000}>
                        {({ copied, copy }) => (
                          <Button
                            size="compact-xs"
                            variant="light"
                            onClick={copy}
                            leftSection={copied ? <Check size={11} /> : <Phone size={11} />}
                            rightSection={<Copy size={10} />}
                            styles={{
                              root: {
                                background: SA.panel,
                                color: SA.textSoft,
                                border: `1px solid ${SA.border}`,
                              },
                            }}
                          >
                            {detail.company.phone}
                          </Button>
                        )}
                      </CopyButton>
                    )}
                  </Group>

                  {/* Badges */}
                  <Group gap={6} mt={6}>
                    <Badge
                      size="sm"
                      variant="filled"
                      styles={{
                        root: {
                          background: tenant.isActive ? SA.panelMint : SA.panelStrong,
                          color: tenant.isActive ? SA.success : SA.muted,
                          border: `1px solid ${SA.borderStrong}`,
                          fontWeight: 700,
                        },
                      }}
                    >
                      {t(tenant.isActive ? "sa.status.active" : "sa.status.archived")}
                    </Badge>
                    <SubBadge status={sub?.status ?? null} />
                    <Badge
                      size="sm"
                      variant="filled"
                      styles={{
                        root: {
                          background: SA.panel,
                          color: SA.textSoft,
                          border: `1px solid ${SA.border}`,
                          fontWeight: 600,
                        },
                      }}
                    >
                      <Group gap={4}>
                        <Users size={11} /> {detail.userCount} {t("sa.overview.usersShort")}
                      </Group>
                    </Badge>
                  </Group>
                </Stack>

                {/* Actions */}
                <Stack gap={8} align="flex-end">
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => onEdit(detail.company)}
                    leftSection={<Pencil size={13} />}
                    styles={{
                      root: {
                        color: SA.text,
                        border: `1px solid ${SA.border}`,
                        background: SA.panel,
                        fontWeight: 600,
                        "&:hover": { background: SA.panelHover },
                      },
                    }}
                  >
                    {t("sa.tenants.edit.button")}
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="yellow"
                    onClick={() => setIssueOtpOpen(true)}
                    leftSection={<KeyRound size={13} />}
                    styles={{ root: { fontWeight: 600 } }}
                  >
                    Issue OTP
                  </Button>
                  <Tooltip label={tenant.isActive ? t("sa.tenants.archive") : t("sa.tenants.activate")}>
                    <Button
                      size="xs"
                      variant="light"
                      color={tenant.isActive ? "red" : "green"}
                      onClick={toggleArchive}
                      leftSection={tenant.isActive ? <Archive size={13} /> : <CheckCircle2 size={13} />}
                      styles={{ root: { fontWeight: 600 } }}
                    >
                      {tenant.isActive ? t("sa.tenants.archive") : t("sa.tenants.activate")}
                    </Button>
                  </Tooltip>
                </Stack>
              </Group>
            </div>

            {/* Subscription & Tier Plan */}
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${SA.border}` }}>
              <Group justify="space-between" align="center">
                <Text size="xs" fw={650} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
                  {t("sa.tenants.detail.subscription")} & Quotas
                </Text>
                <Button
                  size="compact-xs"
                  variant="light"
                  leftSection={<CreditCard size={12} />}
                  onClick={() => setChangeSubOpen(true)}
                  style={{
                    background: `${SA.accent}22`,
                    color: SA.accent,
                    border: `1px solid ${SA.accent}44`,
                    fontWeight: 700,
                  }}
                >
                  Change Plan
                </Button>
              </Group>
              <div
                style={{
                  marginTop: 12,
                  padding: "16px 18px",
                  borderRadius: 14,
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                }}
              >
                {pkg ? (
                  <Stack gap={10}>
                    <Group justify="space-between">
                      <Text size="sm" style={{ color: SA.muted }}>
                        {t("sa.tenants.detail.package")}
                      </Text>
                      <Badge
                        size="md"
                        variant="filled"
                        styles={{
                          root: {
                            background: `${SA.accent}22`,
                            color: SA.accent,
                            border: `1px solid ${SA.accent}55`,
                            fontWeight: 800,
                          },
                        }}
                      >
                        {pkg.name}
                      </Badge>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" style={{ color: SA.muted }}>
                        {t("sa.tenants.detail.price")}
                      </Text>
                      <Text fw={700} size="sm" style={{ color: SA.text }}>
                        PKR {pkg.price.toLocaleString()} / {pkg.billingCycle}
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" style={{ color: SA.muted }}>
                        {t("sa.tenants.detail.period")}
                      </Text>
                      <Text size="xs" fw={600} style={{ color: SA.textSoft }}>
                        {sub?.currentPeriodStart?.slice(0, 10)} → {sub?.currentPeriodEnd?.slice(0, 10)}
                      </Text>
                    </Group>
                    {sub?.trialEndsAt && (
                      <Group justify="space-between">
                        <Text size="sm" style={{ color: SA.muted }}>
                          {t("sa.tenants.detail.trial")}
                        </Text>
                        <Text size="xs" fw={700} style={{ color: SA.warning }}>
                          Ends {sub.trialEndsAt.slice(0, 10)}
                        </Text>
                      </Group>
                    )}
                  </Stack>
                ) : (
                  <Text size="sm" style={{ color: SA.muted }}>
                    {t("sa.tenants.detail.noSubscription")}
                  </Text>
                )}
              </div>
            </div>

            {/* Master Module Controls */}
            <div style={{ padding: "20px 24px", borderBottom: `1px solid ${SA.border}` }}>
              <Group justify="space-between" mb={12}>
                <Text size="xs" fw={650} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
                  {t("sa.tenants.detail.modules")}
                </Text>
                <Text size="11px" style={{ color: SA.muted }}>
                  Core modules are permanently locked
                </Text>
              </Group>

              <Stack gap={8}>
                {ALL_MODULE_KEYS.map((key) => {
                  const mod = detail.modules.find((m) => m.moduleKey === key);
                  const isCore = CORE_MODULES.has(key);
                  const isEnabled = isCore ? true : (mod ? mod.isEnabled : false);
                  const meta = MODULE_CATALOG[key];
                  const title = meta?.title ?? t(MODULE_LABELS[key] ?? key);
                  const description = meta?.description ?? "Operational ERP module";

                  let isPlanEntitled = true;
                  if (pkg && !isCore) {
                    try {
                      const limits: Record<string, unknown> = typeof pkg.moduleLimits === "string" 
                        ? JSON.parse(pkg.moduleLimits) 
                        : (pkg.moduleLimits || {});
                      const feats: Record<string, unknown> = typeof pkg.features === "string"
                        ? JSON.parse(pkg.features)
                        : (pkg.features || {});
                      const limitAllowed = limits[key] !== undefined ? Boolean(limits[key]) : true;
                      const featAllowed = key === "fbr" ? Boolean(feats.fbr)
                        : key === "import" ? Boolean(feats.data_import ?? feats.import ?? true)
                        : key === "pos" ? Boolean(feats.pos ?? true)
                        : key === "ledger" ? Boolean(feats.ledger ?? feats.accounts ?? true)
                        : true;
                      isPlanEntitled = limitAllowed && featAllowed;
                    } catch {
                      // fallback
                    }
                  }

                  return (
                    <div
                      key={key}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 12,
                        background: SA.panel,
                        border: `1px solid ${SA.border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={8}>
                          <Text size="sm" fw={700} style={{ color: SA.text }}>
                            {title}
                          </Text>
                          {isCore ? (
                            <Badge
                              size="xs"
                              variant="filled"
                              styles={{
                                root: {
                                  background: SA.panelStrong,
                                  color: SA.muted,
                                  border: `1px solid ${SA.border}`,
                                },
                              }}
                              leftSection={<Lock size={9} />}
                            >
                              Core System
                            </Badge>
                          ) : isPlanEntitled ? (
                            <Badge
                              size="xs"
                              variant="light"
                              color="blue"
                              styles={{ root: { fontWeight: 650 } }}
                            >
                              Included in Plan
                            </Badge>
                          ) : (
                            <Badge
                              size="xs"
                              variant="outline"
                              color="gray"
                              styles={{ root: { fontWeight: 600 } }}
                            >
                              Requires Upgrade
                            </Badge>
                          )}
                        </Group>
                        <Text size="xs" style={{ color: SA.muted }} lineClamp={1}>
                          {description}
                        </Text>
                      </Stack>

                      <Switch
                        size="md"
                        checked={isEnabled}
                        disabled={isCore}
                        onChange={(e) => toggleModule(key, e.currentTarget.checked)}
                        styles={{
                          track: {
                            backgroundColor: isEnabled ? SA.accent : SA.borderStrong,
                            borderColor: "transparent",
                            cursor: isCore ? "not-allowed" : "pointer",
                          },
                        }}
                      />
                    </div>
                  );
                })}
              </Stack>
            </div>

            {/* Feature Flags */}
            <div style={{ padding: "20px 24px 32px" }}>
              <Text size="xs" fw={650} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
                {t("sa.tenants.detail.featureFlags")}
              </Text>
              {detail.featureFlags.length === 0 ? (
                <Text size="sm" style={{ color: SA.muted }} mt="sm">
                  {t("sa.tenants.detail.noFlags")}
                </Text>
              ) : (
                <Stack gap={8} mt="sm">
                  {detail.featureFlags.map((flag) => (
                    <div
                      key={flag.id}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 12,
                        background: SA.panel,
                        border: `1px solid ${SA.border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <Text size="sm" fw={600} style={{ color: SA.text }}>
                        {flag.featureKey}
                      </Text>
                      <Badge
                        size="sm"
                        variant="filled"
                        styles={{
                          root: {
                            background: flag.isEnabled ? `${SA.accent}20` : SA.panelStrong,
                            color: flag.isEnabled ? SA.accent : SA.muted,
                            border: `1px solid ${flag.isEnabled ? `${SA.accent}50` : SA.border}`,
                            fontWeight: 700,
                          },
                        }}
                      >
                        {flag.isEnabled ? "ENABLED" : "DISABLED"}
                      </Badge>
                    </div>
                  ))}
                </Stack>
              )}
            </div>
          </Stack>
        </ScrollArea>
      )}

      {tenant && (
        <>
          <ChangeSubscriptionModal
            companyId={tenant.id}
            companyName={detail?.company.name ?? tenant.name}
            currentPackageId={detail?.package?.id}
            opened={changeSubOpen}
            onClose={() => setChangeSubOpen(false)}
            onSuccess={() => {
              getTenantCompanyDetail(tenant.id).then(setDetail).catch(() => {});
              onChanged();
            }}
          />

          <IssueOtpModal
            companyId={tenant.id}
            companyName={detail?.company.name ?? tenant.name}
            opened={issueOtpOpen}
            onClose={() => setIssueOtpOpen(false)}
          />
        </>
      )}
    </Drawer>
  );
}
