// ==========================================
// PLATFORM ANALYTICS — KPIs & growth charts
// ==========================================
// Cross-tenant platform metrics: MRR, tenant counts, subscription
// status mix, tenants-per-package, and monthly tenant growth.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import { Box, Group, Loader, SimpleGrid, Stack, Text } from "@mantine/core";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Building2, IndianRupee, TrendingUp, Users } from "lucide-react";

import {
  getErrorMessage,
  getPlatformAnalytics,
} from "../../api/backend";
import type { PlatformAnalytics } from "../../types/backend";
import { useI18n } from "../../i18n/I18nProvider";
import { useSaTheme } from "./saTheme.tsx";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 220, damping: 24 },
  },
};

const STATUS_COLORS: Record<string, string> = {
  active: "#34D399",
  trial: "#38BDF8",
  past_due: "#FBBF24",
  suspended: "#F87171",
  cancelled: "#94A3B8",
  ended: "#94A3B8",
};

const PKG_COLORS = ["#38BDF8", "#818CF8", "#22D3EE", "#34D399", "#FBBF24", "#F87171"];

function KpiCard({
  label,
  value,
  suffix,
  icon,
  tint,
}: {
  label: string;
  value: string;
  suffix?: string;
  icon: React.ReactNode;
  tint: string;
}) {
  const SA = useSaTheme();
  return (
    <motion.div
      variants={item}
      whileHover={{ y: -4, scale: 1.01 }}
      style={{
        borderRadius: 18,
        padding: "18px 20px",
        background: SA.panel,
        border: `1px solid ${SA.border}`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -30,
          insetInlineEnd: -30,
          width: 110,
          height: 110,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${tint}26, transparent 70%)`,
        }}
      />
      <Group gap={12} wrap="nowrap" align="flex-start">
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${tint}1f`,
            color: tint,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <Stack gap={0}>
          <Text size="xs" fw={700} style={{ color: SA.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
            {label}
          </Text>
          <Text fw={800} size="xl" style={{ color: SA.text }}>
            {value}
            {suffix ? (
              <Text component="span" size="sm" style={{ color: SA.muted }}>
                {" "}
                {suffix}
              </Text>
            ) : null}
          </Text>
        </Stack>
      </Group>
    </motion.div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const SA = useSaTheme();
  return (
    <motion.div
      variants={item}
      style={{
        borderRadius: 18,
        padding: "18px 20px",
        background: SA.panel,
        border: `1px solid ${SA.border}`,
      }}
    >
      <Text size="sm" fw={800} style={{ color: SA.text }}>
        {title}
      </Text>
      {children}
    </motion.div>
  );
}

export default function PlatformAnalyticsPage() {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [data, setData] = useState<PlatformAnalytics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getPlatformAnalytics()
      .then((rows) => !cancelled && setData(rows))
      .catch((err) => !cancelled && setError(getErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const growthData = useMemo(
    () =>
      data?.monthlyGrowth.map((m) => ({
        month: m.month,
        tenants: m.count,
      })) ?? [],
    [data],
  );

  const statusData = useMemo(
    () =>
      data?.subscriptionsByStatus.map((s) => ({
        name: t(`sa.sub.${s.status}`),
        value: s.count,
        color: STATUS_COLORS[s.status] ?? "#94A3B8",
      })) ?? [],
    [data, t],
  );

  const pkgData = useMemo(
    () =>
      data?.tenantsByPackage.map((p) => ({
        name: p.packageName || p.packageId,
        tenants: p.count,
      })) ?? [],
    [data],
  );

  const currency = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  if (error) {
    return (
      <Stack align="center" justify="center" py={80}>
        <Text size="sm" style={{ color: SA.danger }}>
          {error}
        </Text>
      </Stack>
    );
  }

  if (!data) {
    return (
      <Stack align="center" justify="center" py={80}>
        <Loader color={SA.accent} size="lg" />
      </Stack>
    );
  }

  const tooltipStyle = {
    borderRadius: 12,
    border: `1px solid ${SA.border}`,
    background: SA.bgSidebar,
    color: SA.text,
    fontSize: 12,
    boxShadow: SA.shadow,
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      style={{ padding: "26px 28px" }}
    >
      <motion.div variants={item}>
        <Text fw={800} size="xl" style={{ color: SA.text, letterSpacing: -0.3 }}>
          {t("sa.title.analytics")}
        </Text>
        <Text size="sm" mt={2} style={{ color: SA.muted }}>
          {t("sa.analytics.subtitle")}
        </Text>
      </motion.div>

      {/* KPI cards */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" mt="xl">
        <KpiCard
          label={t("sa.analytics.mrr")}
          value={currency(data.mrr)}
          suffix="PKR"
          icon={<IndianRupee size={20} />}
          tint={SA.cyan}
        />
        <KpiCard
          label={t("sa.analytics.totalTenants")}
          value={String(data.totalTenants)}
          icon={<Building2 size={20} />}
          tint={SA.accent2}
        />
        <KpiCard
          label={t("sa.analytics.activeTenants")}
          value={String(data.activeTenants)}
          icon={<TrendingUp size={20} />}
          tint={SA.success}
        />
        <KpiCard
          label={t("sa.analytics.totalUsers")}
          value={String(data.totalUsers)}
          icon={<Users size={20} />}
          tint={SA.violet}
        />
      </SimpleGrid>

      {/* Growth + status */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" mt="md">
        <ChartCard title={t("sa.analytics.growth")}>
          {growthData.length === 0 ? (
            <Text size="sm" mt="lg" ta="center" style={{ color: SA.muted }}>
              {t("sa.analytics.noData")}
            </Text>
          ) : (
            <Box h={230} mt="sm">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={growthData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="saGrowthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={SA.accent} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={SA.accent} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" stroke={SA.border} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: SA.muted }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: SA.muted }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 700, color: SA.text }} />
                  <Area type="monotone" dataKey="tenants" stroke={SA.accent} strokeWidth={2.5} fill="url(#saGrowthFill)" animationDuration={900} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}
        </ChartCard>

        <ChartCard title={t("sa.analytics.byStatus")}>
          {statusData.length === 0 ? (
            <Text size="sm" mt="lg" ta="center" style={{ color: SA.muted }}>
              {t("sa.analytics.noData")}
            </Text>
          ) : (
            <Box h={230} mt="sm">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {statusData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 700, color: SA.text }} />
                </PieChart>
              </ResponsiveContainer>
              <Group gap={14} justify="center" mt="xs" wrap="wrap">
                {statusData.map((entry, i) => (
                  <Group key={i} gap={6} wrap="nowrap">
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: entry.color,
                      }}
                    />
                    <Text size="xs" style={{ color: SA.textSoft }}>
                      {entry.name} ({entry.value})
                    </Text>
                  </Group>
                ))}
              </Group>
            </Box>
          )}
        </ChartCard>
      </SimpleGrid>

      {/* Tenants by package */}
      <motion.div
        variants={item}
        style={{
          borderRadius: 18,
          padding: "18px 20px",
          background: SA.panel,
          border: `1px solid ${SA.border}`,
          marginTop: "md",
        }}
      >
        <Text size="sm" fw={800} style={{ color: SA.text }}>
          {t("sa.analytics.byPackage")}
        </Text>
        {pkgData.length === 0 ? (
          <Text size="sm" mt="lg" ta="center" style={{ color: SA.muted }}>
            {t("sa.analytics.noData")}
          </Text>
        ) : (
          <Box h={230} mt="sm">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pkgData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" stroke={SA.border} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: SA.muted }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: SA.muted }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 700, color: SA.text }} cursor={{ fill: SA.panelHover }} />
                <Bar dataKey="tenants" radius={[8, 8, 0, 0]} maxBarSize={52}>
                  {pkgData.map((_, i) => (
                    <Cell key={i} fill={PKG_COLORS[i % PKG_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Box>
        )}
      </motion.div>
    </motion.div>
  );
}
