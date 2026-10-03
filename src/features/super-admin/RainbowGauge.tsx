// ==========================================
// RAINBOW GAUGE & STORAGE INSPECTOR
// ==========================================
// Inspired by Aryo Pamungkas (SLAB Design Studio) File Manager Dashboard.
// Features a 4-color semi-circular gauge, resource breakdown pills,
// and sovereign security status card.

import { motion } from "framer-motion";
import {
  Avatar,
  Button,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import {
  Bell,
  Database,
  FileCode2,
  FileText,
  Image as ImageIcon,
  ShieldCheck,
} from "lucide-react";

import { useSaTheme } from "./saTheme";
import type { PublicUser } from "../../types/backend";

interface RainbowGaugeProps {
  user?: PublicUser;
  usedGb?: number;
  totalGb?: number;
  onRunDiagnostics?: () => void;
}

export default function RainbowGauge({
  user,
  usedGb = 42.4,
  totalGb = 100,
  onRunDiagnostics,
}: RainbowGaugeProps) {
  const SA = useSaTheme();

  return (
    <Stack
      gap="lg"
      style={{
        width: 320,
        flexShrink: 0,
        background: SA.bgSidebar,
        borderInlineStart: `1px solid ${SA.border}`,
        padding: "24px 22px",
        overflowY: "auto",
        height: "100%",
      }}
    >
      {/* User Greeting & Notification Header */}
      <Group justify="space-between" align="center">
        <div style={{ position: "relative" }}>
          <div
            style={{
              width: 38,
              height: 38,
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
            <Bell size={17} />
          </div>
          <span
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#EF4444",
              border: `2px solid ${SA.bgSidebar}`,
            }}
          />
        </div>

        <Group gap="xs">
          <Stack gap={0} align="flex-end">
            <Text fw={700} size="sm" style={{ color: SA.text, letterSpacing: -0.2 }}>
              Hi, {user?.fullName?.split(" ")[0] || "Taha"}
            </Text>
            <Text size="11px" fw={600} style={{ color: SA.accent }}>
              Super Admin
            </Text>
          </Stack>
          <div style={{ position: "relative" }}>
            <Avatar
              radius="xl"
              size={40}
              styles={{
                root: {
                  background: SA.gradient,
                  color: "#FFFFFF",
                  fontWeight: 800,
                  fontSize: 14,
                  boxShadow: "0 4px 12px rgba(43, 182, 115, 0.3)",
                },
              }}
            >
              {user?.fullName?.slice(0, 1).toUpperCase() || "T"}
            </Avatar>
            <span
              style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#10B981",
                border: `2px solid ${SA.bgSidebar}`,
              }}
            />
          </div>
        </Group>
      </Group>

      {/* Semi-Circular Rainbow Arc Gauge */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: 12,
          paddingBottom: 6,
        }}
      >
        <div style={{ position: "relative", width: 220, height: 130 }}>
          <svg
            width="220"
            height="130"
            viewBox="0 0 240 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Background subtle track */}
            <path
              d="M 35 115 A 85 85 0 0 1 205 115"
              stroke={SA.border}
              strokeWidth="14"
              strokeLinecap="round"
              fill="none"
              opacity={0.5}
            />

            {/* Segment 1: Red / Critical */}
            <path
              d="M 35 115 A 85 85 0 0 1 60 55"
              stroke="#EF4444"
              strokeWidth="14"
              strokeLinecap="round"
              fill="none"
            />

            {/* Segment 2: Orange / Warning */}
            <path
              d="M 60 55 A 85 85 0 0 1 120 30"
              stroke="#F59E0B"
              strokeWidth="14"
              fill="none"
            />

            {/* Segment 3: Mint / Active Emerald */}
            <path
              d="M 120 30 A 85 85 0 0 1 189 66"
              stroke="#10B981"
              strokeWidth="14"
              fill="none"
            />

            {/* Segment 4: Sky Blue */}
            <path
              d="M 189 66 A 85 85 0 0 1 205 115"
              stroke="#3B82F6"
              strokeWidth="14"
              strokeLinecap="round"
              fill="none"
            />
          </svg>

          {/* Large Center Metric */}
          <div
            style={{
              position: "absolute",
              bottom: 4,
              left: 0,
              right: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              <Text
                fw={800}
                style={{
                  fontSize: 26,
                  color: SA.text,
                  letterSpacing: -0.8,
                  lineHeight: 1.1,
                }}
              >
                {usedGb} GB
              </Text>
            </motion.div>
            <Text size="11px" fw={600} style={{ color: SA.muted, marginTop: 2 }}>
              of {totalGb} GB capacity
            </Text>
          </div>
        </div>
      </div>

      {/* Resource Breakdown List */}
      <Stack gap={10} mt={4}>
        {/* Videos / Invoices */}
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(239, 68, 68, 0.12)",
                color: "#EF4444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FileText size={17} />
            </div>
            <Stack gap={1}>
              <Text fw={700} size="xs" style={{ color: SA.text }}>
                Invoices & Receipts
              </Text>
              <Text size="11px" style={{ color: SA.muted }}>
                302 files
              </Text>
            </Stack>
          </Group>
          <Text fw={700} size="xs" style={{ color: SA.text }}>
            16.2 GB
          </Text>
        </Group>

        {/* Photos / Catalogs */}
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(16, 185, 129, 0.12)",
                color: "#10B981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ImageIcon size={17} />
            </div>
            <Stack gap={1}>
              <Text fw={700} size="xs" style={{ color: SA.text }}>
                Product Catalogs
              </Text>
              <Text size="11px" style={{ color: SA.muted }}>
                1,872 files
              </Text>
            </Stack>
          </Group>
          <Text fw={700} size="xs" style={{ color: SA.text }}>
            12.1 GB
          </Text>
        </Group>

        {/* Documents / Audit */}
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(245, 158, 11, 0.12)",
                color: "#F59E0B",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FileCode2 size={17} />
            </div>
            <Stack gap={1}>
              <Text fw={700} size="xs" style={{ color: SA.text }}>
                Audit Logs & PECA
              </Text>
              <Text size="11px" style={{ color: SA.muted }}>
                576 files
              </Text>
            </Stack>
          </Group>
          <Text fw={700} size="xs" style={{ color: SA.text }}>
            9.0 GB
          </Text>
        </Group>

        {/* Other / SQLite WAL */}
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(59, 130, 246, 0.12)",
                color: "#3B82F6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Database size={17} />
            </div>
            <Stack gap={1}>
              <Text fw={700} size="xs" style={{ color: SA.text }}>
                SQLite WAL & Cache
              </Text>
              <Text size="11px" style={{ color: SA.muted }}>
                249 files
              </Text>
            </Stack>
          </Group>
          <Text fw={700} size="xs" style={{ color: SA.text }}>
            5.1 GB
          </Text>
        </Group>
      </Stack>

      {/* Sovereign Security Shield Card (Upgrade to PRO style from SLAB design) */}
      <div
        style={{
          marginTop: "auto",
          borderRadius: 18,
          background: SA.panelMint,
          border: `1px solid ${SA.border}`,
          padding: "20px 18px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Soft floating glow */}
        <div
          style={{
            position: "absolute",
            top: -20,
            right: -20,
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: "rgba(43, 182, 115, 0.15)",
            filter: "blur(20px)",
          }}
        />

        {/* Shield graphic icon */}
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            background: SA.bgSidebar,
            boxShadow: "0 8px 20px -4px rgba(43, 182, 115, 0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: SA.accent,
            marginBottom: 12,
          }}
        >
          <ShieldCheck size={28} />
        </div>

        <Text fw={800} size="sm" style={{ color: SA.text, letterSpacing: -0.2 }}>
          Sovereign Security Shield
        </Text>
        <Text size="11px" style={{ color: SA.muted, marginTop: 4, lineHeight: 1.4 }}>
          Zero-knowledge isolation verified. Local SQLite WAL encrypted.
        </Text>

        <Button
          fullWidth
          size="xs"
          radius="xl"
          mt="md"
          onClick={onRunDiagnostics}
          styles={{
            root: {
              background: SA.gradient,
              color: "#FFFFFF",
              fontWeight: 700,
              boxShadow: "0 6px 18px -4px rgba(43, 182, 115, 0.45)",
              "&:hover": { filter: "brightness(1.08)" },
            },
          }}
        >
          Run Diagnostics
        </Button>
      </div>
    </Stack>
  );
}
