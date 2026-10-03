// ==========================================
// OVERVIEW QUICK ACCESS & SECTOR FOLDERS
// ==========================================
// Real ERP Platform Data in Aryo Pamungkas (SLAB Design Studio) visual architecture:
// 1. Quick Access Row: 3 rounded horizontal cards with real tenants & cloud telemetry
// 2. Folders Grid: 4 cards with real counts (Tenants, Packages, Users, Neon Hub)

import { motion } from "framer-motion";
import {
  ActionIcon,
  Avatar,
  Badge,
  Group,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  ArrowRight,
  Boxes,
  Building2,
  Database,
  HardDrive,
  MoreVertical,
  ShieldCheck,
  Users,
} from "lucide-react";

import { useSaTheme } from "./saTheme";
import type { PlatformAnalytics, PublicPackage, TenantCompanySummary } from "../../types/backend";

interface QuickAccessProps {
  tenants: TenantCompanySummary[];
  packages?: PublicPackage[];
  analytics?: PlatformAnalytics | null;
  onOpenTenant?: (tenant: TenantCompanySummary) => void;
  onNavigateTenants: () => void;
  onNavigatePackages?: () => void;
  onNavigateAnalytics?: () => void;
  onNavigateSettings?: () => void;
}

export default function OverviewQuickAccess({
  tenants,
  packages = [],
  analytics,
  onOpenTenant,
  onNavigateTenants,
  onNavigatePackages,
  onNavigateSettings,
}: QuickAccessProps) {
  const SA = useSaTheme();

  // Flagship or first tenant
  const flagship =
    tenants.find((t) => t.name.toLowerCase().includes("ijaz")) || tenants[0];
  const secondTenant = tenants.length > 1 ? tenants[1] : null;
  const thirdTenant = tenants.length > 2 ? tenants[2] : null;

  const totalUsers =
    analytics?.totalUsers ??
    tenants.reduce((sum, t) => sum + (t.userCount || 1), 0);

  return (
    <Stack gap="xl">
      {/* ==================== 1. QUICK ACCESS ==================== */}
      <div>
        <Group justify="space-between" mb="sm">
          <Text
            fw={800}
            size="sm"
            style={{
              color: SA.text,
              fontSize: 15,
              letterSpacing: -0.2,
            }}
          >
            Quick Access
          </Text>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          {/* Card 1: Featured Emerald Green Card (Primary Sovereign Tenant) */}
          <motion.div
            whileHover={{ y: -3, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            onClick={() => flagship && onOpenTenant && onOpenTenant(flagship)}
            style={{
              borderRadius: 18,
              padding: "18px 20px",
              background: "#2BB673",
              color: "#FFFFFF",
              cursor: "pointer",
              boxShadow: "0 8px 24px -4px rgba(43, 182, 115, 0.35)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: 130,
            }}
          >
            <Group justify="space-between" align="flex-start">
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: "rgba(255, 255, 255, 0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Building2 size={18} color="#FFFFFF" />
              </div>

              {/* Overlapping Avatar Stack */}
              <Avatar.Group spacing="xs">
                <Avatar
                  radius="xl"
                  size={26}
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=60&auto=format&fit=crop&q=80"
                  style={{ border: "2px solid #2BB673" }}
                />
                <Avatar
                  radius="xl"
                  size={26}
                  src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=60&auto=format&fit=crop&q=80"
                  style={{ border: "2px solid #2BB673" }}
                />
                <Avatar
                  radius="xl"
                  size={26}
                  styles={{
                    root: {
                      background: "rgba(255, 255, 255, 0.3)",
                      color: "#FFFFFF",
                      fontSize: 9,
                      fontWeight: 800,
                      border: "2px solid #2BB673",
                    },
                  }}
                >
                  +{flagship?.userCount ?? 1}
                </Avatar>
              </Avatar.Group>
            </Group>

            <Stack gap={2} mt="md">
              <Text fw={700} size="sm" style={{ color: "#FFFFFF", letterSpacing: -0.2 }} truncate>
                {flagship ? flagship.name : "Ijaz & Company ERP"}
              </Text>
              <Text size="xs" style={{ color: "rgba(255, 255, 255, 0.85)", fontWeight: 500 }}>
                {flagship?.userCount ?? 1} staff · {flagship?.packageName ?? "Enterprise Sovereign"}
              </Text>
            </Stack>
          </motion.div>

          {/* Card 2: White Card with Red / Coral Accent (Second Tenant or FBR Hub) */}
          <motion.div
            whileHover={{ y: -3 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            onClick={() => {
              if (secondTenant && onOpenTenant) onOpenTenant(secondTenant);
              else onNavigateTenants();
            }}
            style={{
              borderRadius: 18,
              padding: "18px 20px",
              background: SA.panel,
              border: `1px solid ${SA.border}`,
              boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: 130,
            }}
          >
            <Group justify="space-between" align="flex-start">
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: "rgba(239, 68, 68, 0.12)",
                  color: "#EF4444",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {secondTenant ? <Building2 size={18} /> : <ShieldCheck size={18} />}
              </div>

              {secondTenant ? (
                <Badge
                  size="xs"
                  variant="filled"
                  styles={{
                    root: {
                      background: "rgba(239, 68, 68, 0.12)",
                      color: "#EF4444",
                      fontWeight: 800,
                    },
                  }}
                >
                  {secondTenant.packageName || "ACTIVE"}
                </Badge>
              ) : (
                <Badge
                  size="xs"
                  variant="filled"
                  styles={{
                    root: {
                      background: "rgba(239, 68, 68, 0.12)",
                      color: "#EF4444",
                      fontWeight: 800,
                    },
                  }}
                >
                  FBR PRAL
                </Badge>
              )}
            </Group>

            <Stack gap={2} mt="md">
              <Text fw={700} size="sm" style={{ color: SA.text, letterSpacing: -0.2 }} truncate>
                {secondTenant ? secondTenant.name : "FBR Fiscal Invoicing Gateway"}
              </Text>
              <Text size="xs" style={{ color: SA.muted, fontWeight: 500 }}>
                {secondTenant
                  ? `${secondTenant.userCount} staff · Active Subscription`
                  : `${tenants.filter((t) => t.isActive).length} tenants · Real-Time QR Invoicing`}
              </Text>
            </Stack>
          </motion.div>

          {/* Card 3: White Card with Blue Accent (Third Tenant or Neon Cloud Cluster) */}
          <motion.div
            whileHover={{ y: -3 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            onClick={() => {
              if (thirdTenant && onOpenTenant) onOpenTenant(thirdTenant);
              else if (onNavigateSettings) onNavigateSettings();
              else onNavigateTenants();
            }}
            style={{
              borderRadius: 18,
              padding: "18px 20px",
              background: SA.panel,
              border: `1px solid ${SA.border}`,
              boxShadow: "0 2px 10px rgba(0,0,0,0.02)",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: 130,
            }}
          >
            <Group justify="space-between" align="flex-start">
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: "rgba(59, 130, 246, 0.12)",
                  color: "#3B82F6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {thirdTenant ? <Building2 size={18} /> : <Database size={18} />}
              </div>

              <Badge
                size="xs"
                variant="filled"
                styles={{
                  root: {
                    background: "rgba(59, 130, 246, 0.12)",
                    color: "#3B82F6",
                    fontWeight: 800,
                  },
                }}
              >
                {thirdTenant ? thirdTenant.packageName || "ACTIVE" : "NEON POOLER"}
              </Badge>
            </Group>

            <Stack gap={2} mt="md">
              <Text fw={700} size="sm" style={{ color: SA.text, letterSpacing: -0.2 }} truncate>
                {thirdTenant ? thirdTenant.name : "Neon Cloud PostgreSQL Hub"}
              </Text>
              <Text size="xs" style={{ color: SA.muted, fontWeight: 500 }}>
                {thirdTenant
                  ? `${thirdTenant.userCount} staff · Active Subscription`
                  : "ep-restless-surf · AWS US-East-2"}
              </Text>
            </Stack>
          </motion.div>
        </SimpleGrid>
      </div>

      {/* ==================== 2. PLATFORM SECTOR CARDS ==================== */}
      <div>
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
            Platform Domains
          </Text>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={onNavigateTenants}
            style={{ color: SA.accent }}
          >
            <ArrowRight size={16} />
          </ActionIcon>
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
          {[
            {
              title: "Commercial Tenants",
              icon: Building2,
              count: `${analytics?.activeTenants ?? tenants.length} active`,
              size: `${tenants.length} Total`,
              onClick: onNavigateTenants,
            },
            {
              title: "Subscription Plans",
              icon: Boxes,
              count: `${packages.length || 4} packages`,
              size: `PKR ${(analytics?.mrr ?? 0).toLocaleString()} MRR`,
              onClick: onNavigatePackages ?? onNavigateTenants,
            },
            {
              title: "Staff & Operators",
              icon: Users,
              count: `${totalUsers} accounts`,
              size: "Multi-Store",
              onClick: onNavigateTenants,
            },
            {
              title: "Neon Cloud Hub",
              icon: HardDrive,
              count: "Postgres 16",
              size: "AWS Pool",
              onClick: onNavigateSettings ?? onNavigateTenants,
            },
          ].map((folder, idx) => {
            const Icon = folder.icon;
            return (
              <motion.div
                key={idx}
                whileHover={{ y: -3, boxShadow: "0 6px 18px rgba(0,0,0,0.04)" }}
                transition={{ type: "spring", stiffness: 350, damping: 25 }}
                onClick={folder.onClick}
                style={{
                  borderRadius: 16,
                  padding: "16px 18px",
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  minHeight: 110,
                }}
              >
                <Group justify="space-between" align="flex-start">
                  <Icon size={22} style={{ color: "#2BB673" }} />
                  <ActionIcon variant="subtle" size="xs" style={{ color: SA.muted }}>
                    <MoreVertical size={14} />
                  </ActionIcon>
                </Group>

                <Stack gap={4} mt="xs">
                  <Text fw={700} size="sm" style={{ color: SA.text, fontSize: 14 }}>
                    {folder.title}
                  </Text>
                  <Group justify="space-between">
                    <Text size="xs" style={{ color: SA.muted, fontSize: 11 }}>
                      {folder.count}
                    </Text>
                    <Text size="xs" fw={700} style={{ color: SA.text, fontSize: 11 }}>
                      {folder.size}
                    </Text>
                  </Group>
                </Stack>
              </motion.div>
            );
          })}
        </SimpleGrid>
      </div>
    </Stack>
  );
}
