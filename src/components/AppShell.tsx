// ==========================================
// APP SHELL — Modern ERP Layout
// ==========================================
// Dark navy sidebar + animated navigation + content area
// with smooth framer-motion page transitions.

import { useEffect, useState } from "react";
import {
  AnimatePresence,
  motion,
  type Variants,
} from "framer-motion";

import {
  Avatar,
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";

import RightContextPanel from "../features/dashboard/RightContextPanel";

import {
  LayoutDashboard,
  Package,
  ReceiptText,
  ShoppingCart,
  ChartPie,
  Users,
  BookOpen,
  LogOut,
  DatabaseBackup,
  Settings2,
  Download,
  ContactRound,
  Moon,
  Sun,
  CircleHelp,
  FileSpreadsheet,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import {
  createBackup,
  getCompany,
  getErrorMessage,
  getTheme,
  saveFileDialog,
  type CompanyTheme,
} from "../api/backend";
import { checkForUpdates, installUpdate, type UpdateResult } from "../api/updater";
import type { PublicUser, UserRole, LicenseStatusResponse } from "../types/backend";
import { MigrationGraceBanner } from "../features/licensing/MigrationGraceBanner";

import DashboardHome from "../features/dashboard/DashboardPage";
import InventoryPage from "../features/inventory/InventoryPage";
import ImportWizard from "../features/inventory/ImportWizard";
import InvoicePage from "../features/invoices/InvoicePage";
import PurchaseOrderPage from "../features/purchase-orders/PurchaseOrderPage";
import ReportsPage from "../features/reports/ReportsPage";
import UserManagementView from "../features/dashboard/UserManagement";
import SettingsPage from "../features/settings/SettingsPage";
import CustomersPage from "../features/customers/CustomersPage";
import AccountsPage from "../features/accounts/AccountsPage";
import SearchBar from "./SearchBar";
import NotificationBell from "./NotificationBell";
import HelpMenu from "./HelpMenu";
import LanguageMenu from "./LanguageMenu";
import { CorbelMark } from "./CorbelLogo";
import HelpPage from "../features/help/HelpPage";
import ProfilePage from "../features/profile/ProfilePage";
import ModuleLockedView from "./ModuleLockedView";
import { INK } from "../theme";
import { useAppTheme } from "../theme/AppThemeProvider";
import { useI18n } from "../i18n/I18nProvider";
import { useOnboarding } from "../onboarding/OnboardingProvider";
import { usePermissions } from "../features/permissions/PermissionsProvider";
import { reportOnboardingEvent } from "../onboarding/bus";

// ==========================================
// NAV MODEL
// ==========================================

export type DashboardView =
  | "home"
  | "inventory"
  | "import"
  | "invoices"
  | "customers"
  | "purchasing"
  | "reports"
  | "accounts"
  | "users"
  | "settings"
  | "help"
  | "profile";

export const VIEW_TO_MODULE: Record<DashboardView, string | null> = {
  home: "dashboard",
  inventory: "inventory",
  invoices: "invoices",
  customers: "customers",
  purchasing: "purchase_orders",
  import: "import",
  reports: "reports",
  accounts: "ledger",
  users: "users",
  settings: "settings",
  profile: null,
  help: null,
};

const NAV_ITEMS: {
  key: DashboardView;
  label: string;
  description: string;
  icon: React.ReactNode;
  roles: UserRole[];
  /** Permission module that gates this item's visibility (needs view). */
  module?: string;
}[] = [
  {
    key: "home",
    label: "Dashboard",
    description: "Overview & analytics",
    icon: <LayoutDashboard size={18} />,
    roles: ["owner", "admin", "employee"],
    module: "dashboard",
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Products, stock & suppliers",
    icon: <Package size={18} />,
    roles: ["owner", "admin", "employee"],
    module: "inventory",
  },
  {
    key: "invoices",
    label: "Invoices",
    description: "Bills, payments & customers",
    icon: <ReceiptText size={18} />,
    roles: ["owner", "admin", "employee"],
    module: "invoices",
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer directory & accounts",
    icon: <ContactRound size={18} />,
    roles: ["owner", "admin", "employee"],
    module: "customers",
  },
  {
    key: "purchasing",
    label: "Purchasing",
    description: "Purchase orders from suppliers",
    icon: <ShoppingCart size={18} />,
    roles: ["owner", "admin", "employee"],
    module: "purchase_orders",
  },
  {
    key: "import",
    label: "Import",
    description: "Import customers, products & more from Excel/CSV",
    icon: <FileSpreadsheet size={18} />,
    roles: ["owner", "admin"],
    module: "import",
  },
  {
    key: "reports",
    label: "Reports",
    description: "Sales, stock & profit analytics",
    icon: <ChartPie size={18} />,
    roles: ["owner", "admin", "employee"],
    module: "reports",
  },
  {
    key: "accounts",
    label: "Accounts",
    description: "Chart of accounts & journal",
    icon: <BookOpen size={18} />,
    roles: ["owner", "admin", "employee"],
    module: "ledger",
  },
  {
    key: "users",
    label: "Team",
    description: "Manage company users",
    icon: <Users size={18} />,
    roles: ["owner", "admin"],
    module: "users",
  },
  {
    key: "settings",
    label: "Settings",
    description: "Profile, invoices, backups & audit",
    icon: <Settings2 size={18} />,
    roles: ["owner", "admin", "employee"],
    module: "settings",
  },
  {
    key: "help",
    label: "Help",
    description: "How to use this software",
    icon: <CircleHelp size={18} />,
    roles: ["owner", "admin", "employee"],
  },
];

const ROLE_COLORS: Record<string, string> = {
  owner: "gold",
  admin: "blue",
  employee: "teal",
};

// ==========================================
// BRANDING HELPERS
// ==========================================

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function contrastText(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#131C39" : "#FFFFFF";
}

const DEFAULT_PRIMARY = "#C9952A";
const DEFAULT_SECONDARY = "#E6C965";

type Branding = {
  companyName: string;
  theme: CompanyTheme | null;
};

// ==========================================
// PAGE TRANSITION VARIANTS
// ==========================================

const pageVariants: Variants = {
  initial: { opacity: 0, y: 14, scale: 0.995 },
  enter: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    y: -10,
    scale: 0.995,
    transition: { duration: 0.18, ease: [0.4, 0, 1, 1] },
  },
};

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function AppShell({
  user,
  onLogout,
  licenseStatus,
  onLicenseStatusUpdate,
}: {
  user: PublicUser;
  onLogout: () => Promise<void>;
  licenseStatus?: LicenseStatusResponse | null;
  onLicenseStatusUpdate?: (updated: LicenseStatusResponse) => void;
}) {
  const [view, setView] = useState<DashboardView>("home");
  const [prevView, setPrevView] = useState<DashboardView>("home");
  const [backing, setBacking] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [branding, setBranding] = useState<Branding>({
    companyName: "Corbel",
    theme: null,
  });
  const { isDark, toggleColorScheme, setActiveUserId } = useAppTheme();
  const { t, lang } = useI18n();
  const { startReplay } = useOnboarding();
  const perms = usePermissions();

  useEffect(() => {
    if (user?.id) {
      setActiveUserId(user.id);
    }
  }, [user?.id, setActiveUserId]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("corbel_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("corbel_sidebar_collapsed", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    Promise.all([getCompany(), getTheme()])
      .then(([company, theme]) => {
        setBranding({ companyName: company.name, theme });
      })
      .catch(() => {
        // Keep default branding if the theme/company cannot be loaded.
      });
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent;
      if (custom?.detail) {
        setBranding((prev) => ({ ...prev, theme: custom.detail }));
      }
    };
    window.addEventListener("corbel_theme_updated", handler);
    return () => window.removeEventListener("corbel_theme_updated", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    checkForUpdates().then((result) => {
      if (!cancelled) setUpdateResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Navigate between modules; the onboarding listens for these events to know
  // when a "navigate to X" task step has been performed. Remember the view we
  // came from so the Import Wizard's back action can return there.
  function goTo(nextView: DashboardView) {
    if (nextView === "import" && view !== "import") setPrevView(view);
    setView(nextView);
    reportOnboardingEvent({ type: "navigate", module: nextView });
  }

  // ----- branding + theme setup ----
  const updateAvailable =
    updateResult?.available && updateResult.update != null;

  async function handleInstallUpdate() {
    setInstalling(true);
    setUpdateMsg(null);
    try {
      await installUpdate();
      setUpdateMsg(t("update.installing"));
    } catch (err) {
      setUpdateMsg(`Error: ${getErrorMessage(err)}`);
    } finally {
      setInstalling(false);
    }
  }

  const navItems = NAV_ITEMS.filter(
    (item) =>
      item.roles.includes(user.role) &&
      (!item.module || perms.can(item.module, "view")) &&
      (!item.module || perms.isModuleEnabled(item.module)),
  );



  async function handleBackup() {
    setBacking(true);
    setBackupMsg(null);
    try {
      const savePath = await saveFileDialog({
        title: t("backup.title"),
        defaultPath: `backup-${new Date().toISOString().slice(0, 10)}.db`,
      });
      if (!savePath) return;
      const path = await createBackup(savePath);
      try {
        localStorage.setItem(`ijaz_backup_performed_${user.id}`, "true");
      } catch {
        // ignore
      }
      setBackupMsg(t("backup.success", { path }));
    } catch (err) {
      setBackupMsg(t("backup.error", { err: getErrorMessage(err) }));
    } finally {
      setBacking(false);
      setTimeout(() => setBackupMsg(null), 5000);
    }
  }

  const today = new Date().toLocaleDateString(lang === "ur" ? "ur-PK" : undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const theme = branding.theme;
  const primary = theme?.primaryColor ?? DEFAULT_PRIMARY;
  const secondary = theme?.secondaryColor ?? DEFAULT_SECONDARY;
  // The accent is the highlight color (default antique gold) and drives the
  // sidebar accents; primary/secondary form the brand gradient used on buttons.
  const accent =
    theme?.accentColor ??
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("corbel_company_accent")
      : null) ??
    DEFAULT_PRIMARY;
  const accentGradient = `linear-gradient(135deg, ${accent} 0%, ${accent} 100%)`;
  const brandGradient = `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`;
  const brandGlow = `0 6px 18px -6px ${hexToRgba(accent, 0.55)}`;
  const onAccent = contrastText(accent);
  const onPrimary = contrastText(primary);
  const logoImage = theme?.logoBase64 ?? null;
  const tagline = theme?.companyTagline ?? "ERP SUITE";

  return (
    <Box
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--app-bg)",
      }}
    >
      {/* ==================== SIDEBAR ==================== */}
      <Box
        component="aside"
        style={{
          width: sidebarCollapsed ? 72 : 240,
          transition: "width 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "var(--app-surface)",
          color: "var(--app-text)",
          borderRight: "1px solid var(--app-border)",
          boxShadow: "0 0 20px rgba(0, 0, 0, 0.02)",
        }}
      >
        {/* Brand & Toggle Header */}
        {!sidebarCollapsed ? (
          <Group justify="space-between" px="md" py="md">
            <Group gap="xs" style={{ overflow: "hidden" }}>
              <motion.div
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 220, damping: 14 }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  background: logoImage ? "transparent" : accentGradient,
                  color: onAccent,
                  fontWeight: 800,
                  fontSize: 15,
                  boxShadow: brandGlow,
                  flexShrink: 0,
                }}
              >
                {logoImage ? (
                  <img
                    src={logoImage}
                    alt={branding.companyName}
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }}
                  />
                ) : (
                  <CorbelMark size={22} variant="dark" />
                )}
              </motion.div>
              <Stack gap={0} style={{ overflow: "hidden" }}>
                <Text fw={800} size="sm" truncate style={{ letterSpacing: -0.2, lineHeight: 1.25 }}>
                  {branding.companyName}
                </Text>
                <Text size="xs" c="dimmed" truncate style={{ letterSpacing: 0.5, lineHeight: 1.2 }}>
                  {tagline}
                </Text>
              </Stack>
            </Group>
            <Tooltip label="Collapse sidebar" position="right">
              <ActionIcon variant="subtle" color="gray" radius="md" onClick={toggleSidebar}>
                <PanelLeftClose size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        ) : (
          <Stack align="center" py="md" gap="xs">
            <motion.div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                background: logoImage ? "transparent" : accentGradient,
                color: onAccent,
                fontWeight: 800,
                fontSize: 15,
                boxShadow: brandGlow,
              }}
            >
              {logoImage ? (
                <img
                  src={logoImage}
                  alt={branding.companyName}
                  style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 10 }}
                />
              ) : (
                <CorbelMark size={22} variant="dark" />
              )}
            </motion.div>
            <Tooltip label="Expand sidebar" position="right">
              <ActionIcon variant="subtle" color="gray" radius="md" onClick={toggleSidebar}>
                <PanelLeftOpen size={18} />
              </ActionIcon>
            </Tooltip>
          </Stack>
        )}

        {/* Nav list */}
        <ScrollArea offsetScrollbars style={{ flex: 1 }}>
          <Stack gap={4} px={sidebarCollapsed ? 8 : 10} data-tour="nav">
            {!sidebarCollapsed && (
              <Text
                size="xs"
                px="sm"
                pb={4}
                style={{ color: "var(--app-muted)", letterSpacing: 1.2, fontWeight: 700, fontSize: 11 }}
              >
                {t("nav.workspace")}
              </Text>
            )}
            {navItems.map((item, index) => {
              const active = view === item.key;
              const buttonContent = (
                <motion.button
                  key={item.key}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: 0.03 + index * 0.03,
                    ease: [0.22, 1, 0.36, 1],
                    duration: 0.25,
                  }}
                  onClick={() => goTo(item.key)}
                  data-tour={`nav-${item.key}`}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: sidebarCollapsed ? "center" : "flex-start",
                    gap: 12,
                    width: "100%",
                    padding: sidebarCollapsed ? "10px 0" : "10px 12px",
                    borderRadius: 12,
                    border: "none",
                    background: active ? "var(--app-hover)" : "transparent",
                    color: active ? "var(--app-accent)" : "var(--app-text-soft)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 13.5,
                    fontWeight: active ? 700 : 500,
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      background: active ? accentGradient : "var(--app-soft)",
                      color: active ? onAccent : "inherit",
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                  {!sidebarCollapsed && (
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t(`nav.${item.key}`)}
                    </span>
                  )}
                </motion.button>
              );

              if (sidebarCollapsed) {
                return (
                  <Tooltip key={item.key} label={t(`nav.${item.key}`)} position="right" withArrow offset={10}>
                    {buttonContent}
                  </Tooltip>
                );
              }
              return buttonContent;
            })}
          </Stack>
        </ScrollArea>


        {/* Sidebar footer — user card */}
        <Box px={sidebarCollapsed ? "xs" : "sm"} pb="sm">
          {!sidebarCollapsed ? (
            <Box
              style={{
                borderRadius: 14,
                padding: 10,
                background: "var(--app-soft)",
                border: "1px solid var(--app-border)",
              }}
            >
              <Tooltip label="View My Profile & Account" position="top">
                <Box
                  onClick={() => goTo("profile")}
                  style={{ cursor: "pointer" }}
                >
                  <Group justify="space-between" mb="xs" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap" style={{ overflow: "hidden" }}>
                      <Avatar
                        color={ROLE_COLORS[user.role]}
                        radius="xl"
                        size="sm"
                        style={{ fontWeight: 700 }}
                      >
                        {user.fullName.charAt(0).toUpperCase()}
                      </Avatar>
                      <Stack gap={0} style={{ overflow: "hidden" }}>
                        <Text size="xs" fw={700} truncate style={{ lineHeight: 1.2 }}>
                          {user.fullName}
                        </Text>
                        <Text size="11px" c="dimmed" truncate style={{ lineHeight: 1.2 }}>
                          {user.email}
                        </Text>
                      </Stack>
                    </Group>
                    <Badge
                      color={ROLE_COLORS[user.role]}
                      variant="light"
                      size="xs"
                      styles={{ label: { textTransform: "uppercase", fontSize: 10 } }}
                    >
                      {user.role}
                    </Badge>
                  </Group>
                </Box>
              </Tooltip>
              <Group gap={6} grow>
                <Button
                  variant="light"
                  size="xs"
                  radius="md"
                  leftSection={<Settings2 size={13} />}
                  onClick={() => goTo("profile")}
                >
                  My Profile
                </Button>
                <Button
                  variant="subtle"
                  color="red"
                  size="xs"
                  radius="md"
                  leftSection={<LogOut size={13} />}
                  onClick={onLogout}
                >
                  {t("sidebar.signOut")}
                </Button>
              </Group>
            </Box>
          ) : (
            <Stack align="center" gap="xs">
              <Tooltip label={`${user.fullName} (${user.role}) — View Profile`} position="right">
                <Avatar
                  color={ROLE_COLORS[user.role]}
                  radius="xl"
                  size="sm"
                  style={{ fontWeight: 700, cursor: "pointer" }}
                  onClick={() => goTo("profile")}
                >
                  {user.fullName.charAt(0).toUpperCase()}
                </Avatar>
              </Tooltip>
              <Tooltip label={t("sidebar.signOut")} position="right">
                <ActionIcon variant="subtle" color="red" radius="md" size="sm" onClick={onLogout}>
                  <LogOut size={15} />
                </ActionIcon>
              </Tooltip>
            </Stack>
          )}
        </Box>
      </Box>

      {/* ==================== CONTENT ==================== */}
      <Box style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100%", overflow: "hidden" }}>
        {licenseStatus && (
          <MigrationGraceBanner
            licenseStatus={licenseStatus}
            onStatusUpdate={onLicenseStatusUpdate ?? (() => {})}
          />
        )}
        {/* Top bar */}
        <Box
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 28px",
            borderBottom: "1px solid var(--app-border)",
            background: "color-mix(in srgb, var(--app-surface) 90%, transparent)",
            backdropFilter: "blur(12px)",
            position: "sticky",
            top: 0,
            zIndex: 40,
          }}
        >
          <Group gap="md" align="center">
            {sidebarCollapsed && (
              <ActionIcon variant="light" color="gray" radius="md" size="md" onClick={toggleSidebar} title="Expand sidebar">
                <PanelLeftOpen size={18} />
              </ActionIcon>
            )}
            <Box data-tour="topbar-search">
              <SearchBar
                onSelect={(result) => {
                  if (result.resultType === "product") goTo("inventory");
                  else if (result.resultType === "customer") goTo("customers");
                }}
              />
            </Box>
          </Group>

          <Group gap="sm" wrap="nowrap">
            <Text size="xs" fw={500} c="dimmed" style={{ whiteSpace: "nowrap" }} visibleFrom="sm">
              {today}
            </Text>
            {backupMsg && (
              <Text size="xs" c={backupMsg.startsWith("Error") ? "red" : "green"}>
                {backupMsg}
              </Text>
            )}
            {updateAvailable && updateResult?.update && (
              <Tooltip
                label={t("topbar.updateAvailable", { v: updateResult.update.version })}
              >
                <Button
                  variant="filled"
                  size="xs"
                  leftSection={<Download size={14} />}
                  onClick={() => setUpdateOpen(true)}
                  styles={{
                    root: {
                      fontWeight: 700,
                      background: brandGradient,
                      color: onPrimary,
                      "&:hover": { filter: "brightness(1.06)" },
                    },
                  }}
                >
                  {t("topbar.update", { version: updateResult.update.version })}
                </Button>
              </Tooltip>
            )}
            <Tooltip label={isDark ? t("topbar.themeTooltipLight") : t("topbar.themeTooltipDark")}>
              <ActionIcon
                variant="light"
                size="lg"
                radius="md"
                onClick={toggleColorScheme}
                aria-label="Toggle color scheme"
                style={{
                  color: accent,
                  background: hexToRgba(accent, isDark ? 0.16 : 0.10),
                  border: `1px solid ${hexToRgba(accent, 0.25)}`,
                }}
              >
                {isDark ? <Sun size={17} /> : <Moon size={17} />}
              </ActionIcon>
            </Tooltip>
            <Box data-tour="topbar-notifications">
              <NotificationBell onNavigate={(view) => goTo(view)} />
            </Box>
            <Tooltip label={t("topbar.backupTooltip")}>
              <Button
                variant="light"
                size="sm"
                leftSection={<DatabaseBackup size={15} />}
                onClick={handleBackup}
                loading={backing}
                data-tour="topbar-backup"
                styles={{ root: { fontWeight: 600 } }}
              >
                {t("topbar.backup")}
              </Button>
            </Tooltip>
            <HelpMenu
              onOpenDocs={() => goTo("help")}
              onReplayTour={() => startReplay()}
            />
            <LanguageMenu />
          </Group>
        </Box>

        {/* Animated page container */}
        <Box style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }} data-tour="content">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              variants={pageVariants}
              initial="initial"
              animate="enter"
              exit="exit"
              style={{ padding: 28, minHeight: "100%" }}
            >
              {(() => {
                const targetModule = VIEW_TO_MODULE[view];
                const isLocked = targetModule ? !perms.isModuleEnabled(targetModule) : false;
                if (isLocked) {
                  return <ModuleLockedView moduleKey={view} onBack={() => goTo("home")} />;
                }
                return (
                  <>
                    {view === "home" && (
                <Box
                  style={{
                    display: "flex",
                    gap: 28,
                    minHeight: "100%",
                    alignItems: "flex-start",
                  }}
                >
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <DashboardHome user={user} onNavigate={(m) => goTo(m as DashboardView)} />
                  </Box>
                  <Box visibleFrom="lg" style={{ width: 300, flexShrink: 0 }}>
                    <RightContextPanel
                      user={user}
                      onNavigate={(m) => goTo(m as DashboardView)}
                      onTriggerBackup={handleBackup}
                    />
                  </Box>
                </Box>
              )}
              {view === "inventory" && (
                <InventoryPage user={user} onOpenImport={() => goTo("import")} />
              )}
              {view === "import" && (
                <ImportWizard
                  user={user}
                  backLabel={t("import.backTo", { view: t(`nav.${prevView}`) })}
                  onComplete={() => goTo(prevView)}
                />
              )}
              {view === "invoices" && <InvoicePage />}
              {view === "customers" && <CustomersPage user={user} />}
              {view === "purchasing" && <PurchaseOrderPage />}
              {view === "reports" && <ReportsPage />}
              {view === "accounts" && <AccountsPage />}
              {view === "users" && <UserManagementView currentUser={user} />}
              {view === "settings" && (
                <SettingsPage user={user} onLogout={onLogout} />
              )}
              {view === "profile" && (
                <ProfilePage
                  user={user}
                  onBack={() => goTo("home")}
                  onLogout={onLogout}
                />
              )}
              {view === "help" && (
                <HelpPage companyName={branding.companyName} />
              )}
                  </>
                );
              })()}
            </motion.div>
          </AnimatePresence>
        </Box>
      </Box>

      {/* Update modal */}
      <Modal
        opened={updateOpen}
        onClose={() => setUpdateOpen(false)}
        title={t("update.title")}
        centered
        styles={{ title: { fontWeight: 800, color: INK.text } }}
      >
        <Stack gap="md">
          <Text size="sm">
            {t("update.bodyIntro", {
              v: updateResult?.update?.version ?? "",
              current: updateResult?.currentVersion ?? "",
            })}
          </Text>
          {updateResult?.update?.body && (
            <Box
              style={{
                maxHeight: 220,
                overflowY: "auto",
                background: INK.paper,
                padding: 12,
                borderRadius: 8,
              }}
            >
              <Text size="xs" style={{ whiteSpace: "pre-wrap", color: INK.text }}>
                {updateResult.update.body}
              </Text>
            </Box>
          )}
          {updateMsg && (
            <Text size="xs" c={updateMsg.startsWith("Error") ? "red" : "green"}>
              {updateMsg}
            </Text>
          )}
          <Button
            fullWidth
            loading={installing}
            onClick={handleInstallUpdate}
            leftSection={<Download size={15} />}
            styles={{ root: { fontWeight: 700 } }}
          >
            {t("update.download")}
          </Button>
          <Text size="xs" c="dimmed">
            {t("update.restartNote")}
          </Text>
        </Stack>
      </Modal>
    </Box>
  );
}
