import { useState, useMemo } from "react";
import {
  Box,
  Stack,
  Group,
  Text,
  Avatar,
  Button,
  ActionIcon,
  Tooltip,
  Badge,
} from "@mantine/core";
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  ReceiptText,
  UserCheck,
  ArrowUpRight,
} from "lucide-react";
import type { PublicUser } from "../../types/backend";

interface RightContextPanelProps {
  user: PublicUser;
  onNavigate: (module: string) => void;
  lowStockCount?: number;
  unpaidInvoiceCount?: number;
  onTriggerBackup?: () => void;
}

export default function RightContextPanel({
  user,
  onNavigate,
  lowStockCount = 0,
  unpaidInvoiceCount = 0,
  onTriggerBackup,
}: RightContextPanelProps) {
  // Calendar navigation state
  const [currentDate, setCurrentDate] = useState(() => new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthName = currentDate.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  // Compute days in month and padding
  const { daysInMonth, startOffset, todayDate } = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    // Sunday is 0, convert so Mon is 0, Sun is 6
    const dayOfWeek = (firstDay.getDay() + 6) % 7;
    const lastDate = new Date(year, month + 1, 0).getDate();
    const now = new Date();
    const isThisMonth =
      now.getFullYear() === year && now.getMonth() === month;

    return {
      daysInMonth: lastDate,
      startOffset: dayOfWeek,
      todayDate: isThisMonth ? now.getDate() : -1,
    };
  }, [year, month]);

  const weekdays = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <Box
      component="aside"
      style={{
        width: 300,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: "24px 20px",
        background: "var(--app-surface)",
        borderLeft: "1px solid var(--app-border)",
        overflowY: "auto",
      }}
    >
      {/* 1. USER PROFILE CARD */}
      <Box
        p="lg"
        style={{
          background: "var(--app-soft)",
          borderRadius: 22,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 12,
        }}
      >
        <Avatar
          size={72}
          radius="xl"
          color="indigo"
          style={{
            boxShadow: "0 8px 20px -4px rgba(79, 97, 237, 0.25)",
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          {user.fullName.charAt(0).toUpperCase()}
        </Avatar>

        <Stack gap={2} align="center">
          <Text fw={700} size="md" style={{ letterSpacing: -0.2 }}>
            {user.fullName}
          </Text>
          <Badge
            variant="light"
            color="indigo"
            radius="pill"
            size="sm"
            styles={{ label: { textTransform: "capitalize", fontWeight: 600 } }}
          >
            {user.role.replace("_", " ")}
          </Badge>
        </Stack>

        <Button
          variant="default"
          size="xs"
          radius="pill"
          fullWidth
          rightSection={<ArrowUpRight size={14} />}
          onClick={() => onNavigate("settings")}
          style={{
            background: "var(--app-surface)",
            border: "1px solid var(--app-border)",
            fontWeight: 600,
            marginTop: 4,
          }}
        >
          Manage Profile
        </Button>
      </Box>

      {/* 2. CALENDAR WIDGET */}
      <Box
        p="md"
        style={{
          background: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          borderRadius: 20,
        }}
      >
        <Group justify="space-between" mb="xs">
          <Tooltip label="Previous month">
            <ActionIcon variant="subtle" color="gray" size="sm" radius="md" onClick={prevMonth}>
              <ChevronLeft size={16} />
            </ActionIcon>
          </Tooltip>
          <Text fw={700} size="xs" style={{ letterSpacing: 0.2 }}>
            {monthName}
          </Text>
          <Tooltip label="Next month">
            <ActionIcon variant="subtle" color="gray" size="sm" radius="md" onClick={nextMonth}>
              <ChevronRight size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {/* Weekday headers */}
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            textAlign: "center",
            marginBottom: 6,
          }}
        >
          {weekdays.map((wd, i) => (
            <Text key={i} size="11px" fw={600} c="dimmed">
              {wd}
            </Text>
          ))}
        </Box>

        {/* Day numbers grid */}
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            rowGap: 4,
            columnGap: 2,
            textAlign: "center",
          }}
        >
          {Array.from({ length: startOffset }).map((_, i) => (
            <Box key={`offset-${i}`} style={{ height: 28 }} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const isToday = day === todayDate;
            return (
              <Box
                key={`day-${day}`}
                style={{
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 9999,
                  fontSize: 12,
                  fontWeight: isToday ? 700 : 500,
                  background: isToday ? "#4F61ED" : "transparent",
                  color: isToday ? "#FFFFFF" : "var(--app-text)",
                  cursor: "default",
                }}
              >
                {day}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* 3. BUSINESS ALERTS & DAILY TASKS */}
      <Stack gap="xs">
        <Group justify="space-between" px={4}>
          <Text fw={700} size="xs" style={{ letterSpacing: 0.3, textTransform: "uppercase" }} c="dimmed">
            Action Items
          </Text>
          <Text
            size="xs"
            fw={600}
            c="indigo"
            style={{ cursor: "pointer" }}
            onClick={() => onNavigate("reports")}
          >
            Overview
          </Text>
        </Group>

        {/* Low Stock Alert */}
        {lowStockCount > 0 ? (
          <Box
            p="sm"
            onClick={() => onNavigate("inventory")}
            style={{
              background: "rgba(221, 107, 32, 0.08)",
              border: "1px solid rgba(221, 107, 32, 0.2)",
              borderRadius: 16,
              cursor: "pointer",
              transition: "transform 0.15s ease",
            }}
          >
            <Group gap="xs" wrap="nowrap">
              <Box
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "rgba(221, 107, 32, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#DD6B20",
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={16} />
              </Box>
              <Stack gap={0} style={{ overflow: "hidden" }}>
                <Text size="xs" fw={700} c="orange">
                  Low Stock Alert
                </Text>
                <Text size="11px" c="dimmed" truncate>
                  {lowStockCount} item{lowStockCount > 1 ? "s" : ""} below minimum
                </Text>
              </Stack>
            </Group>
          </Box>
        ) : (
          <Box
            p="sm"
            style={{
              background: "var(--app-soft)",
              border: "1px solid var(--app-border)",
              borderRadius: 16,
            }}
          >
            <Group gap="xs" wrap="nowrap">
              <Box
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "rgba(56, 161, 105, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#38A169",
                  flexShrink: 0,
                }}
              >
                <UserCheck size={16} />
              </Box>
              <Stack gap={0}>
                <Text size="xs" fw={700}>
                  Stock Healthy
                </Text>
                <Text size="11px" c="dimmed">
                  All items are well supplied
                </Text>
              </Stack>
            </Group>
          </Box>
        )}

        {/* Unpaid Invoices */}
        {unpaidInvoiceCount > 0 && (
          <Box
            p="sm"
            onClick={() => onNavigate("invoices")}
            style={{
              background: "rgba(79, 97, 237, 0.08)",
              border: "1px solid rgba(79, 97, 237, 0.2)",
              borderRadius: 16,
              cursor: "pointer",
            }}
          >
            <Group gap="xs" wrap="nowrap">
              <Box
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "rgba(79, 97, 237, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#4F61ED",
                  flexShrink: 0,
                }}
              >
                <ReceiptText size={16} />
              </Box>
              <Stack gap={0} style={{ overflow: "hidden" }}>
                <Text size="xs" fw={700} c="indigo">
                  Pending Payments
                </Text>
                <Text size="11px" c="dimmed" truncate>
                  {unpaidInvoiceCount} invoice{unpaidInvoiceCount > 1 ? "s" : ""} pending collection
                </Text>
              </Stack>
            </Group>
          </Box>
        )}

        {/* Backup Status */}
        <Box
          p="sm"
          onClick={onTriggerBackup}
          style={{
            background: "var(--app-soft)",
            border: "1px solid var(--app-border)",
            borderRadius: 16,
            cursor: onTriggerBackup ? "pointer" : "default",
          }}
        >
          <Group gap="xs" wrap="nowrap">
            <Box
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: "rgba(79, 97, 237, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#4F61ED",
                flexShrink: 0,
              }}
            >
              <ShieldCheck size={16} />
            </Box>
            <Stack gap={0} style={{ overflow: "hidden" }}>
              <Text size="xs" fw={700}>
                Data Protected
              </Text>
              <Text size="11px" c="dimmed">
                Tap to save a fresh copy
              </Text>
            </Stack>
          </Group>
        </Box>
      </Stack>
    </Box>
  );
}
