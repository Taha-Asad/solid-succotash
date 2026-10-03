// ==========================================
// RAINBOW GAUGE & PLATFORM TELEMETRY INSPECTOR
// ==========================================
// Real ERP Platform Telemetry in Aryo Pamungkas (SLAB Design Studio) visual architecture:
// 1. Header: Notification bell + Hi, User Profile
// 2. 4-Segment Semi-Circular Rainbow Arc Gauge: Real Tenant Quota Capacity
// 3. Breakdown rows: Active Tenants, Staff Accounts, Neon Cloud DB, Subscription Tiers
// 4. Promo Card: Plan & Quota Management

import {
  Avatar,
  Button,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import {
  Bell,
  Boxes,
  Building2,
  Database,
  HardDrive,
  Users,
} from "lucide-react";

import { useSaTheme } from "./saTheme";
import type { PlatformAnalytics, PublicPackage, PublicUser, TenantCompanySummary } from "../../types/backend";

interface RainbowGaugeProps {
  user?: PublicUser;
  tenants?: TenantCompanySummary[];
  packages?: PublicPackage[];
  analytics?: PlatformAnalytics | null;
  totalCapacity?: number;
  onRunDiagnostics?: () => void;
  onNavigatePackages?: () => void;
}

export default function RainbowGauge({
  user,
  tenants = [],
  packages = [],
  analytics,
  totalCapacity = 50,
  onRunDiagnostics,
  onNavigatePackages,
}: RainbowGaugeProps) {
  const SA = useSaTheme();

  const activeTenants = analytics?.activeTenants ?? tenants.filter((t) => t.isActive).length;
  const totalTenants = analytics?.totalTenants ?? tenants.length;
  const totalUsers =
    analytics?.totalUsers ??
    tenants.reduce((sum, t) => sum + (t.userCount || 1), 0);
  const mrr = analytics?.mrr ?? 0;

  return (
    <Stack
      gap="lg"
      style={{
        width: 295,
        flexShrink: 0,
        background: SA.bgSidebar,
        borderInlineStart: `1px solid ${SA.border}`,
        padding: "24px 20px",
        overflowY: "auto",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div>
        {/* Header: Notification Bell + Hi, User Profile */}
        <Group justify="space-between" align="center" mb="md">
          {/* Notification bell */}
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: SA.panelStrong,
              border: `1px solid ${SA.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: SA.text,
              cursor: "pointer",
            }}
          >
            <Bell size={16} />
          </div>

          {/* User profile */}
          <Group gap="xs">
            <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 13 }}>
              Hi, {user?.fullName?.split(" ")[0] || "Taha"}
            </Text>
            <Avatar
              radius="xl"
              size={36}
              src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80&auto=format&fit=crop&q=80"
              style={{ border: "2px solid #2BB673" }}
            />
          </Group>
        </Group>

        {/* Semi-Circular Rainbow Arc Gauge (SLAB Design) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 4,
          }}
        >
          <div style={{ position: "relative", width: 210, height: 120 }}>
            <svg
              width="210"
              height="120"
              viewBox="0 0 240 140"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Segment 1: Red (Archived / Inactive) */}
              <path
                d="M 35 115 A 85 85 0 0 1 60 55"
                stroke="#EF4444"
                strokeWidth="14"
                strokeLinecap="round"
                fill="none"
              />

              {/* Segment 2: Orange (Trial / Pending) */}
              <path
                d="M 60 55 A 85 85 0 0 1 120 30"
                stroke="#F59E0B"
                strokeWidth="14"
                fill="none"
              />

              {/* Segment 3: Green (Active Licensed Tenants) */}
              <path
                d="M 120 30 A 85 85 0 0 1 189 66"
                stroke="#10B981"
                strokeWidth="14"
                fill="none"
              />

              {/* Segment 4: Blue (Cloud Available Quota) */}
              <path
                d="M 189 66 A 85 85 0 0 1 205 115"
                stroke="#3B82F6"
                strokeWidth="14"
                strokeLinecap="round"
                fill="none"
              />
            </svg>

            {/* Metric in center of arc */}
            <div
              style={{
                position: "absolute",
                bottom: 2,
                left: 0,
                right: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                fw={800}
                style={{
                  fontSize: 25,
                  color: SA.text,
                  letterSpacing: -0.6,
                  lineHeight: 1.1,
                }}
              >
                {activeTenants} / {totalCapacity}
              </Text>
              <Text size="11px" fw={500} style={{ color: SA.muted, marginTop: 2 }}>
                Active Tenants (Quota: {totalCapacity})
              </Text>
            </div>
          </div>
        </div>

        {/* Real Resource Breakdown List (SLAB Design) */}
        <Stack gap={10} mt="lg">
          {/* Active Tenants (Green) */}
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(16, 185, 129, 0.12)",
                  color: "#10B981",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Building2 size={16} />
              </div>
              <Stack gap={0}>
                <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 13 }}>
                  Active Tenants
                </Text>
                <Text size="11px" style={{ color: SA.muted }}>
                  {totalTenants} registered organizations
                </Text>
              </Stack>
            </Group>
            <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 12 }}>
              PKR {mrr.toLocaleString()}
            </Text>
          </Group>

          {/* Total Staff Users (Blue) */}
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(59, 130, 246, 0.12)",
                  color: "#3B82F6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Users size={16} />
              </div>
              <Stack gap={0}>
                <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 13 }}>
                  ERP Personnel
                </Text>
                <Text size="11px" style={{ color: SA.muted }}>
                  {totalUsers} active staff accounts
                </Text>
              </Stack>
            </Group>
            <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 12 }}>
              Multi-Store
            </Text>
          </Group>

          {/* Database Cluster (Amber) */}
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(245, 158, 11, 0.12)",
                  color: "#F59E0B",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Database size={16} />
              </div>
              <Stack gap={0}>
                <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 13 }}>
                  Neon Cloud DB
                </Text>
                <Text size="11px" style={{ color: SA.muted }}>
                  Postgres 16 AWS US-East-2
                </Text>
              </Stack>
            </Group>
            <Text fw={700} size="xs" style={{ color: "#10B981", fontSize: 12 }}>
              Online
            </Text>
          </Group>

          {/* Subscription Packages (Red / Violet) */}
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(239, 68, 68, 0.12)",
                  color: "#EF4444",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Boxes size={16} />
              </div>
              <Stack gap={0}>
                <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 13 }}>
                  SaaS Packages
                </Text>
                <Text size="11px" style={{ color: SA.muted }}>
                  {packages.length || 4} subscription tiers
                </Text>
              </Stack>
            </Group>
            <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 12 }}>
              {packages.length || 4} Plans
            </Text>
          </Group>
        </Stack>
      </div>

      {/* Plan & Quota Management Card (SLAB Design) */}
      <div
        style={{
          borderRadius: 18,
          background: SA.panelMint,
          border: `1px solid ${SA.border}`,
          padding: "18px 16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: SA.panel,
            boxShadow: "0 4px 14px rgba(43, 182, 115, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: SA.accent,
            marginBottom: 10,
          }}
        >
          <HardDrive size={24} />
        </div>

        <Text fw={800} size="xs" style={{ color: SA.text, fontSize: 14 }}>
          Corbel Sovereign Cloud
        </Text>
        <Text size="11px" style={{ color: SA.muted, marginTop: 4, lineHeight: 1.4 }}>
          Multi-Tenant Neon PostgreSQL synchronization and plan quotas active
        </Text>

        <Button
          fullWidth
          size="xs"
          radius="xl"
          mt="sm"
          onClick={() => {
            if (onNavigatePackages) onNavigatePackages();
            else if (onRunDiagnostics) onRunDiagnostics();
          }}
          styles={{
            root: {
              background: SA.gradient,
              color: "#FFFFFF",
              fontWeight: 700,
              fontSize: 12,
              height: 36,
              boxShadow: "0 4px 14px rgba(43, 182, 115, 0.35)",
              "&:hover": { filter: "brightness(1.06)" },
            },
          }}
        >
          Manage Subscription Plans
        </Button>
      </div>
    </Stack>
  );
}
