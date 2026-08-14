// ==========================================
// SUPER ADMIN SHELL — Platform Command Center
// ==========================================
//
// A completely separate product surface from the tenant workspace.
// Deep obsidian canvas, cyan→indigo glow accent, glass panels and
// motion throughout — so it reads as a different app entirely, not
// a reskin of the navy/gold company UI.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  ActionIcon,
  Avatar,
  Badge,
  Group,
  MantineProvider,
  Menu,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  Boxes,
  Building2,
  ChartPie,
  Check,
  Gauge,
  Languages,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import {
  LANGUAGES,
  LANGUAGE_ORDER,
  type Lang,
} from "../../i18n/translations";
import type { PublicUser } from "../../types/backend";
import { theme } from "../../theme";
import { SaThemeProvider, useSaScheme, useSaTheme } from "./saTheme.tsx";
import PlatformOverviewPage from "./PlatformOverviewPage";
import PlatformAnalyticsPage from "./PlatformAnalyticsPage";
import TenantsPage from "./TenantsPage";
import PackagesPage from "./PackagesPage";
import PlatformSettingsPage from "./PlatformSettingsPage";

export type SaView = "overview" | "tenants" | "packages" | "analytics" | "settings";

const NAV_ITEMS: {
  id: SaView;
  icon: typeof Gauge;
  labelKey: string;
}[] = [
  { id: "overview", icon: Gauge, labelKey: "sa.nav.overview" },
  { id: "analytics", icon: ChartPie, labelKey: "sa.nav.analytics" },
  { id: "tenants", icon: Building2, labelKey: "sa.nav.tenants" },
  { id: "packages", icon: Boxes, labelKey: "sa.nav.packages" },
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
            variant="light"
            size="lg"
            radius="md"
            aria-label={t("topbar.language")}
            style={{
              color: SA.accent,
              background: "rgba(56, 189, 248, 0.10)",
              border: `1px solid rgba(56, 189, 248, 0.28)`,
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

function LogoMark() {
  const SA = useSaTheme();
  return (
    <motion.div
      initial={{ scale: 0.7, opacity: 0, rotate: -12 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 18 }}
      style={{
        width: 40,
        height: 40,
        borderRadius: 13,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: SA.gradient,
        color: "#06121F",
        boxShadow: "0 10px 30px -8px rgba(56,189,248,0.55)",
      }}
    >
      <ShieldCheck size={22} />
    </motion.div>
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
  const { t, dir } = useI18n();
  const SA = useSaTheme();
  const { scheme, setScheme } = useSaScheme();

  // Mirror the active platform scheme on <html> so that portal-rendered
  // Mantine modals/drawers (which mount on document.body) pick up the same
  // palette, then restore the user's preference on unmount.
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
      variant="light"
      size="lg"
      radius="md"
      aria-label={t("sa.settings.theme")}
      onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
      style={{
        color: SA.accent,
        background: "rgba(56, 189, 248, 0.10)",
        border: `1px solid rgba(56, 189, 248, 0.28)`,
      }}
    >
      {scheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </ActionIcon>
  );

  return (
    <MantineProvider theme={theme} forceColorScheme={scheme}>
    <Stack
      gap={0}
      style={{
        height: "100vh",
        background: SA.bg,
        color: SA.text,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ==================== SIDEBAR ==================== */}
        <motion.aside
          initial={{ x: dir === "rtl" ? 40 : -40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: "relative",
            width: 268,
            flexShrink: 0,
            background: SA.bgSidebar,
            borderInlineEnd: `1px solid ${SA.border}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Ambient glow */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -120,
              insetInlineStart: -80,
              width: 320,
              height: 320,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(56,189,248,0.18), transparent 70%)",
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              bottom: -140,
              insetInlineEnd: -120,
              width: 300,
              height: 300,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(129,140,248,0.16), transparent 70%)",
              pointerEvents: "none",
            }}
          />

          {/* Brand */}
          <Group gap="sm" px="lg" py="xl" style={{ position: "relative" }}>
            <LogoMark />
            <Stack gap={0}>
              <Text fw={800} size="md" style={{ letterSpacing: -0.3 }}>
                Ijaz Platform
              </Text>
              <Text
                size="xs"
                style={{ color: SA.muted, letterSpacing: 1.4, textTransform: "uppercase" }}
              >
                {t("sa.subtitle")}
              </Text>
            </Stack>
          </Group>

          {/* Nav */}
          <ScrollArea flex={1} style={{ position: "relative" }}>
            <Stack gap={4} px="sm">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <div key={item.id} style={{ position: "relative" }}>
                    {active && (
                      <motion.div
                        layoutId="sa-active-pill"
                        transition={{ type: "spring", stiffness: 400, damping: 32 }}
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: 14,
                          background: "rgba(56,189,248,0.12)",
                          border: `1px solid rgba(56,189,248,0.35)`,
                          boxShadow: "0 8px 30px -10px rgba(56,189,248,0.5)",
                        }}
                      />
                    )}
                    <UnstyledButton
                      onClick={() => setView(item.id)}
                      style={{
                        position: "relative",
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "11px 14px",
                        borderRadius: 14,
                        color: active ? SA.text : SA.textSoft,
                        transition: "color 0.2s ease, transform 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateX(4px)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "translateX(0)";
                      }}
                    >
                      <motion.span
                        animate={{ scale: active ? 1.08 : 1 }}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: active
                            ? SA.gradient
                            : SA.panelStrong,
                          color: active ? "#06121F" : SA.textSoft,
                          border: `1px solid ${active ? "transparent" : SA.border}`,
                          boxShadow: active ? "0 6px 18px -6px rgba(56,189,248,0.6)" : "none",
                        }}
                      >
                        <Icon size={18} />
                      </motion.span>
                      <Text fw={active ? 700 : 500} size="sm">
                        {t(item.labelKey)}
                      </Text>
                    </UnstyledButton>
                  </div>
                );
              })}
            </Stack>
          </ScrollArea>

          {/* User card */}
          <div style={{ padding: "16px 14px", position: "relative" }}>
            <motion.div
              whileHover={{ y: -2 }}
              style={{
                borderRadius: 16,
                padding: 12,
                background: SA.panel,
                border: `1px solid ${SA.border}`,
              }}
            >
              <Group gap="sm" wrap="nowrap">
                <Avatar
                  radius="xl"
                  color="cyan"
                  style={{ border: `2px solid rgba(56,189,248,0.4)` }}
                >
                  {user.fullName.slice(0, 1).toUpperCase()}
                </Avatar>
                <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={700} size="sm" truncate>
                    {user.fullName}
                  </Text>
                  <Text size="xs" style={{ color: SA.muted }} truncate>
                    {user.email}
                  </Text>
                </Stack>
                <Tooltip label={t("sa.logout")}>
                  <ActionIcon
                    variant="subtle"
                    onClick={onLogout}
                    style={{ color: SA.textSoft }}
                  >
                    <LogOut size={17} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </motion.div>
          </div>
        </motion.aside>

        {/* ==================== MAIN ==================== */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Top bar */}
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
              backdropFilter: "blur(10px)",
            }}
          >
            <Group gap="xs">
              <AnimatePresence mode="wait">
                <motion.div
                  key={view}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <Text fw={800} size="lg" style={{ letterSpacing: -0.3 }}>
                    {t(PAGE_TITLE[view])}
                  </Text>
                </motion.div>
              </AnimatePresence>
            </Group>

            <Group gap="sm">
              <Badge
                variant="light"
                size="lg"
                radius="md"
                styles={{
                  root: {
                    background: `${SA.accent2}1f`,
                    color: SA.accent2,
                    border: `1px solid ${SA.accent2}4d`,
                  },
                  label: { fontWeight: 700, letterSpacing: 0.5 },
                }}
              >
                <Group gap={6}>
                  <Sparkles size={13} />
                  SUPER ADMIN
                </Group>
              </Badge>
              <PlatformLanguageMenu />
              {themeToggle}
            </Group>
          </header>

          {/* Page content with transitions */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 18, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -14, scale: 0.995 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                style={{ height: "100%" }}
              >
                {view === "overview" && (
                  <PlatformOverviewPage onNavigate={setView} />
                )}
                {view === "analytics" && <PlatformAnalyticsPage />}
                {view === "tenants" && <TenantsPage />}
                {view === "packages" && <PackagesPage />}
                {view === "settings" && <PlatformSettingsPage />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Stack>
    </MantineProvider>
  );
}
