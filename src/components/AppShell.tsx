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
} from "lucide-react";

import {
  createBackup,
  getCompany,
  getErrorMessage,
  getTheme,
  saveFileDialog,
  type CompanyTheme,
} from "../api/backend";
import { checkForUpdates, installUpdate } from "../api/updater";
import type { UpdateResult } from "../api/updater";
import type { PublicUser } from "../types/backend";

import DashboardHome from "../features/dashboard/DashboardPage";
import InventoryPage from "../features/inventory/InventoryPage";
import InvoicePage from "../features/invoices/InvoicePage";
import PurchaseOrderPage from "../features/purchase-orders/PurchaseOrderPage";
import ReportsPage from "../features/reports/ReportsPage";
import UserManagementView from "../features/dashboard/UserManagement";
import SettingsPage from "../features/settings/SettingsPage";
import CustomersPage from "../features/customers/CustomersPage";
import AccountsPage from "../features/accounts/AccountsPage";
import SearchBar from "./SearchBar";
import NotificationBell from "./NotificationBell";
import { INK } from "../theme";

// ==========================================
// NAV MODEL
// ==========================================

export type DashboardView =
  | "home"
  | "inventory"
  | "invoices"
  | "customers"
  | "purchasing"
  | "reports"
  | "accounts"
  | "users"
  | "settings";

const NAV_ITEMS: {
  key: DashboardView;
  label: string;
  description: string;
  icon: React.ReactNode;
  roles: ("owner" | "admin" | "employee")[];
}[] = [
  {
    key: "home",
    label: "Dashboard",
    description: "Overview & analytics",
    icon: <LayoutDashboard size={18} />,
    roles: ["owner", "admin", "employee"],
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Products, stock & suppliers",
    icon: <Package size={18} />,
    roles: ["owner", "admin", "employee"],
  },
  {
    key: "invoices",
    label: "Invoices",
    description: "Bills, payments & customers",
    icon: <ReceiptText size={18} />,
    roles: ["owner", "admin", "employee"],
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer directory & accounts",
    icon: <ContactRound size={18} />,
    roles: ["owner", "admin", "employee"],
  },
  {
    key: "purchasing",
    label: "Purchasing",
    description: "Purchase orders from suppliers",
    icon: <ShoppingCart size={18} />,
    roles: ["owner", "admin", "employee"],
  },
  {
    key: "reports",
    label: "Reports",
    description: "Sales, stock & profit analytics",
    icon: <ChartPie size={18} />,
    roles: ["owner", "admin", "employee"],
  },
  {
    key: "accounts",
    label: "Accounts",
    description: "Chart of accounts & journal",
    icon: <BookOpen size={18} />,
    roles: ["owner", "admin", "employee"],
  },
  {
    key: "users",
    label: "Team",
    description: "Manage company users",
    icon: <Users size={18} />,
    roles: ["owner", "admin"],
  },
  {
    key: "settings",
    label: "Settings",
    description: "Profile, invoices, backups & audit",
    icon: <Settings2 size={18} />,
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
}: {
  user: PublicUser;
  onLogout: () => Promise<void>;
}) {
  const [view, setView] = useState<DashboardView>("home");
  const [backing, setBacking] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [branding, setBranding] = useState<Branding>({
    companyName: "Ijaz & Company",
    theme: null,
  });

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
    let cancelled = false;
    checkForUpdates().then((result) => {
      if (!cancelled) setUpdateResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAvailable =
    updateResult?.available && updateResult.update != null;

  async function handleInstallUpdate() {
    setInstalling(true);
    setUpdateMsg(null);
    try {
      await installUpdate();
      setUpdateMsg("Update installed. The app will restart shortly.");
    } catch (err) {
      setUpdateMsg(`Error: ${getErrorMessage(err)}`);
    } finally {
      setInstalling(false);
    }
  }

  const navItems = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  async function handleBackup() {
    setBacking(true);
    setBackupMsg(null);
    try {
      const savePath = await saveFileDialog({
        title: "Save Backup",
        defaultPath: `backup-${new Date().toISOString().slice(0, 10)}.db`,
      });
      if (!savePath) return;
      const path = await createBackup(savePath);
      setBackupMsg(`Backup saved: ${path}`);
    } catch (err) {
      setBackupMsg(`Error: ${getErrorMessage(err)}`);
    } finally {
      setBacking(false);
      setTimeout(() => setBackupMsg(null), 5000);
    }
  }

  const current = navItems.find((n) => n.key === view) ?? navItems[0];
  const today = new Date().toLocaleDateString(undefined, {
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
  const accent = theme?.accentColor ?? DEFAULT_PRIMARY;
  const accentGradient = `linear-gradient(135deg, ${accent} 0%, ${accent} 100%)`;
  const brandGradient = `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`;
  const brandGlow = `0 6px 18px -6px ${hexToRgba(accent, 0.55)}`;
  const onAccent = contrastText(accent);
  const onPrimary = contrastText(primary);
  const accentLabel = accent;
  const navPillBackground = `linear-gradient(90deg, ${hexToRgba(accent, 0.22)} 0%, ${hexToRgba(accent, 0.06)} 100%)`;
  const navPillBorder = hexToRgba(accent, 0.35);
  const navPillShadow = `inset 0 0 24px -8px ${hexToRgba(accent, 0.4)}`;
  const logoImage = theme?.logoBase64 ?? null;
  const tagline = theme?.companyTagline ?? "ERP SUITE";
  const watermark = theme?.erpWatermark ?? "Powered by Ijaz & Company ERP";

  return (
    <Box
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: INK.paper,
      }}
    >
      {/* ==================== SIDEBAR ==================== */}
      <Box
        component="aside"
        style={{
          width: 268,
          flexShrink: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background:
            "linear-gradient(180deg, #10183A 0%, #16214A 55%, #1D2B54 100%)",
          color: "#fff",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Brand */}
        <Group gap="sm" px="lg" py="xl">
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 14 }}
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
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
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }}
              />
            ) : (
              <span>{branding.companyName.charAt(0).toUpperCase()}</span>
            )}
          </motion.div>
          <Stack gap={0}>
            <Text fw={800} size="lg" style={{ letterSpacing: -0.2, lineHeight: 1.25 }}>
              {branding.companyName}
            </Text>
            <Text size="xs" style={{ color: "#A9B6D6", letterSpacing: 1.5, lineHeight: 1.3 }}>
              {tagline}
            </Text>
          </Stack>
        </Group>

        {/* Nav */}
        <ScrollArea offsetScrollbars style={{ flex: 1 }}>
          <Stack gap={4} px="sm">
            <Text
              size="xs"
              px="md"
              pb="xs"
              style={{ color: "#6B7BA6", letterSpacing: 1.5, fontWeight: 700 }}
            >
              WORKSPACE
            </Text>
            {navItems.map((item, index) => {
              const active = view === item.key;
              return (
                <motion.button
                  key={item.key}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: 0.05 + index * 0.05,
                    ease: [0.22, 1, 0.36, 1],
                    duration: 0.35,
                  }}
                  onClick={() => setView(item.key)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "11px 14px",
                    borderRadius: 12,
                    border: "none",
                    background: "transparent",
                    color: active ? "#fff" : "#A9B6D6",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: active ? 700 : 500,
                    textAlign: "left",
                    transition: "color 0.18s ease",
                  }}
                  whileHover={{ x: 3 }}
                  whileTap={{ scale: 0.97 }}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: 12,
                        background: navPillBackground,
                        border: `1px solid ${navPillBorder}`,
                        boxShadow: navPillShadow,
                      }}
                    />
                  )}
                  <span
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      background: active ? accentGradient : "rgba(255,255,255,0.06)",
                      color: active ? onAccent : "#A9B6D6",
                      flexShrink: 0,
                      transition: "background 0.2s ease, color 0.2s ease",
                    }}
                  >
                    {item.icon}
                  </span>
                  <span style={{ position: "relative", flex: 1 }}>
                    {item.label}
                  </span>
                </motion.button>
              );
            })}
          </Stack>
        </ScrollArea>

        {/* Sidebar footer — user card */}
        <Box px="sm" pb="md">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
          >
            <Box
              style={{
                borderRadius: 16,
                padding: 12,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <Group justify="space-between" mb="xs">
                <Group gap="xs">
                  <Avatar
                    color={ROLE_COLORS[user.role]}
                    radius="xl"
                    size="sm"
                    style={{ fontWeight: 700 }}
                  >
                    {user.fullName.charAt(0).toUpperCase()}
                  </Avatar>
                  <Stack gap={0}>
                    <Text size="sm" fw={600} style={{ lineHeight: 1.2 }}>
                      {user.fullName}
                    </Text>
                    <Text size="xs" style={{ color: "#A9B6D6", lineHeight: 1.3 }}>
                      {user.email}
                    </Text>
                  </Stack>
                </Group>
                <Badge
                  color={ROLE_COLORS[user.role]}
                  variant="light"
                  size="xs"
                  styles={{ label: { textTransform: "uppercase" } }}
                >
                  {user.role}
                </Badge>
              </Group>
              <Button
                variant="subtle"
                color="gray"
                fullWidth
                size="xs"
                leftSection={<LogOut size={14} />}
                onClick={onLogout}
                styles={{
                  root: { color: "#C7CFE4", "&:hover": { background: "rgba(255,255,255,0.08)", color: "#fff" } },
                  label: { fontWeight: 600 },
                }}
              >
                Sign out
              </Button>
            </Box>
          </motion.div>
        </Box>

        {/* Platform watermark — secondary, below the user card */}
        <Box px="sm" pb="sm" style={{ textAlign: "center" }}>
          <Text size="xs" style={{ color: "#5A6B96", letterSpacing: 0.5, fontSize: 11 }}>
            {watermark}
          </Text>
        </Box>
      </Box>

      {/* ==================== CONTENT ==================== */}
      <Box style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top bar */}
        <Box
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 28px",
            borderBottom: "1px solid #E3E8F1",
            background: "rgba(246,248,252,0.85)",
            backdropFilter: "blur(8px)",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}
        >
          <motion.div
            key={view}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <Stack gap={0}>
              <Text size="sm" style={{ color: accentLabel, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" }}>
                {current?.label}
              </Text>
              <Text fw={800} size="lg" style={{ color: INK.navy, letterSpacing: -0.3 }}>
                {current?.description}
              </Text>
            </Stack>
          </motion.div>

          <Group gap="md">
            <SearchBar
              onSelect={(result) => {
                if (result.resultType === "product") setView("inventory");
                else if (result.resultType === "customer") setView("customers");
              }}
            />
            <Text size="sm" c="dimmed">
              {today}
            </Text>
            {backupMsg && (
              <Text size="xs" c={backupMsg.startsWith("Error") ? "red" : "green"}>
                {backupMsg}
              </Text>
            )}
            {updateAvailable && updateResult?.update && (
              <Tooltip label={`New version ${updateResult.update.version} available`}>
                <Button
                  variant="filled"
                  size="sm"
                  leftSection={<Download size={15} />}
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
                  Update v{updateResult.update.version}
                </Button>
              </Tooltip>
            )}
            <NotificationBell
              onNavigate={(view) => setView(view)}
            />
            <Tooltip label="Backup database">
              <Button
                variant="light"
                size="sm"
                leftSection={<DatabaseBackup size={15} />}
                onClick={handleBackup}
                loading={backing}
                styles={{ root: { fontWeight: 600 } }}
              >
                Backup
              </Button>
            </Tooltip>
            <Tooltip label="Settings">
              <Button
                variant="subtle"
                size="sm"
                leftSection={<Settings2 size={15} />}
                onClick={() => setView("settings")}
                styles={{ root: { fontWeight: 600 } }}
              >
                Settings
              </Button>
            </Tooltip>
          </Group>
        </Box>

        {/* Animated page container */}
        <Box style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              variants={pageVariants}
              initial="initial"
              animate="enter"
              exit="exit"
              style={{ padding: 28, minHeight: "100%" }}
            >
              {view === "home" && <DashboardHome user={user} />}
              {view === "inventory" && <InventoryPage user={user} />}
              {view === "invoices" && <InvoicePage user={user} />}
              {view === "customers" && <CustomersPage user={user} />}
              {view === "purchasing" && <PurchaseOrderPage user={user} />}
              {view === "reports" && <ReportsPage />}
              {view === "accounts" && <AccountsPage />}
              {view === "users" && <UserManagementView currentUser={user} />}
              {view === "settings" && (
                <SettingsPage user={user} onLogout={onLogout} />
              )}
            </motion.div>
          </AnimatePresence>
        </Box>
      </Box>

      {/* Update modal */}
      <Modal
        opened={updateOpen}
        onClose={() => setUpdateOpen(false)}
        title="Update available"
        centered
        styles={{ title: { fontWeight: 800, color: INK.navy } }}
      >
        <Stack gap="md">
          <Text size="sm">
            Version <b>{updateResult?.update?.version}</b> is available. You
            are running v{updateResult?.currentVersion}.
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
              <Text size="xs" style={{ whiteSpace: "pre-wrap", color: INK.navy }}>
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
            Download &amp; Install
          </Button>
          <Text size="xs" c="dimmed">
            The app will close and restart after the update is installed. Your
            data is preserved.
          </Text>
        </Stack>
      </Modal>
    </Box>
  );
}
