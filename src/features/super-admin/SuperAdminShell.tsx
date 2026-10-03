// ==========================================
// SUPER ADMIN SHELL — Platform Command Center
// ==========================================
// Layout Architecture inspired by Aryo Pamungkas (SLAB Design Studio):
// 1. Far-left Slim Emerald Dock Rail (Home, Tenants, Packages, Analytics, Settings, Logout)
// 2. Secondary Clean White Sidebar (+ Create New button, Workspaces Tree, Filters)
// 3. Central Application Canvas (Overview Dashboard, Tenants, Packages, Analytics, Settings)
// 4. Right Storage & Health Inspector Panel (inside Overview)

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Group,
  Menu,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import {
  Boxes,
  Building2,
  ChartPie,
  Check,
  ChevronDown,
  Cloud,
  Folder,
  Home,
  Languages,
  LogOut,
  Moon,
  Plus,
  Settings,
  Sun,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import {
  LANGUAGES,
  LANGUAGE_ORDER,
  type Lang,
} from "../../i18n/translations";
import type { PublicUser, TenantCompanySummary } from "../../types/backend";
import { SaThemeProvider, useSaScheme, useSaTheme } from "./saTheme";
import PlatformOverviewPage from "./PlatformOverviewPage";
import PlatformAnalyticsPage from "./PlatformAnalyticsPage";
import TenantsPage from "./TenantsPage";
import PackagesPage from "./PackagesPage";
import PlatformSettingsPage from "./PlatformSettingsPage";
import RegisterTenantModal from "./RegisterTenantModal";
import TenantDetailDrawer from "./TenantDetailDrawer";

export type SaView = "overview" | "tenants" | "packages" | "analytics" | "settings";

const DOCK_ITEMS: {
  id: SaView;
  icon: typeof Building2;
  labelKey: string;
}[] = [
  { id: "tenants", icon: Building2, labelKey: "sa.nav.tenants" },
  { id: "packages", icon: Boxes, labelKey: "sa.nav.packages" },
  { id: "analytics", icon: ChartPie, labelKey: "sa.nav.analytics" },
  { id: "settings", icon: Settings, labelKey: "sa.nav.settings" },
];

const PAGE_TITLE: Record<SaView, string> = {
  overview: "sa.title.overview",
  tenants: "sa.title.tenants",
  packages: "sa.title.packages",
  analytics: "sa.title.analytics",
  settings: "sa.title.settings",
};

function PlatformLanguageMenu() {
  const { lang, setLang, t } = useI18n();
  const SA = useSaTheme();
  return (
    <Menu width={220} position="bottom-end" radius="md" withinPortal>
      <Tooltip label={t("topbar.language")}>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            size="lg"
            radius="md"
            aria-label={t("topbar.language")}
            style={{
              color: SA.text,
              border: `1px solid ${SA.border}`,
              background: SA.panel,
            }}
          >
            <Languages size={17} />
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown>
        <Menu.Label>{t("topbar.language")}</Menu.Label>
        {LANGUAGE_ORDER.map((code: Lang) => (
          <Menu.Item
            key={code}
            onClick={() => setLang(code)}
            rightSection={
              lang === code ? <Check size={14} style={{ color: SA.accent }} /> : undefined
            }
            style={{ fontWeight: lang === code ? 700 : 500 }}
          >
            {LANGUAGES[code].native}
            <span style={{ color: "var(--app-muted)", fontSize: 12, marginInlineStart: 6 }}>
              {LANGUAGES[code].label}
            </span>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

export default function SuperAdminShell({
  user,
  onLogout,
}: {
  user: PublicUser;
  onLogout: () => void;
}) {
  return (
    <SaThemeProvider>
      <PlatformShell user={user} onLogout={onLogout} />
    </SaThemeProvider>
  );
}

function PlatformShell({
  user,
  onLogout,
}: {
  user: PublicUser;
  onLogout: () => void;
}) {
  const [view, setView] = useState<SaView>("overview");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<TenantCompanySummary | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { t } = useI18n();
  const SA = useSaTheme();
  const { scheme, setScheme } = useSaScheme();
  const { setColorScheme: mantineSetColorScheme } = useMantineColorScheme();

  useEffect(() => {
    mantineSetColorScheme(scheme);
  }, [scheme, mantineSetColorScheme]);

  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.mantineColorScheme;
    root.dataset.mantineColorScheme = scheme;
    return () => {
      if (prev === undefined) delete root.dataset.mantineColorScheme;
      else root.dataset.mantineColorScheme = prev;
    };
  }, [scheme]);

  const themeToggle = (
    <ActionIcon
      variant="subtle"
      size="lg"
      radius="md"
      aria-label={t("sa.settings.theme")}
      onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
      style={{
        color: SA.text,
        border: `1px solid ${SA.border}`,
        background: SA.panel,
      }}
    >
      {scheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </ActionIcon>
  );

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        background: SA.bg,
        color: SA.text,
        overflow: "hidden",
        padding: "14px 18px",
        boxSizing: "border-box",
      }}
    >
      {/* Floating Enclosed Master Canvas (Aryo Pamungkas SLAB Design Studio) */}
      <div
        style={{
          display: "flex",
          flex: 1,
          height: "100%",
          width: "100%",
          borderRadius: 28,
          overflow: "hidden",
          background: SA.bgSidebar,
          boxShadow: SA.shadow,
          border: `1px solid ${SA.border}`,
        }}
      >
        {/* ======================================================== */}
        {/* 1. FAR-LEFT SLIM EMERALD DOCK RAIL (SLAB STYLE)           */}
        {/* ======================================================== */}
        <aside
          style={{
            width: 74,
            flexShrink: 0,
            background: SA.bgDock,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "space-between",
            paddingBlock: 24,
            zIndex: 10,
          }}
        >
          {/* Top Home App Icon (Active White Squircle in SLAB) */}
          <Stack align="center" gap="xl">
            <Tooltip label={t("sa.nav.overview")} position="right" offset={14} withinPortal>
              <UnstyledButton
                onClick={() => setView("overview")}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  background: view === "overview" ? SA.dockActiveBg : "rgba(255, 255, 255, 0.22)",
                  color: view === "overview" ? SA.dockActiveColor : "#FFFFFF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  boxShadow: view === "overview" ? "0 4px 14px rgba(0, 0, 0, 0.15)" : "none",
                  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
                onMouseEnter={(e) => {
                  if (view !== "overview") e.currentTarget.style.background = "rgba(255, 255, 255, 0.32)";
                }}
                onMouseLeave={(e) => {
                  if (view !== "overview") e.currentTarget.style.background = "rgba(255, 255, 255, 0.22)";
                }}
              >
                <Home size={22} />
              </UnstyledButton>
            </Tooltip>

            {/* Navigation Icons Stack */}
            <Stack align="center" gap="sm">
              {DOCK_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <Tooltip
                    key={item.id}
                    label={t(item.labelKey)}
                    position="right"
                    offset={14}
                    withinPortal
                  >
                    <UnstyledButton
                      onClick={() => setView(item.id)}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: active ? SA.dockActiveBg : "transparent",
                        color: active ? SA.dockActiveColor : SA.dockInactiveColor,
                        boxShadow: active ? "0 4px 14px rgba(0, 0, 0, 0.12)" : "none",
                        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) e.currentTarget.style.color = "#FFFFFF";
                      }}
                      onMouseLeave={(e) => {
                        if (!active) e.currentTarget.style.color = SA.dockInactiveColor;
                      }}
                    >
                      <Icon size={20} />
                    </UnstyledButton>
                  </Tooltip>
                );
              })}
            </Stack>
          </Stack>

          {/* Bottom Controls: Language, Theme & Logout */}
          <Stack align="center" gap="xs">
            <PlatformLanguageMenu />

            <Tooltip label={t("sa.settings.theme")} position="right" offset={14} withinPortal>
              <UnstyledButton
                onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: SA.dockInactiveColor,
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#FFFFFF";
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = SA.dockInactiveColor;
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {scheme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
              </UnstyledButton>
            </Tooltip>

            <Tooltip label={t("sa.logout")} position="right" offset={14} withinPortal>
              <UnstyledButton
                onClick={onLogout}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: SA.dockInactiveColor,
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#FFFFFF";
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = SA.dockInactiveColor;
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <LogOut size={19} />
              </UnstyledButton>
            </Tooltip>
          </Stack>
        </aside>

        {/* ======================================================== */}
        {/* 2. SECONDARY CLEAN WHITE SIDEBAR (SLAB DIRECTORY)        */}
        {/* ======================================================== */}
        <aside
          style={{
            width: 236,
            flexShrink: 0,
            background: SA.bgSidebar,
            borderInlineEnd: `1px solid ${SA.border}`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "24px 18px",
            overflowY: "auto",
          }}
        >
          <Stack gap="lg">
            {/* Brand Header */}
            <Group gap="sm" wrap="nowrap">
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  background: "rgba(43, 182, 115, 0.12)",
                  color: SA.accent,
                  border: "1px solid rgba(43, 182, 115, 0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                }}
              >
                <Cloud size={20} />
              </div>
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text fw={800} size="sm" style={{ color: SA.text, letterSpacing: -0.2 }} truncate>
                  Corbel Cloud
                </Text>
                <Text size="10px" fw={700} style={{ color: SA.accent, letterSpacing: 0.8 }} tt="uppercase">
                  Super Admin
                </Text>
              </Stack>
            </Group>

            {/* Prominent "+ Create New" Pill Button (SLAB Style) */}
            <Button
              fullWidth
            radius="xl"
            size="md"
            leftSection={<Plus size={16} />}
            onClick={() => setRegisterOpen(true)}
            styles={{
              root: {
                background: SA.gradient,
                color: "#FFFFFF",
                fontWeight: 700,
                fontSize: 13,
                boxShadow: "0 6px 18px -4px rgba(43, 182, 115, 0.5)",
                "&:hover": { filter: "brightness(1.06)" },
              },
            }}
          >
            Create New
          </Button>

          {/* Directory Navigation Tree */}
          <Stack gap={6} mt="xs">
            {/* Workspaces Group */}
            <Group justify="space-between" align="center" px={8} py={4}>
              <Group gap={6}>
                <ChevronDown size={14} style={{ color: SA.muted }} />
                <Text size="11px" fw={800} style={{ color: SA.muted, letterSpacing: 0.8 }} tt="uppercase">
                  Workspaces
                </Text>
              </Group>
            </Group>

            <Stack gap={2} pl={12}>
              {[
                { label: "All Tenants", view: "tenants" as SaView },
                { label: "Enterprise Tiers", view: "tenants" as SaView },
                { label: "Wholesale & POS", view: "tenants" as SaView },
                { label: "Standard Plans", view: "tenants" as SaView },
              ].map((item, idx) => (
                <UnstyledButton
                  key={idx}
                  onClick={() => setView(item.view)}
                  style={{
                    padding: "7px 10px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    color: SA.textSoft,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = SA.panelHover;
                    e.currentTarget.style.color = SA.text;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = SA.textSoft;
                  }}
                >
                  <Folder size={14} style={{ color: SA.accent }} />
                  {item.label}
                </UnstyledButton>
              ))}
            </Stack>

            {/* Platform Management Group */}
            <Group justify="space-between" align="center" px={8} py={4} mt="sm">
              <Text size="11px" fw={800} style={{ color: SA.muted, letterSpacing: 0.8 }} tt="uppercase">
                Platform Core
              </Text>
            </Group>

            <Stack gap={2} pl={12}>
              <UnstyledButton
                onClick={() => setView("analytics")}
                style={{
                  padding: "7px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: view === "analytics" ? SA.accent : SA.textSoft,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <ChartPie size={14} />
                Analytics & MRR
              </UnstyledButton>

              <UnstyledButton
                onClick={() => setView("packages")}
                style={{
                  padding: "7px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: view === "packages" ? SA.accent : SA.textSoft,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Boxes size={14} />
                Subscription Plans
              </UnstyledButton>

              <UnstyledButton
                onClick={() => setView("settings")}
                style={{
                  padding: "7px 10px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: view === "settings" ? SA.accent : SA.textSoft,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Settings size={14} />
                Security & Passwords
              </UnstyledButton>
            </Stack>
          </Stack>
        </Stack>

        {/* Bottom User Card */}
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 14,
            background: SA.panelStrong,
            border: `1px solid ${SA.border}`,
          }}
        >
          <Group gap="sm" wrap="nowrap">
            <Avatar radius="xl" size={32} style={{ background: SA.gradient, color: "#FFFFFF" }}>
              {user.fullName.slice(0, 1).toUpperCase()}
            </Avatar>
            <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text fw={700} size="xs" truncate style={{ color: SA.text }}>
                {user.fullName}
              </Text>
              <Text size="10px" style={{ color: SA.muted }} truncate>
                {user.email}
              </Text>
            </Stack>
          </Group>
        </div>
      </aside>

      {/* ======================================================== */}
      {/* 3. MAIN APPLICATION WORKSPACE CANVAS                     */}
      {/* ======================================================== */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {/* Top Bar for non-overview pages */}
        {view !== "overview" && (
          <header
            style={{
              height: 64,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingInline: 28,
              borderBottom: `1px solid ${SA.border}`,
              background: SA.topbar,
            }}
          >
            <Group gap="xs">
              <Text fw={800} size="lg" style={{ letterSpacing: -0.3 }}>
                {t(PAGE_TITLE[view])}
              </Text>
            </Group>

            <Group gap="sm">
              <Badge
                variant="light"
                size="lg"
                radius="md"
                styles={{
                  root: {
                    background: "rgba(43, 182, 115, 0.12)",
                    color: SA.accent,
                    border: `1px solid rgba(43, 182, 115, 0.3)`,
                  },
                  label: { fontWeight: 700, letterSpacing: 0.5 },
                }}
              >
                SUPER ADMIN
              </Badge>
              <PlatformLanguageMenu />
              {themeToggle}
            </Group>
          </header>
        )}

        {/* View Switcher Container */}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              style={{ height: "100%" }}
            >
              {view === "overview" && (
                <PlatformOverviewPage
                  onNavigate={setView}
                  user={user}
                  onOpenTenant={(tenant) => setSelectedTenant(tenant)}
                />
              )}
              {view === "analytics" && <PlatformAnalyticsPage />}
              {view === "tenants" && <TenantsPage />}
              {view === "packages" && <PackagesPage />}
              {view === "settings" && <PlatformSettingsPage />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      </div>

      {/* Global Modals & Drawers */}
      <RegisterTenantModal
        opened={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={() => {
          setRegisterOpen(false);
          setRefreshKey((k) => k + 1);
        }}
      />

      <TenantDetailDrawer
        tenant={selectedTenant}
        onClose={() => setSelectedTenant(null)}
        onChanged={() => setRefreshKey((k) => k + 1)}
        onEdit={() => {}}
        refreshKey={refreshKey}
      />
    </div>
  );
}
