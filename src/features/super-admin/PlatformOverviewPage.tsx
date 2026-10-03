// ==========================================
// PLATFORM OVERVIEW — Super Admin Dashboard
// ==========================================
// Exact recreation of Aryo Pamungkas (SLAB Design Studio) File Manager:
// - Centered floating pill search input
// - Quick Access cards with avatar stacks
// - 4 Folders with green outline icons
// - Recent Files / Tenants table with highlighted soft-mint row
// - Right Inspector with 4-segment rainbow arc gauge & Upgrade to PRO card

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import {
  ActionIcon,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  ArrowRight,
  Building2,
  MoreVertical,
  Search,
} from "lucide-react";

import { listTenantCompanies } from "../../api/backend";
import type { PublicUser, TenantCompanySummary } from "../../types/backend";
import { useSaTheme } from "./saTheme";
import type { SaView } from "./SuperAdminShell";
import RainbowGauge from "./RainbowGauge";
import OverviewQuickAccess from "./OverviewQuickAccess";

export default function PlatformOverviewPage({
  onNavigate,
  user,
  onOpenTenant,
}: {
  onNavigate: (v: SaView) => void;
  user?: PublicUser;
  onOpenTenant?: (tenant: TenantCompanySummary) => void;
}) {
  const SA = useSaTheme();
  const [tenants, setTenants] = useState<TenantCompanySummary[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    listTenantCompanies()
      .then((rows) => {
        if (!cancelled) {
          setTenants(rows);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTenants = useMemo(() => {
    if (!search.trim()) return tenants;
    const q = search.toLowerCase();
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.email && t.email.toLowerCase().includes(q)) ||
        (t.packageName && t.packageName.toLowerCase().includes(q)),
    );
  }, [tenants, search]);

  // File-type badges identical to Aryo Pamungkas SLAB design
  const badgeStyles = [
    { bg: "#3B82F6", color: "#FFFFFF", label: "MP4" },
    { bg: "#F59E0B", color: "#FFFFFF", label: "ZIP" },
    { bg: "#EF4444", color: "#FFFFFF", label: "PDF" },
    { bg: "#EF4444", color: "#FFFFFF", label: "PDF" },
    { bg: "#10B981", color: "#FFFFFF", label: "DOC" },
  ];

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        background: SA.panel,
      }}
    >
      {/* ==================== CENTER STAGE ==================== */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: SA.panel,
        }}
      >
        {/* Floating Pill Search Bar (SLAB Design: Search your file .....) */}
        <div style={{ padding: "20px 28px 12px", flexShrink: 0 }}>
          <TextInput
            placeholder="Search your file ....."
            size="md"
            radius="xl"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            leftSection={
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "#2BB673",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#FFFFFF",
                }}
              >
                <Search size={14} />
              </div>
            }
            styles={{
              input: {
                background: SA.panelStrong,
                border: `1px solid ${SA.border}`,
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
                color: SA.text,
                paddingLeft: 46,
                height: 44,
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 22,
                "&:focus": {
                  boxShadow: "0 0 0 2px rgba(43, 182, 115, 0.25)",
                  borderColor: "#2BB673",
                },
              },
            }}
          />
        </div>

        {/* Scrollable Center Workspace */}
        <ScrollArea flex={1}>
          <Stack gap="xl" p="28px" pt="10px">
            {/* Quick Access & Folders */}
            <OverviewQuickAccess
              tenants={tenants}
              onOpenTenant={onOpenTenant}
              onNavigateTenants={() => onNavigate("tenants")}
            />

            {/* Recent Files Table Section (SLAB Design) */}
            <div style={{ marginTop: 2 }}>
              <Group justify="space-between" align="center" mb="sm">
                <Text
                  fw={800}
                  size="sm"
                  style={{
                    color: SA.text,
                    fontSize: 15,
                    letterSpacing: -0.2,
                  }}
                >
                  Recent Files
                </Text>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={() => onNavigate("tenants")}
                  style={{ color: SA.accent }}
                >
                  <ArrowRight size={16} />
                </ActionIcon>
              </Group>

              {/* Table Container */}
              <div
                style={{
                  borderRadius: 18,
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.02)",
                  overflow: "hidden",
                }}
              >
                {/* Header Row */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "3fr 2fr 1.6fr 40px",
                    gap: 12,
                    padding: "13px 20px",
                    borderBottom: `1px solid ${SA.border}`,
                    color: SA.muted,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <div>Name</div>
                  <div>Last modified</div>
                  <div>Member</div>
                  <div style={{ textAlign: "right" }}>•</div>
                </div>

                {/* Rows */}
                {filteredTenants.length === 0 ? (
                  <Stack align="center" gap={6} p="xl">
                    <Building2 size={32} style={{ color: SA.muted, opacity: 0.5 }} />
                    <Text size="xs" style={{ color: SA.muted }}>
                      No files or tenants found
                    </Text>
                  </Stack>
                ) : (
                  <Stack gap={0}>
                    {filteredTenants.map((tenant, i) => {
                      const badge = badgeStyles[i % badgeStyles.length];
                      // Row 1 (index 1) in the SLAB mockup is highlighted with soft mint green
                      const isHighlighted = i === 1;

                      return (
                        <motion.div
                          key={tenant.id}
                          whileHover={{ background: isHighlighted ? (SA.panelMint === "#E8F8F0" ? "#E0F5EB" : "#134B3D") : SA.panelHover }}
                          onClick={() => onOpenTenant && onOpenTenant(tenant)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "3fr 2fr 1.6fr 40px",
                            gap: 12,
                            alignItems: "center",
                            padding: "12px 20px",
                            borderBottom:
                              i === filteredTenants.length - 1
                                ? "none"
                                : `1px solid ${SA.border}`,
                            background: isHighlighted ? SA.panelMint : "transparent",
                            cursor: "pointer",
                            transition: "background 0.15s ease",
                          }}
                        >
                          {/* Name with Colored File Extension Badge */}
                          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                background: badge.bg,
                                color: badge.color,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 9,
                                fontWeight: 800,
                                flexShrink: 0,
                                letterSpacing: 0.5,
                              }}
                            >
                              {badge.label}
                            </div>
                            <Text
                              fw={600}
                              size="xs"
                              style={{
                                color: isHighlighted ? SA.accent : SA.text,
                                fontSize: 13,
                              }}
                              truncate
                            >
                              {tenant.name}
                            </Text>
                          </Group>

                          {/* Last modified */}
                          <Text
                            size="xs"
                            style={{
                              color: isHighlighted ? SA.accent : SA.muted,
                              fontSize: 12,
                            }}
                          >
                            {tenant.createdAt
                              ? `${tenant.createdAt.slice(0, 10)} | ${tenant.createdAt.slice(11, 16)}`
                              : "Nov 10, 2026 | 11:15"}
                          </Text>

                          {/* Member / Tier */}
                          <Text
                            size="xs"
                            fw={500}
                            style={{
                              color: isHighlighted ? SA.accent : SA.muted,
                              fontSize: 12,
                            }}
                            truncate
                          >
                            {tenant.userCount > 1
                              ? `${tenant.userCount} members`
                              : "Only you"}
                          </Text>

                          {/* Action kebab */}
                          <div style={{ textAlign: "right" }}>
                            <ActionIcon
                              variant="subtle"
                              size="xs"
                              style={{ color: isHighlighted ? SA.accent : SA.muted }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onOpenTenant) onOpenTenant(tenant);
                              }}
                            >
                              <MoreVertical size={14} />
                            </ActionIcon>
                          </div>
                        </motion.div>
                      );
                    })}
                  </Stack>
                )}
              </div>
            </div>
          </Stack>
        </ScrollArea>
      </div>

      {/* ==================== RIGHT INSPECTOR PANEL ==================== */}
      <RainbowGauge
        user={user}
        usedGb={42.4}
        totalGb={50}
        onRunDiagnostics={() => onNavigate("settings")}
      />
    </div>
  );
}
