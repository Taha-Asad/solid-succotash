// ==========================================
// PLATFORM SETTINGS — PROFILE & ERP/CRM GOVERNANCE
// ==========================================
// Super Admin Authority Center:
// 1. Super Admin Profile & Identity Editor (Name, Avatar, Password)
// 2. Enterprise ERP & CRM Governance (Module activation per tenant)
// 3. Theme & Regional Settings

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Group,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  AlertCircle,
  Boxes,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  DollarSign,
  Download,
  Feather,
  FileSpreadsheet,
  KeyRound,
  Landmark,
  Languages,
  Layers,
  MessageSquare,
  Moon,
  Palette,
  PenTool,
  Receipt,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Sun,
  Trees,
  User,
  Users,
} from "lucide-react";

import {
  changeMyPassword,
  checkForUpdates,
  getErrorMessage,
  installUpdate,
  listCompanyModules,
  listTenantCompanies,
  setCompanyModule,
  updateMyProfile,
  type UpdateResult,
} from "../../api/backend";
import { useI18n } from "../../i18n/I18nProvider";
import { LANGUAGES, LANGUAGE_ORDER } from "../../i18n/translations";
import type {
  PublicCompanyModule,
  PublicUser,
  TenantCompanySummary,
} from "../../types/backend";
import { useSaScheme, useSaTheme } from "./saTheme";

// Preset cozy avatars matching The Foolish Crow / Corbel lore
const AVATAR_OPTIONS = [
  { id: "crow", label: "Sovereign Crow", icon: Feather },
  { id: "keystone", label: "Studio Keystone", icon: Landmark },
  { id: "pine", label: "Forest Warden", icon: Trees },
  { id: "quill", label: "Master Quill", icon: PenTool },
];

// ERP Modules definition
const ERP_MODULE_DEFS = [
  {
    key: "pos",
    name: "Point of Sale (POS)",
    desc: "Thermal receipt printing, barcode scanning & rapid cashier lane",
    icon: Receipt,
  },
  {
    key: "inventory",
    name: "Multi-Warehouse Inventory",
    desc: "Batch tracking, stock movements, FIFO valuations & alerts",
    icon: Boxes,
  },
  {
    key: "ledger",
    name: "Double-Entry General Ledger",
    desc: "Chart of accounts, journal entries, balance sheets & trial balance",
    icon: FileSpreadsheet,
  },
  {
    key: "invoices",
    name: "Invoicing & Accounts Receivable",
    desc: "Customer tax invoices, credit notes & payment reconciliation",
    icon: DollarSign,
  },
  {
    key: "purchases",
    name: "Procurement & Payables",
    desc: "Purchase orders, goods received notes (GRN) & vendor bills",
    icon: Briefcase,
  },
  {
    key: "employees",
    name: "HR & Employee Payroll",
    desc: "Staff directories, salary slips, attendance & role access",
    icon: Users,
  },
  {
    key: "branches",
    name: "Multi-Branch Architecture",
    desc: "Sovereign multi-node isolation across retail locations",
    icon: Building2,
  },
  {
    key: "fbr",
    name: "FBR Real-Time Digital Fiscalization",
    desc: "Automated fiscal invoice QR codes & live revenue authority sync",
    icon: ShieldCheck,
  },
];

// CRM Modules definition
const CRM_MODULE_DEFS = [
  {
    key: "customers",
    name: "Customer Directory & Ledgers",
    desc: "Contact databases, customer credit terms & transaction history",
    icon: Users,
  },
  {
    key: "leads",
    name: "Leads & Deal Pipelines",
    desc: "Opportunity stages, prospecting pipeline & sales conversion",
    icon: Layers,
  },
  {
    key: "discussions",
    name: "Team Discussions & Internal Notes",
    desc: "Order activity logs, internal memos & cross-department chat",
    icon: MessageSquare,
  },
  {
    key: "ai_insights",
    name: "AI Insights & Forecasts",
    desc: "Automated inventory demand forecasting & financial telemetry",
    icon: Sparkles,
  },
];

interface PlatformSettingsProps {
  user?: PublicUser;
  onUserUpdated?: (user: PublicUser) => void;
  onOpenTenant?: (tenant: TenantCompanySummary) => void;
}

export default function PlatformSettingsPage({
  user,
  onUserUpdated,
}: PlatformSettingsProps) {
  const { lang, setLang } = useI18n();
  const SA = useSaTheme();
  const { scheme, setScheme } = useSaScheme();

  // Active Tab: "profile" | "erpcrm" | "system" | "updater"
  const [activeTab, setActiveTab] = useState<string | null>("profile");

  // Profile Form State
  const [fullName, setFullName] = useState(user?.fullName || "Taha Asadullah");
  const [customAvatarUrl, setCustomAvatarUrl] = useState(
    localStorage.getItem("corbel_dev_avatar") || "",
  );
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState("crow");

  // App Updater State
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  // ERP / CRM Governance State
  const [tenants, setTenants] = useState<TenantCompanySummary[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [companyModules, setCompanyModules] = useState<PublicCompanyModule[]>([]);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [moduleActionLoading, setModuleActionLoading] = useState<string | null>(null);
  const [governanceFeedback, setGovernanceFeedback] = useState<string | null>(null);

  // Load Tenants for ERP/CRM Governance
  useEffect(() => {
    listTenantCompanies()
      .then((data) => {
        setTenants(data);
        if (data.length > 0 && !selectedTenantId) {
          setSelectedTenantId(data[0].id);
        }
      })
      .catch((err) => console.error("Failed to load companies:", err));
  }, [selectedTenantId]);

  // Load Modules when selected tenant changes
  const loadModules = useCallback((companyId: string) => {
    if (!companyId) return;
    setModulesLoading(true);
    listCompanyModules(companyId)
      .then((mods) => {
        setCompanyModules(mods);
      })
      .catch((err) => console.error("Failed to load modules:", err))
      .finally(() => setModulesLoading(false));
  }, []);

  useEffect(() => {
    if (selectedTenantId) {
      loadModules(selectedTenantId);
    }
  }, [selectedTenantId, loadModules]);

  // Handle Profile Update
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    setProfileSaving(true);
    setProfileError("");
    setProfileSuccess(false);

    try {
      const updated = await updateMyProfile(fullName.trim());
      if (customAvatarUrl) {
        localStorage.setItem("corbel_dev_avatar", customAvatarUrl);
      } else {
        localStorage.removeItem("corbel_dev_avatar");
      }
      window.dispatchEvent(new Event("corbel_avatar_updated"));

      setProfileSuccess(true);
      if (onUserUpdated) {
        onUserUpdated(updated);
      }
      setTimeout(() => setProfileSuccess(false), 3500);
    } catch (err) {
      setProfileError(getErrorMessage(err));
    } finally {
      setProfileSaving(false);
    }
  };

  // Handle App Updates
  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await checkForUpdates();
      setUpdateResult(res);
    } catch (err) {
      setUpdateError(getErrorMessage(err));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    setUpdateError(null);
    try {
      await installUpdate();
    } catch (err) {
      setUpdateError(getErrorMessage(err));
      setInstallingUpdate(false);
    }
  };

  // Toggle Module
  const handleToggleModule = async (moduleKey: string, currentEnabled: boolean) => {
    if (!selectedTenantId) return;
    setModuleActionLoading(moduleKey);
    setGovernanceFeedback(null);

    try {
      const updated = await setCompanyModule({
        companyId: selectedTenantId,
        moduleKey,
        isEnabled: !currentEnabled,
      });

      setCompanyModules((prev) => {
        const idx = prev.findIndex((m) => m.moduleKey === moduleKey);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [...prev, updated];
      });

      setGovernanceFeedback(
        `Module "${moduleKey}" successfully ${!currentEnabled ? "enabled" : "disabled"}.`,
      );
      setTimeout(() => setGovernanceFeedback(null), 3500);
    } catch (err) {
      setGovernanceFeedback(`Failed to update module: ${getErrorMessage(err)}`);
    } finally {
      setModuleActionLoading(null);
    }
  };

  const isModuleEnabled = (moduleKey: string) => {
    const mod = companyModules.find((m) => m.moduleKey === moduleKey);
    // default core modules to enabled if not found
    if (!mod) {
      return ["pos", "inventory", "invoices", "ledger"].includes(moduleKey);
    }
    return mod.isEnabled;
  };

  return (
    <div
      style={{
        padding: "32px 42px 64px",
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      {/* Editorial Header */}
      <div style={{ marginBottom: 28 }}>
        <Group justify="space-between" align="baseline">
          <div>
            <Text
              fw={800}
              size="xl"
              style={{ color: SA.text, letterSpacing: -0.5, fontSize: 26 }}
            >
              Super Admin Control Center
            </Text>
            <Text size="sm" mt={3} style={{ color: SA.muted }}>
              Manage personal identity, configure client ERP/CRM modules, and govern platform security.
            </Text>
          </div>
          <Badge
            variant="light"
            radius="xl"
            styles={{
              root: {
                background: `${SA.accent}14`,
                color: SA.accent,
                fontWeight: 700,
                padding: "6px 14px",
                height: "auto",
              },
            }}
          >
            Sovereign Authority Active
          </Badge>
        </Group>
      </div>

      {/* Navigation Tabs */}
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        styles={{
          root: { marginBottom: 24 },
          list: {
            borderBottom: `1px solid ${SA.border}`,
            gap: 12,
          },
          tab: {
            background: "transparent",
            color: SA.muted,
            fontWeight: 700,
            fontSize: 14,
            padding: "10px 18px",
            border: "none",
            borderBottom: "2px solid transparent",
            borderRadius: 0,
            "&[data-active]": {
              color: SA.accent,
              borderBottomColor: SA.accent,
            },
            "&:hover": {
              color: SA.text,
              background: "transparent",
            },
          },
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="profile" leftSection={<User size={16} />}>
            Admin Profile & Identity
          </Tabs.Tab>
          <Tabs.Tab value="erpcrm" leftSection={<Briefcase size={16} />}>
            ERP & CRM Module Governance
          </Tabs.Tab>
          <Tabs.Tab value="system" leftSection={<Palette size={16} />}>
            System Preferences & Security
          </Tabs.Tab>
          <Tabs.Tab value="updater" leftSection={<Download size={16} />}>
            App Updates & Releases
          </Tabs.Tab>
        </Tabs.List>

        {/* ============================================================== */}
        {/* TAB 1: SUPER ADMIN PROFILE & IDENTITY                          */}
        {/* ============================================================== */}
        <Tabs.Panel value="profile" pt="lg">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
            {/* Left: Profile Information */}
            <div
              style={{
                borderRadius: 22,
                padding: "28px 30px",
                background: SA.panel,
                border: `1px solid ${SA.border}`,
                boxShadow: SA.shadow,
              }}
            >
              <Group gap={14} mb="lg">
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `${SA.accent}18`,
                    color: SA.accent,
                  }}
                >
                  <User size={22} />
                </div>
                <div>
                  <Text fw={750} size="md" style={{ color: SA.text, fontSize: 16 }}>
                    Sovereign Administrator Profile
                  </Text>
                  <Text size="xs" style={{ color: SA.muted }}>
                    Your identity across all tenant instances and audit trails
                  </Text>
                </div>
              </Group>

              {profileSuccess && (
                <Alert
                  icon={<CheckCircle2 size={16} />}
                  color="teal"
                  variant="light"
                  radius="md"
                  mb="md"
                  styles={{ root: { background: `${SA.accent}14`, color: SA.accent } }}
                >
                  Profile updated successfully.
                </Alert>
              )}

              {profileError && (
                <Alert
                  icon={<AlertCircle size={16} />}
                  color="red"
                  variant="light"
                  radius="md"
                  mb="md"
                  styles={{ root: { color: SA.danger } }}
                >
                  {profileError}
                </Alert>
              )}

              <form onSubmit={handleSaveProfile}>
                <Stack gap="md">
                  <div>
                    <Text size="xs" fw={700} mb={8} style={{ color: SA.textSoft }}>
                      Avatar & Visual Identity
                    </Text>
                    <Group gap={14} align="center" mb={10}>
                      <Avatar
                        src={customAvatarUrl || undefined}
                        size={52}
                        radius="md"
                        styles={{
                          root: {
                            border: `2px solid ${SA.accent}`,
                            background: `${SA.accent}14`,
                            color: SA.accent,
                            fontWeight: 800,
                            fontSize: 18,
                          },
                        }}
                      >
                        {!customAvatarUrl && fullName.slice(0, 1).toUpperCase()}
                      </Avatar>
                      <div style={{ flex: 1 }}>
                        <TextInput
                          placeholder="https://example.com/avatar.png or file path"
                          value={customAvatarUrl}
                          onChange={(e) => setCustomAvatarUrl(e.target.value)}
                          description="Custom image URL or file path for developer profile avatar"
                          styles={{
                            input: {
                              borderRadius: 10,
                              border: `1px solid ${SA.border}`,
                              background: SA.panelStrong,
                              color: SA.text,
                              fontSize: 13,
                            },
                          }}
                        />
                      </div>
                    </Group>
                  </div>

                  <div>
                    <Text size="xs" fw={700} mb={6} style={{ color: SA.textSoft }}>
                      Mascot Quick Presets
                    </Text>
                    <Group gap="sm">
                      {AVATAR_OPTIONS.map((av) => (
                        <UnstyledButton
                          key={av.id}
                          onClick={() => {
                            setSelectedAvatar(av.id);
                            setCustomAvatarUrl("");
                          }}
                          style={{
                            padding: "8px 14px",
                            borderRadius: 12,
                            border: `2px solid ${
                              selectedAvatar === av.id && !customAvatarUrl ? SA.accent : SA.border
                            }`,
                            background:
                              selectedAvatar === av.id && !customAvatarUrl
                                ? `${SA.accent}14`
                                : SA.panelStrong,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          <av.icon
                            size={16}
                            color={selectedAvatar === av.id && !customAvatarUrl ? SA.accent : SA.text}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: selectedAvatar === av.id && !customAvatarUrl ? SA.accent : SA.text,
                            }}
                          >
                            {av.label}
                          </span>
                        </UnstyledButton>
                      ))}
                    </Group>
                  </div>

                  <TextInput
                    label="Full Name"
                    description="Official name registered on platform audit logs"
                    value={fullName}
                    onChange={(e) => setFullName(e.currentTarget.value)}
                    required
                    styles={{
                      input: {
                        borderRadius: 10,
                        border: `1px solid ${SA.border}`,
                        background: SA.panelStrong,
                        color: SA.text,
                        fontWeight: 600,
                      },
                    }}
                  />

                  <TextInput
                    label="Email Address"
                    value={user?.email || "taha@corbel.internal"}
                    disabled
                    description="Platform administrator root email"
                    styles={{
                      input: {
                        borderRadius: 10,
                        border: `1px solid ${SA.border}`,
                        background: SA.panelStrong,
                        color: SA.muted,
                        fontWeight: 500,
                      },
                    }}
                  />

                  <TextInput
                    label="Authority Role"
                    value="Sovereign Super Administrator"
                    disabled
                    description="Unrestricted governance over all 5 client ERP databases"
                    styles={{
                      input: {
                        borderRadius: 10,
                        border: `1px solid ${SA.border}`,
                        background: SA.panelStrong,
                        color: SA.muted,
                        fontWeight: 500,
                      },
                    }}
                  />

                  <Button
                    type="submit"
                    loading={profileSaving}
                    leftSection={<Save size={15} />}
                    styles={{
                      root: {
                        background: SA.accent,
                        color: "#FFFFFF",
                        fontWeight: 700,
                        borderRadius: 10,
                        height: 42,
                        marginTop: 6,
                        boxShadow: `0 8px 20px -4px rgba(224, 114, 95, 0.35)`,
                        "&:hover": { filter: "brightness(0.92)" },
                      },
                    }}
                  >
                    Save Profile Changes
                  </Button>
                </Stack>
              </form>
            </div>

            {/* Right: Security & Password Update */}
            <PasswordCard />
          </SimpleGrid>
        </Tabs.Panel>

        {/* ============================================================== */}
        {/* TAB 2: ENTERPRISE ERP & CRM GOVERNANCE                        */}
        {/* ============================================================== */}
        <Tabs.Panel value="erpcrm" pt="lg">
          <div
            style={{
              borderRadius: 22,
              padding: "28px 32px",
              background: SA.panel,
              border: `1px solid ${SA.border}`,
              boxShadow: SA.shadow,
              marginBottom: 24,
            }}
          >
            {/* Header with Tenant Selector */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 16,
                marginBottom: 22,
                paddingBottom: 20,
                borderBottom: `1px solid ${SA.border}`,
              }}
            >
              <div>
                <Group gap={12}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: `${SA.accent}18`,
                      color: SA.accent,
                    }}
                  >
                    <Briefcase size={22} />
                  </div>
                  <div>
                    <Text fw={750} size="md" style={{ color: SA.text, fontSize: 16 }}>
                      ERP & CRM Module Authority
                    </Text>
                    <Text size="xs" style={{ color: SA.muted }}>
                      Toggle operational business suites across sovereign tenant companies
                    </Text>
                  </div>
                </Group>
              </div>

              {/* Company Picker */}
              <div style={{ minWidth: 280 }}>
                <Select
                  label="Select Client Company"
                  placeholder="Choose company..."
                  data={tenants.map((t) => ({
                    value: t.id,
                    label: `${t.name} (${t.packageName || "Standard"})`,
                  }))}
                  value={selectedTenantId}
                  onChange={(val) => val && setSelectedTenantId(val)}
                  styles={{
                    input: {
                      borderRadius: 10,
                      border: `1px solid ${SA.border}`,
                      background: SA.panelStrong,
                      color: SA.text,
                      fontWeight: 600,
                    },
                  }}
                />
              </div>
            </div>

            {governanceFeedback && (
              <Alert
                icon={<CheckCircle2 size={16} />}
                color="teal"
                variant="light"
                radius="md"
                mb="lg"
                styles={{ root: { background: `${SA.accent}14`, color: SA.accent } }}
              >
                {governanceFeedback}
              </Alert>
            )}

            {/* Module Suite 1: Core ERP Systems */}
            <div style={{ marginBottom: 32 }}>
              <Group gap="xs" mb="sm">
                <Text fw={800} size="sm" style={{ color: SA.text, fontSize: 15 }}>
                  Enterprise ERP Modules
                </Text>
                <Badge size="xs" variant="outline" color="gray">
                  Core Operations
                </Badge>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {ERP_MODULE_DEFS.map((mod) => {
                  const Icon = mod.icon;
                  const enabled = isModuleEnabled(mod.key);
                  const isUpdating = moduleActionLoading === mod.key;

                  return (
                    <div
                      key={mod.key}
                      style={{
                        padding: "16px 20px",
                        borderRadius: 16,
                        background: SA.panelStrong,
                        border: `1px solid ${enabled ? `${SA.accent}44` : SA.border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <Group gap={14} style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 10,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: enabled ? `${SA.accent}18` : "rgba(0,0,0,0.04)",
                            color: enabled ? SA.accent : SA.muted,
                            flexShrink: 0,
                          }}
                        >
                          <Icon size={19} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <Text fw={700} size="sm" style={{ color: SA.text, fontSize: 13 }} truncate>
                            {mod.name}
                          </Text>
                          <Text size="xs" style={{ color: SA.muted, fontSize: 11 }} truncate>
                            {mod.desc}
                          </Text>
                        </div>
                      </Group>

                      <Switch
                        checked={enabled}
                        disabled={isUpdating || modulesLoading}
                        onChange={() => handleToggleModule(mod.key, enabled)}
                        color="orange"
                        styles={{
                          track: {
                            backgroundColor: enabled ? SA.accent : undefined,
                            borderColor: enabled ? SA.accent : undefined,
                            cursor: "pointer",
                          },
                        }}
                      />
                    </div>
                  );
                })}
              </SimpleGrid>
            </div>

            {/* Module Suite 2: CRM & Intelligence Systems */}
            <div>
              <Group gap="xs" mb="sm">
                <Text fw={800} size="sm" style={{ color: SA.text, fontSize: 15 }}>
                  Customer CRM & Intelligence Modules
                </Text>
                <Badge size="xs" variant="outline" color="gray">
                  Customer & Growth
                </Badge>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {CRM_MODULE_DEFS.map((mod) => {
                  const Icon = mod.icon;
                  const enabled = isModuleEnabled(mod.key);
                  const isUpdating = moduleActionLoading === mod.key;

                  return (
                    <div
                      key={mod.key}
                      style={{
                        padding: "16px 20px",
                        borderRadius: 16,
                        background: SA.panelStrong,
                        border: `1px solid ${enabled ? `${SA.accent}44` : SA.border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <Group gap={14} style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 10,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: enabled ? `${SA.accent}18` : "rgba(0,0,0,0.04)",
                            color: enabled ? SA.accent : SA.muted,
                            flexShrink: 0,
                          }}
                        >
                          <Icon size={19} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <Text fw={700} size="sm" style={{ color: SA.text, fontSize: 13 }} truncate>
                            {mod.name}
                          </Text>
                          <Text size="xs" style={{ color: SA.muted, fontSize: 11 }} truncate>
                            {mod.desc}
                          </Text>
                        </div>
                      </Group>

                      <Switch
                        checked={enabled}
                        disabled={isUpdating || modulesLoading}
                        onChange={() => handleToggleModule(mod.key, enabled)}
                        color="orange"
                        styles={{
                          track: {
                            backgroundColor: enabled ? SA.accent : undefined,
                            borderColor: enabled ? SA.accent : undefined,
                            cursor: "pointer",
                          },
                        }}
                      />
                    </div>
                  );
                })}
              </SimpleGrid>
            </div>
          </div>
        </Tabs.Panel>

        {/* ============================================================== */}
        {/* TAB 3: SYSTEM PREFERENCES & APPEARANCE                         */}
        {/* ============================================================== */}
        <Tabs.Panel value="system" pt="lg">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            {/* Theme Card */}
            <div
              style={{
                borderRadius: 22,
                padding: "24px 26px",
                background: SA.panel,
                border: `1px solid ${SA.border}`,
                boxShadow: SA.shadow,
              }}
            >
              <Group gap={14} mb="md">
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `${SA.accent}14`,
                    color: SA.accent,
                  }}
                >
                  <Palette size={20} />
                </div>
                <div>
                  <Text fw={700} size="md" style={{ color: SA.text }}>
                    Visual Environment
                  </Text>
                  <Text size="xs" style={{ color: SA.muted }}>
                    Stationery oatmeal palette
                  </Text>
                </div>
              </Group>

              <Stack gap={8}>
                {[
                  { id: "light" as const, label: "Warm Linen (Light)", icon: <Sun size={16} /> },
                  { id: "dark" as const, label: "Midnight Clay (Dark)", icon: <Moon size={16} /> },
                ].map((opt) => {
                  const active = scheme === opt.id;
                  return (
                    <UnstyledButton
                      key={opt.id}
                      onClick={() => setScheme(opt.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 18px",
                        borderRadius: 12,
                        border: `1px solid ${active ? SA.accent : SA.border}`,
                        background: active ? `${SA.accent}14` : SA.panelStrong,
                        color: active ? SA.accent : SA.textSoft,
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <Group gap={8}>
                        {opt.icon}
                        <span>{opt.label}</span>
                      </Group>
                      {active && <Check size={16} />}
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </div>

            {/* Language & Locale */}
            <div
              style={{
                borderRadius: 22,
                padding: "24px 26px",
                background: SA.panel,
                border: `1px solid ${SA.border}`,
                boxShadow: SA.shadow,
              }}
            >
              <Group gap={14} mb="md">
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `${SA.accent}14`,
                    color: SA.accent,
                  }}
                >
                  <Languages size={20} />
                </div>
                <div>
                  <Text fw={700} size="md" style={{ color: SA.text }}>
                    Platform Language
                  </Text>
                  <Text size="xs" style={{ color: SA.muted }}>
                    Interface & fiscal reports localization
                  </Text>
                </div>
              </Group>

              <Stack gap={8}>
                {LANGUAGE_ORDER.map((code) => {
                  const active = lang === code;
                  return (
                    <UnstyledButton
                      key={code}
                      onClick={() => setLang(code)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 18px",
                        borderRadius: 12,
                        border: `1px solid ${active ? SA.accent : SA.border}`,
                        background: active ? `${SA.accent}14` : SA.panelStrong,
                        color: active ? SA.accent : SA.textSoft,
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <span>{LANGUAGES[code].label}</span>
                      {active && <Check size={16} />}
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </div>
          </SimpleGrid>
        </Tabs.Panel>

        {/* ============================================================== */}
        {/* TAB 4: DESKTOP APP UPDATES & RELEASE CHANNELS                  */}
        {/* ============================================================== */}
        <Tabs.Panel value="updater" pt="lg">
          <div
            style={{
              borderRadius: 22,
              padding: "28px 32px",
              background: SA.panel,
              border: `1px solid ${SA.border}`,
              boxShadow: SA.shadow,
              maxWidth: 760,
            }}
          >
            <Group justify="space-between" align="flex-start" mb="lg">
              <Group gap={14}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `${SA.accent}18`,
                    color: SA.accent,
                  }}
                >
                  <Download size={22} />
                </div>
                <div>
                  <Text fw={750} size="md" style={{ color: SA.text, fontSize: 16 }}>
                    Desktop Application Updates
                  </Text>
                  <Text size="xs" style={{ color: SA.muted }}>
                    Native Tauri binary lifecycle & auto-update distribution
                  </Text>
                </div>
              </Group>
              <Badge
                variant="outline"
                color="orange"
                styles={{ root: { fontWeight: 700 } }}
              >
                v1.3.1 · Sovereign
              </Badge>
            </Group>

            <div
              style={{
                padding: "16px 20px",
                borderRadius: 14,
                background: SA.panelStrong,
                border: `1px solid ${SA.border}`,
                marginBottom: 20,
              }}
            >
              <Group justify="space-between" mb={8}>
                <Text size="xs" fw={700} style={{ color: SA.text }}>
                  Active Desktop Binary:
                </Text>
                <Text size="xs" style={{ color: SA.muted, fontFamily: "monospace" }}>
                  corbel-erp-linux-x86_64
                </Text>
              </Group>
              <Group justify="space-between" mb={8}>
                <Text size="xs" fw={700} style={{ color: SA.text }}>
                  Updater Engine:
                </Text>
                <Text size="xs" style={{ color: SA.muted, fontFamily: "monospace" }}>
                  tauri-plugin-updater
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" fw={700} style={{ color: SA.text }}>
                  Distribution Target:
                </Text>
                <Text size="xs" style={{ color: SA.accent, fontFamily: "monospace" }}>
                  TheFoolishCrow/corbel-erp
                </Text>
              </Group>
            </div>

            {updateError && (
              <Alert
                icon={<AlertCircle size={16} />}
                color="red"
                variant="light"
                radius="md"
                mb="md"
                styles={{ root: { color: SA.danger } }}
              >
                {updateError}
              </Alert>
            )}

            {updateResult && (
              <div
                style={{
                  padding: "18px 20px",
                  borderRadius: 14,
                  background: updateResult.available ? `${SA.accent}14` : SA.panelStrong,
                  border: `1px solid ${updateResult.available ? SA.accent : SA.border}`,
                  marginBottom: 20,
                }}
              >
                {updateResult.available ? (
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text fw={800} size="sm" style={{ color: SA.accent }}>
                        New Version Available: v{updateResult.update?.version}
                      </Text>
                      <Badge color="orange">Ready to Install</Badge>
                    </Group>
                    {updateResult.update?.body && (
                      <Text size="xs" style={{ color: SA.text, whiteSpace: "pre-wrap" }}>
                        {updateResult.update.body}
                      </Text>
                    )}
                    <Button
                      loading={installingUpdate}
                      onClick={handleInstallUpdate}
                      leftSection={<Download size={14} />}
                      styles={{
                        root: {
                          background: SA.accent,
                          color: "#FFFFFF",
                          fontWeight: 700,
                          borderRadius: 10,
                          marginTop: 8,
                        },
                      }}
                    >
                      Download & Install Update (Auto-Restart)
                    </Button>
                  </Stack>
                ) : (
                  <Group gap={12}>
                    <CheckCircle2 size={20} color={SA.accent} />
                    <div>
                      <Text fw={750} size="sm" style={{ color: SA.text }}>
                        You are running the latest version (v{updateResult.currentVersion})
                      </Text>
                      <Text size="xs" style={{ color: SA.muted }}>
                        No pending binary updates found on release endpoint.
                      </Text>
                    </div>
                  </Group>
                )}
              </div>
            )}

            <Button
              loading={checkingUpdate}
              onClick={handleCheckUpdate}
              leftSection={<RefreshCw size={15} />}
              styles={{
                root: {
                  background: SA.panelStrong,
                  color: SA.text,
                  border: `1px solid ${SA.border}`,
                  fontWeight: 700,
                  borderRadius: 10,
                  height: 42,
                  "&:hover": { background: SA.accent, color: "#FFFFFF" },
                },
              }}
            >
              Check for Software Updates
            </Button>
          </div>
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}

// ==========================================
// PASSWORD CHANGE COMPONENT
// ==========================================
function PasswordCard() {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword.length < 8) {
      setError(t("sa.settings.passwordMinLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("sa.settings.passwordsDoNotMatch"));
      return;
    }

    setLoading(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        borderRadius: 22,
        padding: "28px 30px",
        background: SA.panel,
        border: `1px solid ${SA.border}`,
        boxShadow: SA.shadow,
      }}
    >
      <Group gap={14} mb="lg">
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${SA.accent}18`,
            color: SA.accent,
          }}
        >
          <KeyRound size={22} />
        </div>
        <div>
          <Text fw={750} size="md" style={{ color: SA.text, fontSize: 16 }}>
            Security & Authentication
          </Text>
          <Text size="xs" style={{ color: SA.muted }}>
            Update administrator master password
          </Text>
        </div>
      </Group>

      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          {error && (
            <Alert
              icon={<AlertCircle size={15} />}
              color="red"
              variant="light"
              radius="md"
              styles={{ root: { color: SA.danger } }}
            >
              {error}
            </Alert>
          )}

          {success && (
            <Alert
              icon={<CheckCircle2 size={15} />}
              color="teal"
              variant="light"
              radius="md"
              styles={{ root: { background: `${SA.accent}14`, color: SA.accent } }}
            >
              Password updated successfully.
            </Alert>
          )}

          <PasswordInput
            label="Current Master Password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            required
            styles={{
              input: {
                borderRadius: 10,
                border: `1px solid ${SA.border}`,
                background: SA.panelStrong,
                color: SA.text,
              },
            }}
          />

          <PasswordInput
            label="New Master Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            required
            styles={{
              input: {
                borderRadius: 10,
                border: `1px solid ${SA.border}`,
                background: SA.panelStrong,
                color: SA.text,
              },
            }}
          />

          <PasswordInput
            label="Confirm New Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            required
            styles={{
              input: {
                borderRadius: 10,
                border: `1px solid ${SA.border}`,
                background: SA.panelStrong,
                color: SA.text,
              },
            }}
          />

          <Button
            type="submit"
            loading={loading}
            styles={{
              root: {
                background: SA.panelStrong,
                color: SA.text,
                border: `1px solid ${SA.border}`,
                fontWeight: 700,
                borderRadius: 10,
                height: 42,
                marginTop: 6,
                "&:hover": { background: SA.accent, color: "#FFFFFF" },
              },
            }}
          >
            Update Master Password
          </Button>
        </Stack>
      </form>
    </div>
  );
}
