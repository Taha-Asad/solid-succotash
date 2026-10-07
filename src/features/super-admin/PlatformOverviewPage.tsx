// ==========================================================================
// CORBEL SUPER ADMIN — SOVEREIGN DEVELOPER MISSION CONTROL
// Pure Developer Telemetry, Hardware Kill-Switch & Terminal Diagnostics
// Zero cartoon slop · Mathematical WCAG AAA/AA Contrast · Fully Responsive
// ==========================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Loader,
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
  Database,
  ExternalLink,
  KeyRound,
  Laptop,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
  Wifi,
  Zap,
} from "lucide-react";

import {
  checkForUpdates,
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
import { useSaTheme } from "./saTheme";
import type { SaView } from "./SuperAdminShell";

interface ConsoleMessage {
  id: string;
  time: string;
  text: string;
  type: "info" | "success" | "warn" | "error";
}

type WorkspaceFilter = "all" | "cloud" | "desktop";

export default function PlatformOverviewPage({
  user,
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

  // Telemetry & Data States
  const [tenants, setTenants] = useState<TenantCompanySummary[]>([]);
  const [devices, setDevices] = useState<PublicDeviceActivation[]>([]);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Latency Probe State
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [pinging, setPinging] = useState(false);

  // Workspaces Filter State
  const [search, setSearch] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>("all");

  // Terminal Console State
  const [directiveInput, setDirectiveInput] = useState("");
  const [executingCmd, setExecutingCmd] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleMessage[]>([
    {
      id: "init",
      time: new Date().toLocaleTimeString(),
      text: "Corbel Sovereign Workstation v1.3.1 initialized. Telemetry channels live.",
      type: "info",
    },
  ]);

  const appendLog = useCallback(
    (text: string, type: "info" | "success" | "warn" | "error" = "info") => {
      setConsoleLogs((prev) => [
        ...prev.slice(-30),
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

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLogs]);

  // Measured Neon Cloud Ping Probe
  const handlePing = useCallback(() => {
    setPinging(true);
    const start = performance.now();
    listTenantCompanies()
      .then(() => {
        const elapsed = Math.round(performance.now() - start);
        setLatencyMs(elapsed);
        appendLog(`[PING] Neon PostgreSQL cluster round-trip: ${elapsed}ms. Pool healthy.`, "success");
      })
      .catch((err) => {
        setLatencyMs(null);
        appendLog(`[PING FAIL] Database round-trip probe: ${getErrorMessage(err)}`, "error");
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
        listAuditEntries(15, 0).catch(() => [] as AuditEntry[]),
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
  }, [appendLog]);

  useEffect(() => {
    loadTelemetry();
    handlePing();
  }, [loadTelemetry, handlePing, refreshKey]);

  // 1-Click Hardware Remote Kill-Switch Action
  const handleToggleDeviceKillSwitch = async (device: PublicDeviceActivation) => {
    const isBlocking = !device.isBlocked;
    try {
      if (isBlocking) {
        await saasRevokeDevice(device.id, "Disabled via Sovereign Developer Kill-Switch");
        appendLog(`[KILL-SWITCH ENGAGED] Hardware node blocked: ${device.deviceName} (${device.deviceHwid})`, "warn");
      } else {
        await saasUnblockDevice(device.id);
        appendLog(`[KILL-SWITCH RELEASED] Hardware node unblocked: ${device.deviceName} (${device.deviceHwid})`, "success");
      }

      // Refresh devices immediately
      const refreshed = await saasListActiveDevices();
      setDevices(refreshed);
    } catch (err) {
      appendLog(`Kill-switch execution error: ${getErrorMessage(err)}`, "error");
    }
  };

  // Terminal Directive Executor
  const handleExecuteDirective = async (customCmd?: string) => {
    const raw = (customCmd !== undefined ? customCmd : directiveInput).trim();
    if (!raw) return;
    const cmd = raw.toLowerCase();
    setExecutingCmd(true);
    appendLog(`> ${raw}`, "info");

    try {
      if (cmd === "help") {
        appendLog(
          "Available developer directives:\n" +
            "  • ping / probe     — Measure real database round-trip pool latency\n" +
            "  • stats / summary  — Display live MRR, tenant counts, and user metrics\n" +
            "  • devices / nodes  — Enumerate all connected physical hardware devices\n" +
            "  • audit / logs     — Inspect the latest platform mutation entries\n" +
            "  • update / check   — Check GitHub release endpoint for desktop binaries\n" +
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
          `[STATS] MRR: PKR ${a.mrr.toLocaleString()} · Workspaces: ${a.activeTenants}/${a.totalTenants} Active · Fleet Users: ${a.totalUsers}`,
          "success",
        );
      } else if (cmd === "devices" || cmd === "nodes") {
        const d = await saasListActiveDevices();
        setDevices(d);
        appendLog(`[FLEET] ${d.length} physical nodes registered:`, "info");
        d.forEach((node) => {
          appendLog(`  • [${node.isBlocked ? "BLOCKED" : "ONLINE"}] ${node.deviceName} (${node.deviceHwid.slice(0, 12)}...) · OS: ${node.osInfo || "Linux"}`, node.isBlocked ? "warn" : "info");
        });
      } else if (cmd === "audit" || cmd === "logs") {
        const entries = await listAuditEntries(5, 0);
        appendLog(`[AUDIT] Fetched ${entries.length} recent platform audit entries:`, "info");
        entries.forEach((e) => {
          appendLog(`  • [${e.action}] ${e.userEmail || "root"} on ${e.resource} (${new Date(e.createdAt).toLocaleTimeString()})`, "info");
        });
      } else if (cmd === "update" || cmd === "check") {
        appendLog("Querying GitHub release endpoint for desktop binary updates...", "info");
        const res = await checkForUpdates();
        if (res.available) {
          appendLog(`New update available: v${res.update?.version}! Use App Updates to install.`, "warn");
        } else {
          appendLog(`Host is on latest release (v${res.currentVersion}). Zero pending updates.`, "success");
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
      if (workspaceFilter === "desktop") {
        return w.name.toLowerCase().includes("branch") || w.name.toLowerCase().includes("desktop");
      }
      if (workspaceFilter === "cloud") {
        return !w.name.toLowerCase().includes("branch");
      }
      return true;
    });
  }, [tenants, search, workspaceFilter]);

  const activeNodesCount = devices.filter((d) => !d.isBlocked).length;
  const blockedNodesCount = devices.filter((d) => d.isBlocked).length;
  const operatorName = user?.fullName || "Taha Asadullah";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        padding: "clamp(16px, 2.5vw, 32px)",
        gap: 20,
      }}
    >
      {/* ==================== 1. TELEMETRY HERO STRIP ==================== */}
      <div className="sa-telemetry-strip">
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 220 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: SA.accentMuted,
              display: "grid",
              placeItems: "center",
              color: SA.accent,
            }}
          >
            <ShieldCheck size={18} />
          </div>
          <div>
            <Text fw={800} size="sm" style={{ color: SA.text, lineHeight: 1.2 }}>
              {operatorName}
            </Text>
            <Text size="xs" style={{ color: SA.muted }}>
              Sovereign Root Cockpit
            </Text>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginInlineStart: "auto" }}>
          {/* Measured DB Latency */}
          <div className="sa-telemetry-chip">
            <Database size={14} color={SA.accent} />
            <span>Neon PG Pool:</span>
            <strong>{latencyMs !== null ? `${latencyMs}ms` : "Measuring..."}</strong>
            <Tooltip label="Test live round-trip latency to Neon database">
              <Button
                size="compact-xs"
                variant="subtle"
                loading={pinging}
                onClick={handlePing}
                styles={{
                  root: {
                    padding: "0 4px",
                    height: 20,
                    color: SA.accent,
                    "&:hover": { background: SA.accentMuted },
                  },
                }}
              >
                <RefreshCw size={12} />
              </Button>
            </Tooltip>
          </div>

          {/* Connected Hardware Nodes */}
          <div className="sa-telemetry-chip">
            <Laptop size={14} color={SA.accent} />
            <span>Hardware Nodes:</span>
            <strong>{activeNodesCount} Online</strong>
            {blockedNodesCount > 0 && (
              <span style={{ color: SA.danger, fontSize: 11, fontWeight: 800 }}>
                ({blockedNodesCount} Blocked)
              </span>
            )}
          </div>

          {/* Provisioned Workspaces */}
          <div className="sa-telemetry-chip">
            <Building2 size={14} color={SA.accent} />
            <span>Workspaces:</span>
            <strong>{tenants.length} Active</strong>
          </div>

          {/* Platform MRR */}
          <div className="sa-telemetry-chip">
            <Activity size={14} color={SA.accent} />
            <span>Platform MRR:</span>
            <strong>PKR {(analytics?.mrr || 0).toLocaleString()}</strong>
          </div>

          {/* Engine Version */}
          <div className="sa-telemetry-chip">
            <Cpu size={14} color={SA.accent} />
            <span>Engine:</span>
            <strong>v1.3.1 (Tauri 2.0)</strong>
          </div>
        </div>
      </div>

      {/* ==================== 2. DIRECTIVE WORKBENCH ==================== */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "14px 20px",
          background: SA.panel,
          border: `1px solid ${SA.border}`,
          borderRadius: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={16} color={SA.accent} />
          <Text fw={750} size="sm" style={{ color: SA.text }}>
            Operator Directives
          </Text>
          <Text size="xs" style={{ color: SA.muted }}>
            Instant 1-click execution across nodes
          </Text>
        </div>

        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            leftSection={<KeyRound size={14} />}
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

          <Button
            size="xs"
            variant="default"
            leftSection={<Plus size={14} />}
            onClick={() => onNavigate("tenants")}
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
            Provision Workspace
          </Button>

          <Button
            size="xs"
            variant="default"
            leftSection={<Wifi size={14} />}
            loading={pinging}
            onClick={handlePing}
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
            Database Ping
          </Button>

          <Button
            size="xs"
            variant="default"
            leftSection={<Terminal size={14} />}
            onClick={() => handleExecuteDirective("audit")}
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
            Audit Snapshot
          </Button>
        </Group>
      </div>

      {/* ==================== 3. 2-COLUMN RESPONSIVE BENTO DECK ==================== */}
      <div className="sa-bento-grid">
        {/* ==================== COLUMN 1: WORKSPACES & AUDIT (60%) ==================== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Card: Provisioned Workspaces Directory */}
          <div className="sa-card">
            <div className="sa-card-header">
              <div>
                <div className="sa-card-title">
                  <Building2 size={18} color={SA.accent} />
                  <span>Provisioned Workspaces Directory</span>
                </div>
                <div className="sa-card-subtitle">
                  Isolated schemas and operational tenant nodes ({filteredWorkspaces.length} of {tenants.length})
                </div>
              </div>

              <Button
                size="compact-xs"
                variant="subtle"
                rightSection={<ArrowRight size={13} />}
                onClick={() => onNavigate("tenants")}
                styles={{
                  root: {
                    color: SA.accent,
                    fontWeight: 750,
                    fontSize: 12,
                    "&:hover": { background: SA.accentMuted },
                  },
                }}
              >
                All Tenants
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
                marginBottom: 14,
              }}
            >
              <TextInput
                placeholder="Filter by workspace name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftSection={<Search size={14} color={SA.muted} />}
                size="xs"
                styles={{
                  root: { flex: 1, minWidth: 200 },
                  input: {
                    borderRadius: 999,
                    background: SA.panelStrong,
                    borderColor: SA.border,
                    color: SA.text,
                    fontSize: 12,
                  },
                }}
              />

              <Group gap={6}>
                {(["all", "cloud", "desktop"] as WorkspaceFilter[]).map((filter) => (
                  <Button
                    key={filter}
                    size="compact-xs"
                    variant={workspaceFilter === filter ? "filled" : "default"}
                    onClick={() => setWorkspaceFilter(filter)}
                    styles={{
                      root: {
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "capitalize",
                        background:
                          workspaceFilter === filter ? SA.accent : SA.panelStrong,
                        color:
                          workspaceFilter === filter ? SA.accentOnAccent : SA.textSoft,
                        borderColor: SA.border,
                      },
                    }}
                  >
                    {filter === "all" ? "All" : filter === "cloud" ? "Cloud" : "Desktop"}
                  </Button>
                ))}
              </Group>
            </div>

            {/* Workspaces Scrollable Table */}
            <div className="sa-table-scroll">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: `1px solid ${SA.border}`,
                      background: SA.panelStrong,
                      textAlign: "start",
                    }}
                  >
                    <th style={{ padding: "10px 14px", color: SA.muted, fontWeight: 750, fontSize: 11 }}>
                      WORKSPACE
                    </th>
                    <th style={{ padding: "10px 14px", color: SA.muted, fontWeight: 750, fontSize: 11 }}>
                      PLAN
                    </th>
                    <th style={{ padding: "10px 14px", color: SA.muted, fontWeight: 750, fontSize: 11 }}>
                      SEATS
                    </th>
                    <th style={{ padding: "10px 14px", color: SA.muted, fontWeight: 750, fontSize: 11 }}>
                      STATUS
                    </th>
                    <th style={{ padding: "10px 14px", textAlign: "end", color: SA.muted, fontWeight: 750, fontSize: 11 }}>
                      ACTION
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkspaces.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "32px 16px", textAlign: "center", color: SA.muted }}>
                        {loading ? <Loader size="sm" color={SA.accent} /> : "No workspaces match your query."}
                      </td>
                    </tr>
                  ) : (
                    filteredWorkspaces.map((t) => (
                      <tr
                        key={t.id}
                        style={{
                          borderBottom: `1px solid ${SA.border}`,
                          transition: "background 0.12s ease",
                        }}
                      >
                        <td style={{ padding: "12px 14px" }}>
                          <Text fw={750} size="xs" style={{ color: SA.text }}>
                            {t.name}
                          </Text>
                          <Text size="xs" style={{ color: SA.muted, fontSize: 11 }}>
                            {t.email || "Standalone workspace"}
                          </Text>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <Badge
                            size="xs"
                            variant="light"
                            styles={{
                              root: {
                                background: SA.accentMuted,
                                color: SA.accent,
                                fontWeight: 750,
                              },
                            }}
                          >
                            {t.packageName || "Standard"}
                          </Badge>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
                          <Text fw={700} size="xs" style={{ color: SA.text, fontVariantNumeric: "tabular-nums" }}>
                            {t.userCount || 1} Users
                          </Text>
                        </td>
                        <td style={{ padding: "12px 14px" }}>
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
                              }}
                            />
                            {!t.isActive ? "Suspended" : "Operational"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "end" }}>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={<ExternalLink size={12} />}
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

          {/* Card: Live Platform Audit Mutations Feed */}
          <div className="sa-card">
            <div className="sa-card-header">
              <div>
                <div className="sa-card-title">
                  <Activity size={18} color={SA.accent} />
                  <span>Live Platform Audit Mutations</span>
                </div>
                <div className="sa-card-subtitle">
                  Real backend mutation events captured from isolated tenant databases
                </div>
              </div>

              <Tooltip label="Refresh audit log stream">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={loadTelemetry}
                  styles={{
                    root: {
                      color: SA.textSoft,
                      "&:hover": { color: SA.accent, background: SA.accentMuted },
                    },
                  }}
                >
                  <RefreshCw size={14} />
                </Button>
              </Tooltip>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {auditLogs.length === 0 ? (
                <Text size="xs" style={{ color: SA.muted, textAlign: "center", padding: "18px 0" }}>
                  Zero recent audit logs recorded.
                </Text>
              ) : (
                auditLogs.slice(0, 7).map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 12px",
                      borderRadius: 10,
                      background: SA.panelStrong,
                      border: `1px solid ${SA.border}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <Badge
                        size="xs"
                        variant="filled"
                        styles={{
                          root: {
                            background: SA.accentMuted,
                            color: SA.accent,
                            fontWeight: 800,
                            letterSpacing: 0.3,
                            fontSize: 10,
                            border: `1px solid ${SA.border}`,
                          },
                        }}
                      >
                        {entry.action}
                      </Badge>

                      <div style={{ minWidth: 0 }}>
                        <Text fw={700} size="xs" truncate style={{ color: SA.text, fontSize: 12 }}>
                          {entry.resource}
                        </Text>
                        <Text size="xs" truncate style={{ color: SA.muted, fontSize: 11 }}>
                          by {entry.userEmail || "root"}
                        </Text>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, color: SA.muted }}>
                      <Clock size={11} />
                      <Text size="xs" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                        {new Date(entry.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </Text>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ==================== COLUMN 2: HARDWARE & OPS (40%) ==================== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Card: Connected Hardware Nodes & Remote Kill-Switch */}
          <div className="sa-card">
            <div className="sa-card-header">
              <div>
                <div className="sa-card-title">
                  <Cpu size={18} color={SA.accent} />
                  <span>Physical Hardware Fleet & Kill-Switch</span>
                </div>
                <div className="sa-card-subtitle">
                  Active desktop nodes with instant remote revoke authority
                </div>
              </div>

              <Button
                size="compact-xs"
                variant="subtle"
                rightSection={<ArrowRight size={13} />}
                onClick={() => onNavigate("licensing")}
                styles={{
                  root: {
                    color: SA.accent,
                    fontWeight: 750,
                    fontSize: 12,
                    "&:hover": { background: SA.accentMuted },
                  },
                }}
              >
                Fleet Keys
              </Button>
            </div>

            {/* Devices List */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {devices.length === 0 ? (
                <div
                  style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    background: SA.panelStrong,
                    borderRadius: 12,
                    border: `1px solid ${SA.border}`,
                  }}
                >
                  <Laptop size={24} color={SA.muted} style={{ marginBottom: 6 }} />
                  <Text fw={700} size="xs" style={{ color: SA.text }}>
                    Zero physical machines bound yet
                  </Text>
                  <Text size="xs" style={{ color: SA.muted, marginTop: 2 }}>
                    Issue an activation key to tether a desktop binary.
                  </Text>
                </div>
              ) : (
                devices.map((device) => (
                  <div
                    key={device.id}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 12,
                      background: device.isBlocked ? `${SA.danger}10` : SA.panelStrong,
                      border: `1px solid ${device.isBlocked ? SA.danger : SA.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Text fw={750} size="xs" style={{ color: SA.text }}>
                          {device.deviceName}
                        </Text>
                        <Badge
                          size="xs"
                          variant="filled"
                          color={device.isBlocked ? "red" : "teal"}
                          styles={{ root: { fontSize: 9, fontWeight: 800 } }}
                        >
                          {device.isBlocked ? "BLOCKED" : "ONLINE"}
                        </Badge>
                      </div>

                      <Text size="xs" style={{ color: SA.muted, fontSize: 11, marginTop: 2 }}>
                        HWID: {device.deviceHwid.slice(0, 16)}... · OS: {device.osInfo || "Linux"}
                      </Text>

                      <Text size="xs" style={{ color: SA.muted, fontSize: 10, marginTop: 1 }}>
                        Heartbeat: {new Date(device.lastHeartbeatAt).toLocaleTimeString()}
                      </Text>
                    </div>

                    <Tooltip
                      label={
                        device.isBlocked
                          ? "Unblock hardware node to allow sync"
                          : "Engage remote kill-switch: Immediately revoke access"
                      }
                    >
                      <Button
                        size="compact-xs"
                        variant={device.isBlocked ? "outline" : "light"}
                        color={device.isBlocked ? "teal" : "red"}
                        leftSection={device.isBlocked ? <CheckCircle2 size={12} /> : <Ban size={12} />}
                        onClick={() => handleToggleDeviceKillSwitch(device)}
                        styles={{
                          root: {
                            borderRadius: 8,
                            fontWeight: 750,
                            fontSize: 11,
                          },
                        }}
                      >
                        {device.isBlocked ? "Unblock" : "Block"}
                      </Button>
                    </Tooltip>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Card: Interactive Developer Diagnostics Console */}
          <div className="sa-card">
            <div className="sa-card-header">
              <div>
                <div className="sa-card-title">
                  <Terminal size={18} color={SA.accent} />
                  <span>Terminal Diagnostics Console</span>
                </div>
                <div className="sa-card-subtitle">
                  Functional operator shell with direct Rust backend communication
                </div>
              </div>

              <Group gap={6}>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setConsoleLogs([])}
                  styles={{
                    root: {
                      color: SA.muted,
                      fontSize: 11,
                      "&:hover": { color: SA.text },
                    },
                  }}
                >
                  Clear
                </Button>
              </Group>
            </div>

            {/* Terminal Log Stream */}
            <div className="sa-terminal-box">
              {consoleLogs.map((msg) => (
                <div key={msg.id} className={`sa-terminal-line ${msg.type}`}>
                  <span style={{ color: "#68706B", userSelect: "none" }}>[{msg.time}]</span>
                  <span>{msg.text}</span>
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>

            {/* Quick Command Chips */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
              {(["ping", "stats", "devices", "audit", "update"] as const).map((quickCmd) => (
                <button
                  key={quickCmd}
                  type="button"
                  onClick={() => handleExecuteDirective(quickCmd)}
                  style={{
                    padding: "3px 9px",
                    borderRadius: 6,
                    background: SA.panelStrong,
                    border: `1px solid ${SA.border}`,
                    color: SA.accent,
                    fontSize: 11,
                    fontFamily: "monospace",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  +{quickCmd}
                </button>
              ))}
            </div>

            {/* Command Input Field */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleExecuteDirective();
              }}
              style={{ display: "flex", gap: 8 }}
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
                    borderRadius: 8,
                    background: SA.panelStrong,
                    borderColor: SA.border,
                    color: SA.text,
                    fontSize: 12,
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
                    borderRadius: 8,
                    background: SA.accent,
                    color: SA.accentOnAccent,
                    fontWeight: 750,
                    "&:hover": { background: SA.accentHover },
                  },
                }}
              >
                <Play size={12} />
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
