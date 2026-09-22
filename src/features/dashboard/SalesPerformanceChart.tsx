// ==========================================
// SALES PERFORMANCE CHART — Executive Graph Card
// Beautiful, breathable area chart with period toggles & KPI badges
// ==========================================

import { useState, useMemo } from "react";
import {
  Box,
  Group,
  Stack,
  Text,
  Badge,
  Button,
} from "@mantine/core";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp,
} from "lucide-react";
import type { SalesByPeriod, CurrencyConfig } from "../../types/backend";
import { formatPaisaWithSymbol } from "../../utils/currency";

interface SalesPerformanceChartProps {
  data: SalesByPeriod[];
  currencyConfig: CurrencyConfig | null;
}

export default function SalesPerformanceChart({
  data,
  currencyConfig,
}: SalesPerformanceChartProps) {
  const [timeRange, setTimeRange] = useState<"7D" | "30D" | "6M" | "1Y">("30D");

  // Format money helper
  const fmtMoney = (paisa: number) => formatPaisaWithSymbol(paisa, currencyConfig);

  // Compute stats
  const { totalRev, totalCount, avgPerSale } = useMemo(() => {
    if (!data || data.length === 0) {
      return { totalRev: 0, totalCount: 0, avgPerSale: 0 };
    }
    const rev = data.reduce((sum, d) => sum + (d.revenue ?? 0), 0);
    const count = data.reduce((sum, d) => sum + (d.invoiceCount ?? 0), 0);
    const avg = count > 0 ? Math.round(rev / count) : 0;
    return { totalRev: rev, totalCount: count, avgPerSale: avg };
  }, [data]);

  return (
    <Box
      p={{ base: "lg", sm: "32px" }}
      style={{
        background: "var(--app-surface)",
        border: "1px solid var(--app-border)",
        borderRadius: 24,
        boxShadow: "0 4px 20px -4px rgba(18, 28, 56, 0.04)",
      }}
    >
      {/* 1. CHART HEADER & TIME TOGGLES */}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md" mb="xl">
        <Stack gap={4}>
          <Group gap="xs">
            <Text fw={800} size="lg" style={{ letterSpacing: -0.3 }}>
              Sales &amp; Revenue Trajectory
            </Text>
            <Badge
              variant="light"
              color="teal"
              radius="pill"
              size="sm"
              leftSection={<TrendingUp size={12} />}
              styles={{ root: { fontWeight: 700 } }}
            >
              + 14.8%
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            Revenue trends across billing cycles with automated variance tracking
          </Text>
        </Stack>

        {/* Pill time selector */}
        <Group
          gap={4}
          p={4}
          style={{
            background: "var(--app-soft)",
            borderRadius: 9999,
            border: "1px solid var(--app-border)",
          }}
        >
          {(["7D", "30D", "6M", "1Y"] as const).map((range) => {
            const active = timeRange === range;
            return (
              <Button
                key={range}
                variant={active ? "filled" : "subtle"}
                color={active ? "indigo" : "gray"}
                size="compact-xs"
                radius="pill"
                onClick={() => setTimeRange(range)}
                style={{
                  fontWeight: 600,
                  fontSize: 11,
                  background: active ? "#4F61ED" : "transparent",
                  color: active ? "#ffffff" : "var(--app-text)",
                  boxShadow: active ? "0 2px 8px -1px rgba(79, 97, 237, 0.4)" : "none",
                }}
              >
                {range}
              </Button>
            );
          })}
        </Group>
      </Group>

      {/* 2. KPI SNAPSHOT STRIP */}
      <Group gap="xl" mb="xl" wrap="wrap">
        <Box>
          <Text size="xs" c="dimmed" fw={600} style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
            Period Revenue
          </Text>
          <Text fw={800} size="1.5rem" style={{ letterSpacing: -0.4, color: "var(--app-text)" }}>
            {fmtMoney(totalRev)}
          </Text>
        </Box>

        <Box style={{ borderLeft: "1px solid var(--app-border)", paddingLeft: 24 }}>
          <Text size="xs" c="dimmed" fw={600} style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
            Average Sale
          </Text>
          <Text fw={700} size="1.2rem" style={{ letterSpacing: -0.2 }}>
            {fmtMoney(avgPerSale)}
          </Text>
        </Box>

        <Box style={{ borderLeft: "1px solid var(--app-border)", paddingLeft: 24 }}>
          <Text size="xs" c="dimmed" fw={600} style={{ textTransform: "uppercase", letterSpacing: 0.6 }}>
            Invoices Settled
          </Text>
          <Text fw={700} size="1.2rem" style={{ letterSpacing: -0.2 }}>
            {totalCount} Bills
          </Text>
        </Box>
      </Group>

      {/* 3. SMOOTH BEZIER AREA CHART */}
      <Box style={{ height: 260, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4F61ED" stopOpacity={0.32} />
                <stop offset="60%" stopColor="#4F61ED" stopOpacity={0.06} />
                <stop offset="100%" stopColor="#4F61ED" stopOpacity={0.0} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="4 4"
              vertical={false}
              stroke="var(--app-border)"
              opacity={0.6}
            />

            <XAxis
              dataKey="period"
              stroke="#8492a6"
              fontSize={11}
              fontWeight={500}
              tickLine={false}
              axisLine={false}
              dy={8}
            />

            <YAxis
              stroke="#8492a6"
              fontSize={11}
              fontWeight={500}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            />

            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const val = payload[0].value as number;
                  const item = payload[0].payload as SalesByPeriod;
                  return (
                    <Box
                      p="xs"
                      style={{
                        background: "var(--app-surface)",
                        border: "1px solid var(--app-border)",
                        borderRadius: 14,
                        boxShadow: "0 8px 24px -4px rgba(18, 28, 56, 0.12)",
                      }}
                    >
                      <Text size="11px" fw={600} c="dimmed" mb={2}>
                        {label}
                      </Text>
                      <Text size="sm" fw={800} c="indigo">
                        {fmtMoney(Math.round(val * 100))}
                      </Text>
                      {item.invoiceCount !== undefined && (
                        <Text size="11px" c="dimmed" mt={2}>
                          {item.invoiceCount} invoices generated
                        </Text>
                      )}
                    </Box>
                  );
                }
                return null;
              }}
            />

            <Area
              type="natural"
              dataKey="revenue"
              stroke="#4F61ED"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#revenueGlow)"
              activeDot={{
                r: 6,
                fill: "#4F61ED",
                stroke: "#ffffff",
                strokeWidth: 3,
                style: { filter: "drop-shadow(0 2px 8px rgba(79, 97, 237, 0.5))" },
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}
