// ==========================================
// OVERVIEW QUICK ACCESS & SECTOR FOLDERS
// ==========================================
// Pixel-accurate recreation of Aryo Pamungkas (SLAB Design Studio):
// 1. Quick Access Row: 3 rounded horizontal cards with avatar stacks
// 2. Folders Grid: 4 cards with green folder icons, bold title, file counts & sizes

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

  // Highlight father's flagship tenant if present
  const flagship =
    tenants.find((t) => t.name.toLowerCase().includes("ijaz")) || tenants[0];

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
          {/* Card 1: Featured Emerald Green Card */}
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
                <Folder size={18} color="#FFFFFF" />
              </div>

              {/* Overlapping Avatar Stack with +5 */}
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
                  +5
                </Avatar>
              </Avatar.Group>
            </Group>

            <Stack gap={2} mt="md">
              <Text fw={700} size="sm" style={{ color: "#FFFFFF", letterSpacing: -0.2 }} truncate>
                {flagship ? flagship.name : "Ijaz & Company"}
              </Text>
              <Text size="xs" style={{ color: "rgba(255, 255, 255, 0.8)", fontWeight: 500 }}>
                {flagship?.userCount ?? 8} files · Premium
              </Text>
            </Stack>
          </motion.div>

          {/* Card 2: White Card with Red PDF Icon */}
          <motion.div
            whileHover={{ y: -3 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
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
                <FileText size={18} />
              </div>

              {/* Avatar Stack with +8 */}
              <Avatar.Group spacing="xs">
                <Avatar
                  radius="xl"
                  size={26}
                  src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=60&auto=format&fit=crop&q=80"
                  style={{ border: `2px solid ${SA.panel}` }}
                />
                <Avatar
                  radius="xl"
                  size={26}
                  src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=60&auto=format&fit=crop&q=80"
                  style={{ border: `2px solid ${SA.panel}` }}
                />
                <Avatar
                  radius="xl"
                  size={26}
                  styles={{
                    root: {
                      background: "rgba(239, 68, 68, 0.15)",
                      color: "#EF4444",
                      fontSize: 9,
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
              <Text fw={700} size="sm" style={{ color: SA.text, letterSpacing: -0.2 }} truncate>
                FBR Fiscal Invoicing.pdf
              </Text>
              <Text size="xs" style={{ color: SA.muted, fontWeight: 500 }}>
                12 MB · PRAL Gateway
              </Text>
            </Stack>
          </motion.div>

          {/* Card 3: White Card with Blue Media Icon */}
          <motion.div
            whileHover={{ y: -3 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
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
                <Database size={18} />
              </div>

              <Avatar
                radius="xl"
                size={26}
                src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=60&auto=format&fit=crop&q=80"
                style={{ border: `2px solid ${SA.panel}` }}
              />
            </Group>

            <Stack gap={2} mt="md">
              <Text fw={700} size="sm" style={{ color: SA.text, letterSpacing: -0.2 }} truncate>
                SQLite Storage Backup.mp4
              </Text>
              <Text size="xs" style={{ color: SA.muted, fontWeight: 500 }}>
                237 MB · Local Core
              </Text>
            </Stack>
          </motion.div>
        </SimpleGrid>
      </div>

      {/* ==================== 2. FOLDERS GRID ==================== */}
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
            Folders
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
              title: "Projects",
              count: "453 files",
              size: "11 GB",
            },
            {
              title: "Marketing",
              count: "84 files",
              size: "3.6 GB",
            },
            {
              title: "Personal",
              count: "287 files",
              size: "8.9 GB",
            },
            {
              title: "Portofolio",
              count: "56 files",
              size: "6 GB",
            },
          ].map((folder, idx) => (
            <motion.div
              key={idx}
              whileHover={{ y: -3, boxShadow: "0 6px 18px rgba(0,0,0,0.04)" }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              onClick={onNavigateTenants}
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
                <Folder size={22} style={{ color: "#2BB673", fill: "rgba(43, 182, 115, 0.15)" }} />
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
          ))}
        </SimpleGrid>
      </div>
    </Stack>
  );
}
