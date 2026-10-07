import { useEffect, useState, type CSSProperties } from "react";
import { ActionIcon, Avatar, Button, Group, Menu, Text, Tooltip, UnstyledButton, useMantineColorScheme } from "@mantine/core";
import {
  Boxes,
  Building2,
  ChartPie,
  Check,
  Download,
  Home,
  KeyRound,
  Languages,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import { LANGUAGES, LANGUAGE_ORDER, type Lang } from "../../i18n/translations";
import type { PublicUser, PublicCompany, TenantCompanySummary } from "../../types/backend";
import { SaThemeProvider, useSaScheme, useSaTheme } from "./saTheme";
import PlatformOverviewPage from "./PlatformOverviewPage";
import PlatformAnalyticsPage from "./PlatformAnalyticsPage";
import TenantsPage from "./TenantsPage";
import FleetLicensingPage from "./FleetLicensingPage";
import PackagesPage from "./PackagesPage";
import PlatformSettingsPage from "./PlatformSettingsPage";
import RegisterTenantDrawer from "./RegisterTenantDrawer";
import TenantDetailDrawer from "./TenantDetailDrawer";
import EditTenantModal from "./EditTenantModal";
import DevProfileDrawer from "./DevProfileDrawer";
import "./admin.css";

export type SaView = "overview" | "tenants" | "licensing" | "packages" | "analytics" | "settings";

interface NavItem {
  id: SaView;
  icon: typeof Home;
  label: string;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "Fleet Operations",
    items: [
      { id: "overview", icon: Home, label: "sa.nav.overview" },
      { id: "tenants", icon: Building2, label: "sa.nav.tenants" },
      { id: "licensing", icon: KeyRound, label: "sa.nav.licensing", badge: "Live Gate" },
    ],
  },
  {
    title: "Commercial & Plans",
    items: [
      { id: "packages", icon: Boxes, label: "sa.nav.packages" },
      { id: "analytics", icon: ChartPie, label: "sa.nav.analytics" },
    ],
  },
  {
    title: "System Governance",
    items: [
      { id: "settings", icon: Settings, label: "sa.nav.settings" },
    ],
  },
];

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
            radius="xl"
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
  const [currentUser, setCurrentUser] = useState<PublicUser>(user);
  const [devDrawerOpen, setDevDrawerOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(() => localStorage.getItem("corbel_dev_avatar") || "");

  useEffect(() => {
    const onAvatarChange = () => setAvatarUrl(localStorage.getItem("corbel_dev_avatar") || "");
    window.addEventListener("corbel_avatar_updated", onAvatarChange);
    return () => window.removeEventListener("corbel_avatar_updated", onAvatarChange);
  }, []);

  const [view, setView] = useState<SaView>("overview");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<TenantCompanySummary | null>(null);
  const [editCompany, setEditCompany] = useState<PublicCompany | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("corbel_sa_sidebar_collapsed");
      if (stored !== null) return stored === "true";
      return typeof window !== "undefined" && window.innerWidth < 1024;
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("corbel_sa_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  };

  const { t, dir } = useI18n();
  const SA = useSaTheme();
  const { scheme, setScheme } = useSaScheme();
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    setColorScheme(scheme);
  }, [scheme, setColorScheme]);

  const variables = Object.fromEntries(
    Object.entries(SA).map(([key, value]) => [`--sa-${key}`, value]),
  ) as CSSProperties;

  const refresh = () => setRefreshKey((k) => k + 1);

  // Find active item label for breadcrumbs
  const activeItem = navSections
    .flatMap((s) => s.items)
    .find((item) => item.id === view);

  return (
    <div className="sa-console" style={variables} dir={dir} data-scheme={scheme}>
      <a className="sa-skip" href="#platform-content">
        Skip to content
      </a>

      {/* Modern Hierarchical Sidebar with Auto-Collapsing Icon Rail */}
      <aside className={`sa-sidebar ${collapsed ? "is-collapsed" : "is-expanded"}`}>
        {/* Brand Lockup & Collapse Rail Trigger */}
        <div className="sa-brand-row">
          <div className="sa-brand">
            <img src="/corbel_icon.svg" alt="Corbel ERP" />
            <div>
              <strong>Corbel</strong>
              <span>by The Foolish Crow</span>
            </div>
          </div>
          <Tooltip label={collapsed ? "Expand sidebar rail" : "Collapse sidebar rail"} position="right" withinPortal>
            <button
              type="button"
              className="sa-collapse-toggle"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar rail" : "Collapse sidebar rail"}
            >
              {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </Tooltip>
        </div>

        {/* Live Cluster Context Card */}
        <div className="sa-cluster-card">
          <div className="sa-cluster-info">
            <strong>Neon PostgreSQL Hub</strong>
            <span>ep-restless-surf · Live</span>
          </div>
          <div className="sa-status-beacon" />
        </div>

        {/* Categorized Navigation */}
        <nav aria-label="Platform navigation" style={{ width: "100%" }}>
          {navSections.map((section) => (
            <div key={section.title} className="sa-nav-section">
              <div className="sa-nav-label">{section.title}</div>
              {section.items.map(({ id, icon: Icon, label, badge }) => {
                const navBtn = (
                  <button
                    key={id}
                    className="sa-nav-item"
                    aria-current={view === id ? "page" : undefined}
                    onClick={() => setView(id)}
                  >
                    <Icon size={17} />
                    <span>{t(label)}</span>
                    {badge && <span className="sa-nav-badge">{badge}</span>}
                  </button>
                );

                return collapsed ? (
                  <Tooltip key={id} label={t(label)} position="right" offset={10} withinPortal>
                    {navBtn}
                  </Tooltip>
                ) : (
                  navBtn
                );
              })}
            </div>
          ))}
        </nav>

        {/* Sidebar Footer & User Profile */}
        <div className="sa-sidebar-bottom">
          {/* Sovereign Engine Core Chip */}
          <Tooltip
            label="Corbel Sovereign Engine v1.3.1 · Host: Linux"
            position="right"
            disabled={!collapsed}
            withinPortal
          >
            <div className="sa-engine-chip" title="Corbel Sovereign Engine v1.3.1">
              <div className="sa-engine-chip-icon">
                <ShieldCheck size={16} />
              </div>
              <div className="sa-engine-chip-text">
                <Text fw={750} size="xs" style={{ color: SA.text, fontSize: 11, lineHeight: 1.2 }}>
                  Corbel Engine
                </Text>
                <Text size="xs" style={{ color: SA.muted, fontSize: 10 }}>
                  v1.3.1 · Sovereign Node
                </Text>
              </div>
            </div>
          </Tooltip>

          <div className="sa-studio">
            THE FOOLISH CROW
            <span>Observe. Build. Verify.</span>
          </div>

          <Tooltip label="Open Developer Profile & Cockpit" position="right" disabled={!collapsed} withinPortal>
            <div
              className="sa-account-box"
              onClick={() => setDevDrawerOpen(true)}
              style={{ cursor: "pointer" }}
              title="Click to open Developer Profile & Updater"
            >
              {avatarUrl ? (
                <Avatar
                  src={avatarUrl}
                  size={32}
                  radius="xl"
                  styles={{ root: { border: `1.5px solid ${SA.accent}` } }}
                />
              ) : (
                <span className="sa-avatar">{currentUser.fullName.slice(0, 1).toUpperCase()}</span>
              )}
              <div className="sa-account-info">
                <strong>{currentUser.fullName}</strong>
                <span>Super administrator</span>
              </div>
              <Tooltip label={t("sa.logout")} withinPortal>
                <ActionIcon
                  className="sa-account-logout"
                  variant="subtle"
                  size="sm"
                  color={SA.muted}
                  onClick={(e) => {
                    e.stopPropagation();
                    onLogout();
                  }}
                  aria-label={t("sa.logout")}
                >
                  <LogOut size={16} />
                </ActionIcon>
              </Tooltip>
            </div>
          </Tooltip>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="sa-workspace">
        {/* Unified Command Topbar */}
        <header className="sa-topbar">
          <div className="sa-breadcrumb">
            Platform <span>/</span> <strong>{activeItem ? t(activeItem.label) : "Overview"}</strong>
          </div>

          {/* Quick Search Bar Trigger */}
          <div className="sa-search-trigger" onClick={() => setView("tenants")}>
            <Search size={14} />
            <span>Quick search tenants, plans...</span>
            <span className="sa-kbd">⌘K</span>
          </div>

          {/* Topbar Actions */}
          <Group gap="xs">
            <ActionIcon
              className="sa-mobile-logout"
              variant="subtle"
              size="lg"
              color={SA.textSoft}
              aria-label={t("sa.logout")}
              onClick={onLogout}
            >
              <LogOut size={18} />
            </ActionIcon>

            <div className="sa-telemetry-badge">
              <span className="sa-status-beacon" />
              <span>1 Cloud · 5 Desktop Nodes</span>
            </div>

            <PlatformLanguageMenu />

            <Tooltip label={`Switch to ${scheme === "dark" ? "light" : "dark"} theme`}>
              <ActionIcon
                variant="subtle"
                size="lg"
                color={SA.textSoft}
                radius="xl"
                aria-label={`Switch to ${scheme === "dark" ? "light" : "dark"} theme`}
                onClick={() => setScheme(scheme === "dark" ? "light" : "dark")}
              >
                {scheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </ActionIcon>
            </Tooltip>

            {/* Developer App Update Trigger */}
            <Tooltip label="Check for software updates & release notes">
              <Button
                size="xs"
                variant="subtle"
                leftSection={<Download size={14} />}
                onClick={() => setDevDrawerOpen(true)}
                styles={{
                  root: {
                    borderRadius: 999,
                    border: `1px solid ${SA.border}`,
                    background: SA.panel,
                    color: SA.text,
                    fontWeight: 750,
                    height: 32,
                    paddingInline: 12,
                    fontSize: 12,
                    "&:hover": { color: SA.accent, borderColor: SA.accent },
                  },
                }}
              >
                v1.3.1 · Update
              </Button>
            </Tooltip>

            {/* Developer Avatar Trigger */}
            <Tooltip label="Open Developer Profile & Cockpit">
              <UnstyledButton
                onClick={() => setDevDrawerOpen(true)}
                style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
              >
                <Avatar
                  src={avatarUrl || undefined}
                  size={32}
                  radius="xl"
                  styles={{
                    root: {
                      border: `1.5px solid ${SA.accent}`,
                      background: `${SA.accent}22`,
                      color: SA.accent,
                      fontWeight: 800,
                      fontSize: 13,
                    },
                  }}
                >
                  {!avatarUrl && currentUser.fullName.slice(0, 1).toUpperCase()}
                </Avatar>
              </UnstyledButton>
            </Tooltip>

            <button className="sa-primary" onClick={() => setRegisterOpen(true)}>
              <Plus size={16} />
              <span>Register tenant</span>
            </button>
          </Group>
        </header>

        {/* Content Viewport */}
        <main id="platform-content" tabIndex={-1} className="sa-content">
          {view === "overview" && (
            <PlatformOverviewPage
              user={currentUser}
              refreshKey={refreshKey}
              onNavigate={setView}
              onOpenTenant={setSelectedTenant}
            />
          )}
          {view === "tenants" && <TenantsPage key={refreshKey} />}
          {view === "licensing" && <FleetLicensingPage />}
          {view === "packages" && <PackagesPage />}
          {view === "analytics" && <PlatformAnalyticsPage />}
          {view === "settings" && (
            <PlatformSettingsPage
              user={currentUser}
              onUserUpdated={setCurrentUser}
              onOpenTenant={setSelectedTenant}
            />
          )}
        </main>
      </div>

      {/* Global Modals & Drawers */}
      <RegisterTenantDrawer
        opened={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={() => {
          setRegisterOpen(false);
          refresh();
        }}
      />
      <TenantDetailDrawer
        tenant={selectedTenant}
        onClose={() => setSelectedTenant(null)}
        onChanged={refresh}
        onEdit={setEditCompany}
        refreshKey={refreshKey}
      />
      <EditTenantModal
        company={editCompany}
        opened={editCompany !== null}
        onClose={() => setEditCompany(null)}
        onSaved={() => {
          setEditCompany(null);
          refresh();
        }}
      />
      <DevProfileDrawer
        opened={devDrawerOpen}
        onClose={() => setDevDrawerOpen(false)}
        user={currentUser}
        onUserUpdated={setCurrentUser}
      />
    </div>
  );
}
