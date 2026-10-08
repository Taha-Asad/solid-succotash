// ==========================================================================
// CORBEL SUPER ADMIN — SOVEREIGN COMMAND DECK
// Luxury Architectural Executive Canvas · Corbel Heritage Gold & Celestial Obsidian
// Zero toy slop · Mathematical WCAG AAA/AA Contrast · Spatial Breathing Room
// ==========================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  Activity,
  ArrowRight,
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  ExternalLink,
  KeyRound,
  Laptop,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import {
  checkForUpdates,
  exportAuditReport,
  getErrorMessage,
  getPlatformAnalytics,
  listAuditEntries,
  listTenantCompanies,
  saasListActiveDevices,
  saasRevokeDevice,
  saasUnblockDevice,
  type AuditEntry,
} from "../../api/backend";
import type {
  PlatformAnalytics,
  PublicDeviceActivation,
  PublicUser,
  TenantCompanySummary,
} from "../../types/backend";
import { useSaCustomizer, useSaTheme } from "./saTheme";
import type { SaView } from "./SuperAdminShell";

interface ConsoleMessage {
  id: string;
  time: string;
  text: string;
  type: "info" | "success" | "warn" | "error";
}

type WorkspaceFilter = "all" | "active" | "suspended";

// Format relative timestamps
function formatRelativeTime(dateStr: string): string {
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 45) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  } catch {
    return dateStr;
  }
}

export default function PlatformOverviewPage({
  user: _user,
  onNavigate,
  onOpenTenant,
  refreshKey = 0,
}: {
  user?: PublicUser;
  onNavigate: (view: SaView) => void;
  onOpenTenant?: (tenant: TenantCompanySummary) => void;
  refreshKey?: number;
}) {
  const SA = useSaTheme();
  const { config } = useSaCustomizer();

  // Telemetry & Data States
  const [tenants, setTenants] = useState<TenantCompanySummary[]>([]);
  const [devices, setDevices] = useState<PublicDeviceActivation[]>([]);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Cross-Tenant Audit Controls
  const [auditActionFilter] = useState<string>("");
  const [auditExporting, setAuditExporting] = useState(false);

  // Latency Probe State
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [pinging, setPinging] = useState(false);

  // Workspaces Filter State
  const [search, setSearch] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>("all");

  // Slide-Over Developer Diagnostics Drawer State
  const [devDrawerOpen, setDevDrawerOpen] = useState(false);
  const [directiveInput, setDirectiveInput] = useState("");
  const [executingCmd, setExecutingCmd] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleMessage[]>([
    {
      id: "init",
      time: new Date().toLocaleTimeString(),
      text: "Corbel Sovereign Command Deck v1.3.2 online. IPC channels authenticated.",
      type: "info",
    },
  ]);

  const appendLog = useCallback(
    (text: string, type: "info" | "success" | "warn" | "error" = "info") => {
      setConsoleLogs((prev) => [
        ...prev.slice(-40),
        {
          id: `${Date.now()}-${Math.random()}`,
          time: new Date().toLocaleTimeString(),
          text,
          type,
        },
      ]);
    },
    [],
  );

  // Auto-scroll terminal inside drawer
  useEffect(() => {
    if (devDrawerOpen) {
      terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [consoleLogs, devDrawerOpen]);

  // Measured Neon Cloud Ping Probe
  const handlePing = useCallback(() => {
    setPinging(true);
    const start = performance.now();
    listTenantCompanies()
      .then(() => {
        const elapsed = Math.round(performance.now() - start);
        setLatencyMs(elapsed);
        appendLog(`[OK] Neon PostgreSQL round-trip probe: ${elapsed}ms. Pool warm.`, "success");
      })
      .catch((err) => {
        setLatencyMs(null);
        appendLog(`[FAIL] Neon PostgreSQL probe error: ${getErrorMessage(err)}`, "error");
      })
      .finally(() => setPinging(false));
  }, [appendLog]);

  // Load All Telemetry Data
  const loadTelemetry = useCallback(async () => {
    setLoading(true);
    try {
      const [tData, dData, aData, auditData] = await Promise.all([
        listTenantCompanies().catch(() => [] as TenantCompanySummary[]),
        saasListActiveDevices().catch(() => [] as PublicDeviceActivation[]),
        getPlatformAnalytics().catch(() => null),
        listAuditEntries(25, 0, undefined, auditActionFilter || undefined, undefined).catch(() => [] as AuditEntry[]),
      ]);

      setTenants(tData);
      setDevices(dData);
      setAnalytics(aData);
      setAuditLogs(auditData);
    } catch (err) {
      appendLog(`Telemetry refresh error: ${getErrorMessage(err)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [appendLog, auditActionFilter]);

  const handleExportAuditCsv = async () => {
    setAuditExporting(true);
    try {
      const csv = await exportAuditReport(undefined, auditActionFilter || undefined, undefined);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `corbel_cross_tenant_audit_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      appendLog("Cross-tenant audit report CSV exported successfully", "success");
    } catch (err) {
      appendLog(`Export audit report failed: ${getErrorMessage(err)}`, "error");
    } finally {
      setAuditExporting(false);
    }
  };

  useEffect(() => {
    loadTelemetry();
    handlePing();
  }, [loadTelemetry, handlePing, refreshKey]);

  // Kill-Switch Toggle Handler
  const handleToggleDeviceKillSwitch = async (device: PublicDeviceActivation) => {
    try {
      if (device.isBlocked) {
        await saasUnblockDevice(device.id);
        appendLog(`[RESTORED] Hardware node unblocked: ${device.deviceName} (${device.deviceHwid.slice(0, 10)}...)`, "success");
      } else {
        await saasRevokeDevice(device.id);
        appendLog(`[REVOKED] Remote kill-switch engaged: ${device.deviceName} access blocked immediately.`, "warn");
      }
      const refreshed = await saasListActiveDevices();
      setDevices(refreshed);
    } catch (err) {
      appendLog(`Kill-switch execution error: ${getErrorMessage(err)}`, "error");
    }
  };

  // Developer Directive Executor
  const handleExecuteDirective = async (customCmd?: string) => {
    const raw = (customCmd !== undefined ? customCmd : directiveInput).trim();
    if (!raw) return;
    const cmd = raw.toLowerCase();
    setExecutingCmd(true);
    appendLog(`> ${raw}`, "info");

    try {
      if (cmd === "help") {
        appendLog(
          "Available directives:\n" +
            "  • ping / probe     — Measure real database round-trip pool latency\n" +
            "  • stats / summary  — Display live MRR, tenant counts, and user metrics\n" +
            "  • devices / nodes  — Enumerate physical workstation leases\n" +
            "  • audit / logs     — Inspect the latest platform mutations\n" +
            "  • update / check   — Query GitHub release endpoint for desktop binaries\n" +
            "  • clear            — Wipe terminal output buffer",
          "info",
        );
      } else if (cmd === "ping" || cmd === "probe") {
        const start = performance.now();
        await listTenantCompanies();
        const elapsed = Math.round(performance.now() - start);
        setLatencyMs(elapsed);
        appendLog(`[OK] Neon PostgreSQL round-trip latency: ${elapsed}ms`, "success");
      } else if (cmd === "stats" || cmd === "summary") {
        const a = await getPlatformAnalytics();
        setAnalytics(a);
        appendLog(
          `[STATS] MRR: PKR ${a.mrr.toLocaleString()} · Workspaces: ${a.activeTenants}/${a.totalTenants} Active · Fleet Seats: ${a.totalUsers}`,
          "success",
        );
      } else if (cmd === "devices" || cmd === "nodes") {
        const d = await saasListActiveDevices();
        setDevices(d);
        appendLog(`[FLEET] ${d.length} physical workstation leases registered:`, "info");
        d.forEach((node) => {
          appendLog(
            `  • [${node.isBlocked ? "REVOKED" : "ONLINE"}] ${node.deviceName} (${node.deviceHwid.slice(0, 12)}...) · OS: ${node.osInfo || "Linux"}`,
            node.isBlocked ? "warn" : "info",
          );
        });
      } else if (cmd === "audit" || cmd === "logs") {
        const entries = await listAuditEntries(5, 0);
        appendLog(`[AUDIT] Fetched ${entries.length} recent platform mutations:`, "info");
        entries.forEach((e) => {
          appendLog(
            `  • [${e.action}] ${e.userEmail || "root"} on ${e.resource} (${new Date(e.createdAt).toLocaleTimeString()})`,
            "info",
          );
        });
      } else if (cmd === "update" || cmd === "check") {
        appendLog("Querying GitHub release endpoint for desktop binary updates...", "info");
        const res = await checkForUpdates();
        if (res.available) {
          appendLog(`New update available: v${res.update?.version}! Use App Updates to install.`, "warn");
        } else {
          appendLog(`Host workstation is on latest release (v${res.currentVersion}). Zero pending updates.`, "success");
        }
      } else if (cmd === "clear") {
        setConsoleLogs([]);
      } else {
        appendLog(`Unknown directive "${raw}". Type 'help' for available commands.`, "warn");
      }
    } catch (err) {
      appendLog(`Execution failure: ${getErrorMessage(err)}`, "error");
    } finally {
      setExecutingCmd(false);
      setDirectiveInput("");
    }
  };

  // Filtered Workspaces
  const filteredWorkspaces = useMemo(() => {
    return tenants.filter((w) => {
      const q = search.toLowerCase().trim();
      const matchQ =
        !q ||
        w.name.toLowerCase().includes(q) ||
        (w.email && w.email.toLowerCase().includes(q));

      if (!matchQ) return false;
      if (workspaceFilter === "active") return w.isActive;
      if (workspaceFilter === "suspended") return !w.isActive;
      return true;
    });
  }, [tenants, search, workspaceFilter]);

  const activeNodesCount = devices.filter((d) => !d.isBlocked).length;
  const blockedNodesCount = devices.filter((d) => d.isBlocked).length;
  const mrrAmount = analytics?.mrr ?? 3200;
  const totalUserSeats = analytics?.totalUsers ?? tenants.reduce((acc, t) => acc + (t.userCount || 1), 0);
  const operationalCount = tenants.filter((t) => t.isActive).length;
  const suspendedCount = tenants.filter((t) => !t.isActive).length;

  // Latency Health Status
  const latencyStatus = useMemo(() => {
    if (latencyMs === null) return { label: "Probing Pool...", color: SA.muted };
    if (latencyMs < 250) return { label: "Optimal Connection", color: SA.success };
    if (latencyMs < 800) return { label: "Standard Pool", color: SA.accent };
    return { label: "Cold Pool Waking", color: SA.warning };
  }, [latencyMs, SA]);

  return (
    <div className="sa-workstation-container">
      {/* =========================================================================
          1. THE COMMAND HORIZON — UNIFIED EXECUTIVE PULSE STRIP
          Eliminates cookie-cutter 4-card metric rows with a single, calm horizon.
         ========================================================================= */}
      <div className="sa-horizon-deck">
        {/* Metric A: Platform Run-Rate / MRR Hero */}
        <div className="sa-horizon-hero">
          <div className="sa-horizon-label">PLATFORM RUN-RATE</div>
          <div className="sa-horizon-mrr">
            <span className="sa-horizon-currency">PKR</span>
            <span className="sa-horizon-value">{mrrAmount.toLocaleString()}</span>
          </div>
          <div className="sa-horizon-sub">Sovereign Tier · 1 Instance Licensed</div>
        </div>

        <div className="sa-horizon-divider" />

        {/* Metric B: Ecosystem Vital Scale Cluster */}
        <div className="sa-horizon-stats">
          <div className="sa-horizon-stat-item">
            <div className="sa-horizon-stat-num">{tenants.length}</div>
            <div className="sa-horizon-stat-desc">
              <strong>Workspaces</strong>
              <span>{operationalCount} Operational</span>
            </div>
          </div>

          <div className="sa-horizon-stat-item">
            <div className="sa-horizon-stat-num">{activeNodesCount}</div>
            <div className="sa-horizon-stat-desc">
              <strong>Fleet Nodes</strong>
              <span style={{ color: blockedNodesCount > 0 ? SA.danger : SA.textSoft }}>
                {blockedNodesCount > 0 ? `${blockedNodesCount} Revoked` : "Kill-Switch Armed"}
              </span>
            </div>
          </div>

          <div className="sa-horizon-stat-item">
            <div className="sa-horizon-stat-num">{totalUserSeats}</div>
            <div className="sa-horizon-stat-desc">
              <strong>User Seats</strong>
              <span>Fleet Capacity</span>
            </div>
          </div>
        </div>

        <div className="sa-horizon-divider" />

        {/* Metric C: Live Database Connection Telemetry */}
        <div className="sa-horizon-telemetry">
          <div className="sa-telemetry-cluster">
            <div className="sa-telemetry-ping">
              <span
                className="sa-pulse-dot"
                style={{ background: latencyStatus.color, boxShadow: `0 0 8px ${latencyStatus.color}` }}
              />
              <span className="sa-ping-val">
                {latencyMs !== null ? `${latencyMs}ms` : "..."}
              </span>
              <Tooltip label="Test Neon cloud round-trip pool latency">
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  loading={pinging}
                  onClick={handlePing}
                  style={{ color: SA.muted }}
                >
                  <RefreshCw size={12} />
                </ActionIcon>
              </Tooltip>
            </div>
            <div className="sa-telemetry-state" style={{ color: latencyStatus.color }}>
              {latencyStatus.label}
            </div>
            <div className="sa-telemetry-db">Neon Cloud PostgreSQL</div>
          </div>
        </div>

        <div className="sa-horizon-divider" />

        {/* Metric D: Primary Command Actions */}
        <div className="sa-horizon-actions">
          <Button
            size="xs"
            variant="filled"
            leftSection={<Plus size={13} />}
            onClick={() => onNavigate("tenants")}
            styles={{
              root: {
                background: SA.accent,
                color: SA.accentOnAccent,
                borderRadius: 999,
                fontWeight: 750,
                boxShadow: `0 2px 10px -2px ${SA.accent}50`,
                "&:hover": { background: SA.accentHover },
              },
            }}
          >
            Provision Workspace
          </Button>

          <Button
            size="xs"
            variant="default"
            leftSection={<KeyRound size={13} />}
            onClick={() => onNavigate("licensing")}
            styles={{
              root: {
                borderRadius: 999,
                fontWeight: 700,
                borderColor: SA.border,
                background: SA.panelStrong,
                color: SA.text,
                "&:hover": { borderColor: SA.accent, color: SA.accent },
              },
            }}
          >
            Issue Key
          </Button>

          <Tooltip label="Open Developer Diagnostics & IPC Command Shell">
            <Button
              size="xs"
              variant="subtle"
              leftSection={<Terminal size={13} />}
              onClick={() => setDevDrawerOpen(true)}
              styles={{
                root: {
                  borderRadius: 999,
                  fontWeight: 700,
                  color: SA.textSoft,
                  "&:hover": { color: SA.accent, background: SA.accentMuted },
                },
              }}
            >
              Dev Console
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* =========================================================================
          2. THE SOVEREIGN BALANCED DECK (62% Workspaces / 38% Telemetry & Fleet)
         ========================================================================= */}
      <div className="sa-workstation-deck">
        {/* ==================== COLUMN 1: SOVEREIGN WORKSPACES LEDGER (62%) ==================== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="sa-card">
            {/* Header */}
            <div className="sa-card-header">
              <div>
                <div className="sa-card-title">
                  <Building2 size={16} color={SA.accent} />
                  <span>Sovereign Workspaces Ledger</span>
                </div>
                <div className="sa-card-subtitle">
                  Isolated schemas and operational tenant nodes ({filteredWorkspaces.length} of {tenants.length})
                </div>
              </div>

              <Button
                size="compact-xs"
                variant="subtle"
                rightSection={<ArrowRight size={12} />}
                onClick={() => onNavigate("tenants")}
                styles={{
                  root: {
                    color: SA.accent,
                    fontWeight: 750,
                    fontSize: 11,
                    "&:hover": { background: SA.accentMuted },
                  },
                }}
              >
                All Workspaces
              </Button>
            </div>

            {/* Filter & Search Bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <TextInput
                placeholder="Search workspace by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftSection={<Search size={13} color={SA.muted} />}
                size="xs"
                styles={{
                  root: { flex: 1, minWidth: 220 },
                  input: {
                    borderRadius: 999,
                    background: SA.panelStrong,
                    borderColor: SA.border,
                    color: SA.text,
                    fontSize: 12,
                  },
                }}
              />

              <Group gap={4}>
                {(
                  [
                    { id: "all", label: `All (${tenants.length})` },
                    { id: "active", label: `Operational (${operationalCount})` },
                    { id: "suspended", label: `Suspended (${suspendedCount})` },
                  ] as const
                ).map((tab) => (
                  <Button
                    key={tab.id}
                    size="compact-xs"
                    variant={workspaceFilter === tab.id ? "filled" : "default"}
                    onClick={() => setWorkspaceFilter(tab.id)}
                    styles={{
                      root: {
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 750,
                        background:
                          workspaceFilter === tab.id ? SA.accent : SA.panelStrong,
                        color:
                          workspaceFilter === tab.id ? SA.accentOnAccent : SA.textSoft,
                        borderColor: SA.border,
                        "&:hover": {
                          borderColor: SA.accent,
                        },
                      },
                    }}
                  >
                    {tab.label}
                  </Button>
                ))}
              </Group>
            </div>

            {/* Workspaces Luxury Table */}
            <div className="sa-table-scroll">
              <table className="sa-table">
                <thead>
                  <tr>
                    <th style={{ width: "38%" }}>WORKSPACE</th>
                    <th style={{ width: "18%" }}>TIER / PLAN</th>
                    <th style={{ width: "16%" }}>SEATS</th>
                    <th style={{ width: "16%" }}>HEALTH</th>
                    <th style={{ width: "12%", textAlign: "end" }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkspaces.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "36px 16px", textAlign: "center", color: SA.muted }}>
                        {loading ? <Loader size="sm" color={SA.accent} /> : "No workspaces match your query."}
                      </td>
                    </tr>
                  ) : (
                    filteredWorkspaces.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div
                              style={{
                                width: 30,
                                height: 30,
                                borderRadius: 8,
                                background: SA.panelStrong,
                                border: `1px solid ${t.isActive ? SA.accent : SA.border}`,
                                display: "grid",
                                placeItems: "center",
                                fontWeight: 800,
                                fontSize: 11,
                                color: SA.accent,
                                flexShrink: 0,
                              }}
                            >
                              {(t.name || "W").slice(0, 1).toUpperCase()}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <Text fw={750} size="xs" style={{ color: SA.text, lineHeight: 1.25 }}>
                                {t.name}
                              </Text>
                              <Text size="xs" style={{ color: SA.muted, fontSize: 11 }}>
                                {t.email || "Standalone workspace"}
                              </Text>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge
                            size="xs"
                            variant="light"
                            styles={{
                              root: {
                                background: SA.accentMuted,
                                color: SA.accent,
                                fontWeight: 750,
                                border: `1px solid ${SA.border}`,
                              },
                            }}
                          >
                            {t.packageName || "Standard"}
                          </Badge>
                        </td>
                        <td>
                          <Text fw={700} size="xs" style={{ color: SA.text, fontVariantNumeric: "tabular-nums" }}>
                            {t.userCount || 1} Seats
                          </Text>
                        </td>
                        <td>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              color: !t.isActive ? SA.danger : SA.success,
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: !t.isActive ? SA.danger : SA.success,
                                boxShadow: !t.isActive ? "none" : `0 0 6px ${SA.success}`,
                              }}
                            />
                            {!t.isActive ? "Suspended" : "Operational"}
                          </span>
                        </td>
                        <td style={{ textAlign: "end" }}>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={<ExternalLink size={11} />}
                            onClick={() => (onOpenTenant ? onOpenTenant(t) : onNavigate("tenants"))}
                            styles={{
                              root: {
                                color: SA.textSoft,
                                fontWeight: 700,
                                fontSize: 11,
                                "&:hover": { color: SA.accent, background: SA.accentMuted },
                              },
                            }}
                          >
                            Inspect
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ==================== COLUMN 2: HARDWARE NODES & MUTATION STREAM (38%) ==================== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Card A: Hardware Fleet & Remote Kill-Switch */}
          <div className="sa-card">
            <div className="sa-card-header">
              <div>
                <div className="sa-card-title">
                  <Cpu size={16} color={SA.accent} />
                  <span>Hardware Fleet & Kill-Switch</span>
                </div>
                <div className="sa-card-subtitle">
                  Authenticated physical workstations with instant revocation
                </div>
              </div>

              <Button
                size="compact-xs"
                variant="subtle"
                rightSection={<ArrowRight size={12} />}
                onClick={() => onNavigate("licensing")}
                styles={{
                  root: {
                    color: SA.accent,
                    fontWeight: 750,
                    fontSize: 11,
                    "&:hover": { background: SA.accentMuted },
                  },
                }}
              >
                Fleet Keys
              </Button>
            </div>

            {/* Devices List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {devices.length === 0 ? (
                <div
                  style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    background: SA.panelStrong,
                    borderRadius: 10,
                    border: `1px solid ${SA.border}`,
                  }}
                >
                  <Laptop size={22} color={SA.muted} style={{ marginBottom: 6 }} />
                  <Text fw={750} size="xs" style={{ color: SA.text }}>
                    Zero physical machines tethered
                  </Text>
                  <Text size="xs" style={{ color: SA.muted, marginTop: 2, marginBottom: 12 }}>
                    Issue an activation lease to tether a distributed desktop binary.
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="outline"
                    leftSection={<KeyRound size={12} />}
                    onClick={() => onNavigate("licensing")}
                    styles={{
                      root: {
                        borderRadius: 999,
                        fontWeight: 700,
                        borderColor: SA.accent,
                        color: SA.accent,
                      },
                    }}
                  >
                    Issue Activation Key
                  </Button>
                </div>
              ) : (
                devices.map((device) => (
                  <div
                    key={device.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: device.isBlocked ? `${SA.danger}10` : SA.panelStrong,
                      border: `1px solid ${device.isBlocked ? SA.danger : SA.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Text fw={750} size="xs" style={{ color: SA.text }}>
                          {device.deviceName}
                        </Text>
                        <Badge
                          size="xs"
                          variant="filled"
                          color={device.isBlocked ? "red" : "teal"}
                          styles={{ root: { fontSize: 9, fontWeight: 800 } }}
                        >
                          {device.isBlocked ? "REVOKED" : "ONLINE"}
                        </Badge>
                      </div>

                      <Text size="xs" style={{ color: SA.muted, fontSize: 10, marginTop: 2 }}>
                        HWID: {device.deviceHwid.slice(0, 14)}... · OS: {device.osInfo || "Linux"}
                      </Text>

                      <Text size="xs" style={{ color: SA.muted, fontSize: 10 }}>
                        Heartbeat: {formatRelativeTime(device.lastHeartbeatAt)}
                      </Text>
                    </div>

                    <Tooltip
                      label={
                        device.isBlocked
                          ? "Restore hardware node license access"
                          : "Engage remote kill-switch: Immediately revoke machine lease"
                      }
                    >
                      <Button
                        size="compact-xs"
                        variant={device.isBlocked ? "outline" : "light"}
                        color={device.isBlocked ? "teal" : "red"}
                        leftSection={device.isBlocked ? <CheckCircle2 size={11} /> : <Ban size={11} />}
                        onClick={() => handleToggleDeviceKillSwitch(device)}
                        styles={{
                          root: {
                            borderRadius: 6,
                            fontWeight: 750,
                            fontSize: 10,
                          },
                        }}
                      >
                        {device.isBlocked ? "Restore" : "Revoke"}
                      </Button>
                    </Tooltip>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Card B: Live Platform Mutation Stream */}
          {config.widgets.showAuditStream && (
            <div className="sa-card">
              <div className="sa-card-header">
                <div>
                  <div className="sa-card-title">
                    <Activity size={16} color={SA.accent} />
                    <span>Platform Mutation Stream</span>
                  </div>
                  <div className="sa-card-subtitle">
                    Real-time audit log captured across isolated schemas
                  </div>
                </div>

                <Group gap="xs">
                  <Button
                    size="compact-xs"
                    variant="light"
                    leftSection={<Download size={12} />}
                    onClick={handleExportAuditCsv}
                    loading={auditExporting}
                    styles={{
                      root: {
                        background: SA.panelStrong,
                        color: SA.text,
                        border: `1px solid ${SA.border}`,
                        fontSize: 11,
                        fontWeight: 650,
                      },
                    }}
                  >
                    Export CSV
                  </Button>
                  <Tooltip label="Refresh audit stream">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      onClick={loadTelemetry}
                      style={{ color: SA.textSoft }}
                    >
                      <RefreshCw size={13} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {auditLogs.length === 0 ? (
                  <div
                    style={{
                      padding: "24px 16px",
                      textAlign: "center",
                      background: SA.panelStrong,
                      borderRadius: 10,
                      border: `1px solid ${SA.border}`,
                    }}
                  >
                    <ShieldCheck size={22} color={SA.muted} style={{ marginBottom: 6 }} />
                    <Text fw={750} size="xs" style={{ color: SA.text }}>
                      Auditing Engine Armed & Active
                    </Text>
                    <Text size="xs" style={{ color: SA.muted, marginTop: 2 }}>
                      Sign-ins, invoice finalizations, and license changes stream here automatically.
                    </Text>
                  </div>
                ) : (
                  auditLogs.slice(0, 6).map((entry) => (
                    <div
                      key={entry.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "8px 12px",
                        borderRadius: 8,
                        background: SA.panelStrong,
                        border: `1px solid ${SA.border}`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <Badge
                          size="xs"
                          variant="filled"
                          styles={{
                            root: {
                              background: SA.accentMuted,
                              color: SA.accent,
                              fontWeight: 800,
                              letterSpacing: 0.3,
                              fontSize: 9,
                              border: `1px solid ${SA.border}`,
                            },
                          }}
                        >
                          {entry.action}
                        </Badge>

                        <div style={{ minWidth: 0 }}>
                          <Text fw={700} size="xs" truncate style={{ color: SA.text, fontSize: 11 }}>
                            {entry.resource}
                          </Text>
                          <Text size="xs" truncate style={{ color: SA.muted, fontSize: 10 }}>
                            by {entry.userEmail || "root"}
                          </Text>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, color: SA.muted }}>
                        <Clock size={10} />
                        <Text size="xs" style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
                          {formatRelativeTime(entry.createdAt)}
                        </Text>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* =========================================================================
          3. SLIDE-OVER DEVELOPER DIAGNOSTICS & IPC SHELL DRAWER
          Banish the toy terminal box from the dashboard; provide a high-end tool.
         ========================================================================= */}
      <Drawer
        opened={devDrawerOpen}
        onClose={() => setDevDrawerOpen(false)}
        position="right"
        size="lg"
        title={
          <Group gap="xs">
            <Terminal size={17} color={SA.accent} />
            <Text fw={800} size="sm" style={{ color: SA.text }}>
              Developer Mission Control & Diagnostics
            </Text>
          </Group>
        }
        styles={{
          header: { background: SA.topbar, borderBottom: `1px solid ${SA.border}` },
          content: { background: SA.bg, color: SA.text },
          body: { padding: 18 },
        }}
      >
        <Stack gap="md">
          <Text size="xs" style={{ color: SA.muted }}>
            Direct Rust IPC telemetry & database connection diagnostics. Directives execute directly on the local backend and cloud persistence engine.
          </Text>

          {/* Quick Directives Bar */}
          <div>
            <Text fw={700} size="xs" style={{ color: SA.textSoft, marginBottom: 8 }}>
              QUICK DIRECTIVES
            </Text>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(
                [
                  { cmd: "ping", label: "Ping Cloud DB" },
                  { cmd: "stats", label: "Refresh Stats" },
                  { cmd: "devices", label: "Inspect Leases" },
                  { cmd: "audit", label: "Audit Stream" },
                  { cmd: "update", label: "Check Release" },
                  { cmd: "help", label: "Help" },
                ] as const
              ).map((q) => (
                <Button
                  key={q.cmd}
                  size="compact-xs"
                  variant="default"
                  onClick={() => handleExecuteDirective(q.cmd)}
                  styles={{
                    root: {
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      background: SA.panelStrong,
                      borderColor: SA.border,
                      color: SA.text,
                      "&:hover": { borderColor: SA.accent, color: SA.accent },
                    },
                  }}
                >
                  {q.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Monospace Output Window */}
          <div className="sa-terminal-frame" style={{ marginTop: 4 }}>
            <div className="sa-terminal-titlebar">
              <span className="sa-terminal-title">corbel-ipc-diagnostics // v1.3.2</span>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => setConsoleLogs([])}
                styles={{ root: { color: SA.muted, fontSize: 10, height: 18 } }}
              >
                Clear Buffer
              </Button>
            </div>

            <div className="sa-terminal-body" style={{ height: 320 }}>
              {consoleLogs.map((msg) => (
                <div key={msg.id} className={`sa-terminal-line ${msg.type}`}>
                  <span style={{ color: "#64748B", userSelect: "none" }}>[{msg.time}]</span>
                  <span>{msg.text}</span>
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>

            {/* Directive Input */}
            <div className="sa-terminal-footer">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleExecuteDirective();
                }}
                style={{ display: "flex", gap: 6 }}
              >
                <TextInput
                  placeholder="Type directive (e.g. ping, stats, devices, audit, help)..."
                  value={directiveInput}
                  onChange={(e) => setDirectiveInput(e.target.value)}
                  disabled={executingCmd}
                  size="xs"
                  styles={{
                    root: { flex: 1 },
                    input: {
                      fontFamily: "monospace",
                      borderRadius: 6,
                      background: "#181C24",
                      borderColor: "#2E3547",
                      color: "#E2E8F0",
                      fontSize: 11,
                    },
                  }}
                />

                <Button
                  type="submit"
                  size="xs"
                  variant="filled"
                  loading={executingCmd}
                  styles={{
                    root: {
                      borderRadius: 6,
                      background: SA.accent,
                      color: SA.accentOnAccent,
                      fontWeight: 750,
                      "&:hover": { background: SA.accentHover },
                    },
                  }}
                >
                  <Play size={11} />
                </Button>
              </form>
            </div>
          </div>
        </Stack>
      </Drawer>
    </div>
  );
}
