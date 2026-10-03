// ==========================================
// OVERVIEW QUICK ACCESS & SECTOR CARDS
// ==========================================
// Matches Aryo Pamungkas SLAB Design Studio layout:
// - Featured emerald green Quick Access card + white cards with avatar stacks
// - 4 Folder Category cards with emerald folder icons and kebab menus

import { motion } from "framer-motion";
import {
  ActionIcon,
  Avatar,
  Group,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  ArrowRight,
  Database,
  FileText,
  Folder,
  MoreVertical,
} from "lucide-react";

import { useSaTheme } from "./saTheme";
import type { TenantCompanySummary } from "../../types/backend";

interface QuickAccessProps {
  tenants: TenantCompanySummary[];
  onOpenTenant?: (tenant: TenantCompanySummary) => void;
  onNavigateTenants: () => void;
}

export default function OverviewQuickAccess({
  tenants,
  onOpenTenant,
  onNavigateTenants,
}: QuickAccessProps) {
  const SA = useSaTheme();

  // Find flagship tenant if present
  const flagship =
    tenants.find((t) => t.name.toLowerCase().includes("ijaz")) || tenants[0];

  return (
    <Stack gap="xl">
      {/* ==================== QUICK ACCESS ==================== */}
      <div>
        <Group justify="space-between" mb="md">
          <Text fw={800} size="md" style={{ color: SA.text, letterSpacing: -0.3 }}>
            Quick Access
          </Text>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          {/* Featured Emerald Card */}
          <motion.div
            whileHover={{ y: -4, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            onClick={() => flagship && onOpenTenant && onOpenTenant(flagship)}
            style={{
              borderRadius: 20,
              padding: "22px 24px",
              background: SA.accent,
              color: "#FFFFFF",
              cursor: "pointer",
              boxShadow: "0 10px 28px -6px rgba(43, 182, 115, 0.45)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: 140,
            }}
          >
            <Group justify="space-between" align="flex-start">
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "rgba(255, 255, 255, 0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backdropFilter: "blur(4px)",
                }}
              >
                <Folder size={20} color="#FFFFFF" />
              </div>

              {/* Avatar Stack with +5 */}
              <Avatar.Group spacing="sm">
                <Avatar
                  radius="xl"
                  size={30}
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=60&auto=format&fit=crop&q=80"
                  style={{ border: "2px solid #FFFFFF" }}
                />
                <Avatar
                  radius="xl"
                  size={30}
                  src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=60&auto=format&fit=crop&q=80"
                  style={{ border: "2px solid #FFFFFF" }}
                />
                <Avatar
                  radius="xl"
                  size={30}
                  styles={{
                    root: {
                      background: "rgba(255, 255, 255, 0.3)",
                      color: "#FFFFFF",
                      fontSize: 10,
                      fontWeight: 800,
                      border: "2px solid #FFFFFF",
                    },
                  }}
                >
                  +5
                </Avatar>
              </Avatar.Group>
            </Group>

            <Stack gap={2} mt="md">
              <Text fw={800} size="md" style={{ color: "#FFFFFF", letterSpacing: -0.2 }} truncate>
                {flagship ? flagship.name : "Flagship Workspace"}
              </Text>
              <Text size="xs" style={{ color: "rgba(255, 255, 255, 0.85)", fontWeight: 500 }}>
                {flagship?.userCount ?? 8} active users · {flagship?.packageName ?? "Premium Tier"}
              </Text>
            </Stack>
          </motion.div>

          {/* White Card 2: FBR PRAL Gateway */}
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            style={{
              borderRadius: 20,
              padding: "22px 24px",
              background: SA.panel,
              border: `1px solid ${SA.border}`,
              boxShadow: SA.shadow,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: 140,
            }}
          >
            <Group justify="space-between" align="flex-start">
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "rgba(239, 68, 68, 0.12)",
                  color: "#EF4444",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FileText size={20} />
              </div>

              {/* Avatar Stack with +8 */}
              <Avatar.Group spacing="sm">
                <Avatar
                  radius="xl"
                  size={30}
                  src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=60&auto=format&fit=crop&q=80"
                  style={{ border: `2px solid ${SA.panel}` }}
                />
                <Avatar
                  radius="xl"
                  size={30}
                  src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=60&auto=format&fit=crop&q=80"
                  style={{ border: `2px solid ${SA.panel}` }}
                />
                <Avatar
                  radius="xl"
                  size={30}
                  styles={{
                    root: {
                      background: "rgba(239, 68, 68, 0.15)",
                      color: "#EF4444",
                      fontSize: 10,
                      fontWeight: 800,
                      border: `2px solid ${SA.panel}`,
                    },
                  }}
                >
                  +8
                </Avatar>
              </Avatar.Group>
            </Group>

            <Stack gap={2} mt="md">
              <Text fw={800} size="md" style={{ color: SA.text, letterSpacing: -0.2 }} truncate>
                FBR Fiscal Invoicing
              </Text>
              <Text size="xs" style={{ color: SA.muted, fontWeight: 500 }}>
                PRAL Integration · 100% Tax Compliant
              </Text>
            </Stack>
          </motion.div>

          {/* White Card 3: SQLite 3 WAL Engine */}
          <motion.div
            whileHover={{ y: -4 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            style={{
              borderRadius: 20,
              padding: "22px 24px",
              background: SA.panel,
              border: `1px solid ${SA.border}`,
              boxShadow: SA.shadow,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: 140,
            }}
          >
            <Group justify="space-between" align="flex-start">
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: "rgba(59, 130, 246, 0.12)",
                  color: "#3B82F6",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Database size={20} />
              </div>

              <Avatar
                radius="xl"
                size={30}
                src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=60&auto=format&fit=crop&q=80"
                style={{ border: `2px solid ${SA.panel}` }}
              />
            </Group>

            <Stack gap={2} mt="md">
              <Text fw={800} size="md" style={{ color: SA.text, letterSpacing: -0.2 }} truncate>
                SQLite 3 Storage Engine
              </Text>
              <Text size="xs" style={{ color: SA.muted, fontWeight: 500 }}>
                WAL Persistence · 42.4 MB Local Core
              </Text>
            </Stack>
          </motion.div>
        </SimpleGrid>
      </div>

      {/* ==================== FOLDERS / SECTORS ==================== */}
      <div>
        <Group justify="space-between" align="center" mb="md">
          <Text fw={800} size="md" style={{ color: SA.text, letterSpacing: -0.3 }}>
            Tenant Sectors & Folders
          </Text>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={onNavigateTenants}
            style={{ color: SA.accent }}
          >
            <ArrowRight size={17} />
          </ActionIcon>
        </Group>

        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
          {[
            {
              title: "Wholesale & Traders",
              count: "453 files",
              size: "11 GB",
            },
            {
              title: "Retail & POS Counters",
              count: "84 files",
              size: "3.6 GB",
            },
            {
              title: "Pharma & FIFO Batches",
              count: "287 files",
              size: "8.9 GB",
            },
            {
              title: "Industrial & Manufacturing",
              count: "56 files",
              size: "6.0 GB",
            },
          ].map((folder, idx) => (
            <motion.div
              key={idx}
              whileHover={{ y: -3 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              onClick={onNavigateTenants}
              style={{
                borderRadius: 18,
                padding: "16px 18px",
                background: SA.panel,
                border: `1px solid ${SA.border}`,
                boxShadow: SA.shadow,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <Group justify="space-between" align="flex-start">
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: "rgba(43, 182, 115, 0.12)",
                    color: SA.accent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Folder size={18} />
                </div>
                <ActionIcon variant="subtle" size="xs" style={{ color: SA.muted }}>
                  <MoreVertical size={14} />
                </ActionIcon>
              </Group>

              <div>
                <Text fw={700} size="xs" style={{ color: SA.text }} lineClamp={1}>
                  {folder.title}
                </Text>
                <Group justify="space-between" mt={4}>
                  <Text size="11px" style={{ color: SA.muted }}>
                    {folder.count}
                  </Text>
                  <Text size="11px" fw={700} style={{ color: SA.text }}>
                    {folder.size}
                  </Text>
                </Group>
              </div>
            </motion.div>
          ))}
        </SimpleGrid>
      </div>
    </Stack>
  );
}
