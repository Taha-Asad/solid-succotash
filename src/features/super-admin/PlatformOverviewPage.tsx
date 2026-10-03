// ==========================================
// PLATFORM OVERVIEW — Super Admin Dashboard
// ==========================================
// Designed in accordance with Aryo Pamungkas (SLAB Design Studio)
// File Manager Dashboard design:
// 1. Top Pill Search Field
// 2. Featured Emerald Quick Access Cards & Avatar Stacks
// 3. Sector & Category Folder Grid
// 4. Recent Tenants & Activity Table with colored badges
// 5. Right Inspector with Semi-Circular Rainbow Arc Gauge

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import {
  ActionIcon,
  Badge,
  Button,
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

import {
  listTenantCompanies,
} from "../../api/backend";
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

  const recent = filteredTenants.slice(0, 6);

  // File-type style color badges for the table
  const badgeStyles = [
    { bg: "rgba(59, 130, 246, 0.12)", color: "#3B82F6", label: "APP" },
    { bg: "rgba(245, 158, 11, 0.12)", color: "#F59E0B", label: "ZIP" },
    { bg: "rgba(239, 68, 68, 0.12)", color: "#EF4444", label: "PDF" },
    { bg: "rgba(16, 185, 129, 0.12)", color: "#10B981", label: "DOC" },
  ];

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        background: SA.bg,
      }}
    >
      {/* ==================== CENTER WORKSPACE ==================== */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        {/* Top Pill Search Bar (SLAB Style) */}
        <div style={{ padding: "22px 28px 12px", flexShrink: 0 }}>
          <TextInput
            placeholder="Search your tenants, packages, domains, or audit records..."
            size="md"
            radius="xl"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            leftSection={
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "rgba(43, 182, 115, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: SA.accent,
                }}
              >
                <Search size={15} />
              </div>
            }
            styles={{
              input: {
                background: SA.panel,
                border: `1px solid ${SA.border}`,
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
                color: SA.text,
                paddingLeft: 42,
                fontWeight: 500,
                fontSize: 14,
                "&:focus": {
                  borderColor: SA.accent,
                },
              },
            }}
          />
        </div>

        {/* Scrollable Main Content */}
        <ScrollArea flex={1} style={{ position: "relative" }}>
          <Stack gap="xl" p="28px" pt="8px">
            {/* Quick Access & Sectors Grid */}
            <OverviewQuickAccess
              tenants={tenants}
              onOpenTenant={onOpenTenant}
              onNavigateTenants={() => onNavigate("tenants")}
            />

            {/* Recent Files / Tenants Table Section */}
            <div style={{ marginTop: 4 }}>
              <Group justify="space-between" align="center" mb="md">
                <Text
                  fw={800}
                  size="md"
                  style={{ color: SA.text, letterSpacing: -0.3 }}
                >
                  Recent Tenants & Activity
                </Text>
                <Button
                  variant="subtle"
                  size="xs"
                  rightSection={<ArrowRight size={15} />}
                  onClick={() => onNavigate("tenants")}
                  styles={{
                    root: {
                      color: SA.accent,
                      "&:hover": { background: "rgba(43, 182, 115, 0.08)" },
                    },
                    label: { fontWeight: 700 },
                  }}
                >
                  View All
                </Button>
              </Group>

              {/* Table Container */}
              <div
                style={{
                  borderRadius: 20,
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                  boxShadow: SA.shadow,
                  overflow: "hidden",
                }}
              >
                {/* Table Header Row */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2.4fr 1.6fr 1.8fr 1fr 40px",
                    gap: 12,
                    padding: "14px 22px",
                    borderBottom: `1px solid ${SA.border}`,
                    color: SA.muted,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                  }}
                >
                  <div>Name</div>
                  <div>Last Modified</div>
                  <div>Owner / Tier</div>
                  <div>Status</div>
                  <div style={{ textAlign: "right" }}>•</div>
                </div>

                {/* Table Rows */}
                {recent.length === 0 ? (
                  <Stack align="center" gap={6} p="xl">
                    <Building2 size={36} style={{ color: SA.muted, opacity: 0.5 }} />
                    <Text size="sm" style={{ color: SA.muted }}>
                      No tenant workspaces found matching search
                    </Text>
                  </Stack>
                ) : (
                  <Stack gap={0}>
                    {recent.map((tenant, i) => {
                      const badge = badgeStyles[i % badgeStyles.length];
                      const isHighlighted = i === 0; // First item highlighted like SLAB design

                      return (
                        <motion.div
                          key={tenant.id}
                          whileHover={{ background: SA.panelHover }}
                          onClick={() => onOpenTenant && onOpenTenant(tenant)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "2.4fr 1.6fr 1.8fr 1fr 40px",
                            gap: 12,
                            alignItems: "center",
                            padding: "13px 22px",
                            borderBottom:
                              i === recent.length - 1
                                ? "none"
                                : `1px solid ${SA.border}`,
                            background: isHighlighted ? SA.panelMint : "transparent",
                            cursor: "pointer",
                            transition: "background 0.15s ease",
                          }}
                        >
                          {/* Name with File-Style Colored Badge */}
                          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 8,
                                background: badge.bg,
                                color: badge.color,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 10,
                                fontWeight: 800,
                                flexShrink: 0,
                                letterSpacing: 0.5,
                              }}
                            >
                              {badge.label}
                            </div>
                            <Stack gap={1} style={{ minWidth: 0 }}>
                              <Text
                                fw={700}
                                size="sm"
                                style={{ color: SA.text, letterSpacing: -0.2 }}
                                truncate
                              >
                                {tenant.name}
                              </Text>
                              <Text size="11px" style={{ color: SA.muted }} truncate>
                                {tenant.email || "No email registered"}
                              </Text>
                            </Stack>
                          </Group>

                          {/* Last Modified */}
                          <Text size="xs" style={{ color: SA.muted }}>
                            {tenant.createdAt
                              ? `${tenant.createdAt.slice(0, 10)} | ${tenant.createdAt.slice(11, 16)}`
                              : "Recent"}
                          </Text>

                          {/* Owner & Package Tier */}
                          <Text size="xs" fw={600} style={{ color: SA.text }} truncate>
                            {tenant.userCount} users · {tenant.packageName || "Standard"}
                          </Text>

                          {/* Status Badge */}
                          <div>
                            <Badge
                              size="xs"
                              radius="xl"
                              variant="light"
                              styles={{
                                root: {
                                  background: tenant.isActive
                                    ? "rgba(16, 185, 129, 0.12)"
                                    : "rgba(239, 68, 68, 0.12)",
                                  color: tenant.isActive ? SA.success : SA.danger,
                                  fontWeight: 700,
                                },
                              }}
                            >
                              {tenant.isActive ? "Active" : "Archived"}
                            </Badge>
                          </div>

                          {/* Actions Kebab */}
                          <div style={{ textAlign: "right" }}>
                            <ActionIcon
                              variant="subtle"
                              size="sm"
                              style={{ color: SA.muted }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onOpenTenant) onOpenTenant(tenant);
                              }}
                            >
                              <MoreVertical size={15} />
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
        totalGb={100}
        onRunDiagnostics={() => onNavigate("settings")}
      />
    </div>
  );
}
