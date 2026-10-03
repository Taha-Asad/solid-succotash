// ==========================================
// RAINBOW GAUGE & STORAGE INSPECTOR
// ==========================================
// Exact recreation of Aryo Pamungkas (SLAB Design Studio) Right Panel:
// 1. Header: Notification bell + Hi, Adam (or user name) with avatar
// 2. 4-Segment Semi-Circular Rainbow Arc Gauge: 42.4 GB of 50 GB capacity
// 3. Breakdown rows: Videos (Red), Photos (Green), Documents (Yellow), Other Files (Blue)
// 4. Promo Card: Upgrade to PRO with illustration and Upgrade Now button

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
  FileText,
  Image as ImageIcon,
  ShieldCheck,
  Video,
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
  totalGb = 50,
  onRunDiagnostics,
}: RainbowGaugeProps) {
  const SA = useSaTheme();

  return (
    <Stack
      gap="lg"
      style={{
        width: 290,
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
              {/* Segment 1: Red */}
              <path
                d="M 35 115 A 85 85 0 0 1 60 55"
                stroke="#EF4444"
                strokeWidth="14"
                strokeLinecap="round"
                fill="none"
              />

              {/* Segment 2: Orange */}
              <path
                d="M 60 55 A 85 85 0 0 1 120 30"
                stroke="#F59E0B"
                strokeWidth="14"
                fill="none"
              />

              {/* Segment 3: Green */}
              <path
                d="M 120 30 A 85 85 0 0 1 189 66"
                stroke="#10B981"
                strokeWidth="14"
                fill="none"
              />

              {/* Segment 4: Blue */}
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
                {usedGb} GB
              </Text>
              <Text size="11px" fw={500} style={{ color: SA.muted, marginTop: 2 }}>
                of {totalGb} GB capacity
              </Text>
            </div>
          </div>
        </div>

        {/* Resource Breakdown List (SLAB Design) */}
        <Stack gap={10} mt="lg">
          {/* Videos (Red) */}
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
                <Video size={16} />
              </div>
              <Stack gap={0}>
                <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 13 }}>
                  Videos
                </Text>
                <Text size="11px" style={{ color: SA.muted }}>
                  302 files
                </Text>
              </Stack>
            </Group>
            <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 12 }}>
              16.2 GB
            </Text>
          </Group>

          {/* Photos (Green) */}
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
                <ImageIcon size={16} />
              </div>
              <Stack gap={0}>
                <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 13 }}>
                  Photos
                </Text>
                <Text size="11px" style={{ color: SA.muted }}>
                  1872 files
                </Text>
              </Stack>
            </Group>
            <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 12 }}>
              12.1 GB
            </Text>
          </Group>

          {/* Documents (Yellow) */}
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
                <FileText size={16} />
              </div>
              <Stack gap={0}>
                <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 13 }}>
                  Documents
                </Text>
                <Text size="11px" style={{ color: SA.muted }}>
                  576 files
                </Text>
              </Stack>
            </Group>
            <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 12 }}>
              9 GB
            </Text>
          </Group>

          {/* Other Files (Blue) */}
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
                <Database size={16} />
              </div>
              <Stack gap={0}>
                <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 13 }}>
                  Other Files
                </Text>
                <Text size="11px" style={{ color: SA.muted }}>
                  249 files
                </Text>
              </Stack>
            </Group>
            <Text fw={700} size="xs" style={{ color: SA.text, fontSize: 12 }}>
              5.1 GB
            </Text>
          </Group>
        </Stack>
      </div>

      {/* Upgrade to PRO Card (SLAB Design) */}
      <div
        style={{
          borderRadius: 18,
          background: "#F0FAF5",
          border: "1px solid #DDF2E8",
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
            background: "#FFFFFF",
            boxShadow: "0 4px 14px rgba(43, 182, 115, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#2BB673",
            marginBottom: 10,
          }}
        >
          <ShieldCheck size={24} />
        </div>

        <Text fw={800} size="xs" style={{ color: "#162D24", fontSize: 14 }}>
          Upgrade to PRO
        </Text>
        <Text size="11px" style={{ color: "#64748B", marginTop: 4, lineHeight: 1.4 }}>
          Get more space for your storage and access to all features
        </Text>

        <Button
          fullWidth
          size="xs"
          radius="xl"
          mt="sm"
          onClick={onRunDiagnostics}
          styles={{
            root: {
              background: "#2BB673",
              color: "#FFFFFF",
              fontWeight: 700,
              fontSize: 12,
              height: 34,
              boxShadow: "0 4px 12px rgba(43, 182, 115, 0.35)",
              "&:hover": { background: "#249e63" },
            },
          }}
        >
          Upgrade Now
        </Button>
      </div>
    </Stack>
  );
}
