// ==========================================
// PLATFORM OVERVIEW — Super Admin landing
// ==========================================

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import {
  Badge,
  Button,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import {
  ArrowUpRight,
  Building2,
  Layers,
  Plus,
  Users,
  Activity,
} from "lucide-react";

import {
  getErrorMessage,
  listPackages,
  listTenantCompanies,
} from "../../api/backend";
import type { TenantCompanySummary } from "../../types/backend";
import { useI18n } from "../../i18n/I18nProvider";
import LottieAnimation from "../../components/LottieAnimation";
import platformPulse from "../../assets/lottie/platform-pulse.json";
import { useSaTheme } from "./saTheme.tsx";
import type { SaView } from "./SuperAdminShell";

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

function StatCard({
  label,
  value,
  icon,
  tint,
  delay,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tint: string;
  delay: number;
}) {
  const SA = useSaTheme();
  return (
    <motion.div
      variants={item}
      custom={delay}
      whileHover={{ y: -5, scale: 1.01 }}
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
          top: -40,
          insetInlineEnd: -40,
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${tint}, transparent 70%)`,
          opacity: 0.5,
        }}
      />
      <Group justify="space-between" wrap="nowrap" style={{ position: "relative" }}>
        <Stack gap={4}>
          <Text size="xs" fw={600} style={{ color: SA.textSoft, letterSpacing: 0.4, textTransform: "uppercase" }}>
            {label}
          </Text>
          <motion.div
            key={value}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20, delay }}
          >
            <Text fw={800} size="xl" style={{ color: SA.text, letterSpacing: -0.5 }}>
              {value}
            </Text>
          </motion.div>
        </Stack>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: tint,
            color: "#06121F",
          }}
        >
          {icon}
        </div>
      </Group>
    </motion.div>
  );
}

export default function PlatformOverviewPage({
  onNavigate,
}: {
  onNavigate: (v: SaView) => void;
}) {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [tenants, setTenants] = useState<TenantCompanySummary[]>([]);
  const [packageCount, setPackageCount] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listTenantCompanies()
      .then((rows) => !cancelled && setTenants(rows))
      .catch((err) => !cancelled && setError(getErrorMessage(err)));
    listPackages(true)
      .then((rows) => !cancelled && setPackageCount(rows.length))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const active = tenants.filter((t) => t.isActive).length;
    const users = tenants.reduce((sum, t) => sum + t.userCount, 0);
    return {
      total: tenants.length,
      active,
      users,
      packages: packageCount,
    };
  }, [tenants, packageCount]);

  const recent = tenants.slice(0, 5);

  return (
    <ScrollArea h="100%">
      <Stack gap="lg" p={28} maw={1180} mx="auto">
        {/* ==================== HERO ==================== */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 22,
            padding: "34px 36px",
            background:
              "linear-gradient(130deg, rgba(56,189,248,0.14) 0%, rgba(129,140,248,0.12) 45%, rgba(5,7,15,0) 70%)",
            border: `1px solid ${SA.borderStrong}`,
          }}
        >
          {/* animated orbs */}
          <motion.div
            aria-hidden
            animate={{ x: [0, 30, 0], y: [0, -20, 0], opacity: [0.5, 0.8, 0.5] }}
            transition={{ repeat: Infinity, duration: 9, ease: "easeInOut" }}
            style={{
              position: "absolute",
              top: -80,
              insetInlineEnd: 60,
              width: 260,
              height: 260,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(56,189,248,0.35), transparent 70%)",
            }}
          />
          <motion.div
            aria-hidden
            animate={{ x: [0, -24, 0], y: [0, 16, 0], opacity: [0.4, 0.7, 0.4] }}
            transition={{ repeat: Infinity, duration: 11, ease: "easeInOut" }}
            style={{
              position: "absolute",
              bottom: -100,
              insetInlineStart: 180,
              width: 240,
              height: 240,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(129,140,248,0.3), transparent 70%)",
            }}
          />

          <Stack gap={6} style={{ position: "relative", zIndex: 1 }}>
            <motion.div variants={item}>
              <Badge
                variant="light"
                styles={{
                  root: {
                    background: "rgba(56,189,248,0.12)",
                    color: SA.cyan,
                    border: "1px solid rgba(56,189,248,0.3)",
                  },
                  label: { fontWeight: 700, letterSpacing: 1 },
                }}
              >
                PLATFORM
              </Badge>
            </motion.div>
            <motion.div variants={item}>
              <Text
                fw={800}
                fz={30}
                style={{
                  letterSpacing: -0.8,
                  background: SA.gradientText,
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {t("sa.overview.heroTitle")}
              </Text>
            </motion.div>
            <motion.div variants={item}>
              <Text size="sm" style={{ color: SA.textSoft, maxWidth: 560 }}>
                {t("sa.overview.heroSubtitle")}
              </Text>
            </motion.div>
            <motion.div variants={item}>
              <Group gap="sm" mt="xs">
                <Button
                  size="sm"
                  leftSection={<Plus size={15} />}
                  onClick={() => onNavigate("tenants")}
                  styles={{
                    root: {
                      background: SA.gradient,
                      color: "#06121F",
                      fontWeight: 700,
                      boxShadow: "0 10px 26px -10px rgba(56,189,248,0.7)",
                      "&:hover": { filter: "brightness(1.08)" },
                    },
                  }}
                >
                  {t("sa.overview.newTenant")}
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  onClick={() => onNavigate("packages")}
                  styles={{
                    root: {
                      background: "rgba(255,255,255,0.06)",
                      color: SA.text,
                      border: `1px solid ${SA.border}`,
                      "&:hover": { background: SA.panelHover },
                    },
                  }}
                >
                  {t("sa.overview.managePackages")}
                </Button>
              </Group>
            </motion.div>
          </Stack>

          {/* Lottie pulse animation */}
          <motion.div
            variants={item}
            aria-hidden
            style={{
              position: "absolute",
              insetInlineEnd: 40,
              top: "50%",
              transform: "translateY(-50%)",
              width: 220,
              height: 220,
              opacity: 0.9,
            }}
          >
            <LottieAnimation animationData={platformPulse} size="100%" />
          </motion.div>
        </motion.div>

        {error && (
          <Text size="sm" style={{ color: SA.danger }}>
            {error}
          </Text>
        )}

        {/* ==================== STATS ==================== */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 14,
          }}
        >
          <StatCard
            label={t("sa.overview.stat.tenants")}
            value={stats.total}
            icon={<Building2 size={20} />}
            tint="rgba(56,189,248,0.35)"
            delay={0.1}
          />
          <StatCard
            label={t("sa.overview.stat.active")}
            value={stats.active}
            icon={<Activity size={20} />}
            tint="rgba(52,211,153,0.35)"
            delay={0.18}
          />
          <StatCard
            label={t("sa.overview.stat.users")}
            value={stats.users}
            icon={<Users size={20} />}
            tint="rgba(129,140,248,0.35)"
            delay={0.26}
          />
          <StatCard
            label={t("sa.overview.stat.packages")}
            value={stats.packages}
            icon={<Layers size={20} />}
            tint="rgba(251,191,36,0.35)"
            delay={0.34}
          />
        </motion.div>

        {/* ==================== RECENT TENANTS ==================== */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          style={{
            borderRadius: 18,
            background: SA.panel,
            border: `1px solid ${SA.border}`,
            overflow: "hidden",
          }}
        >
          <Group justify="space-between" px="lg" py="md" style={{ borderBottom: `1px solid ${SA.border}` }}>
            <Text fw={700} size="sm" style={{ color: SA.text }}>
              {t("sa.overview.recent")}
            </Text>
            <Button
              variant="subtle"
              size="xs"
              rightSection={<ArrowUpRight size={14} />}
              onClick={() => onNavigate("tenants")}
              styles={{
                root: { color: SA.accent, "&:hover": { background: "rgba(56,189,248,0.1)" } },
                label: { fontWeight: 700 },
              }}
            >
              {t("sa.overview.viewAll")}
            </Button>
          </Group>

          {recent.length === 0 ? (
            <Stack align="center" gap={6} p="xl">
              <LottieAnimation
                animationData={platformPulse}
                size={96}
                style={{ opacity: 0.8 }}
              />
              <Text size="sm" style={{ color: SA.muted }}>
                {t("sa.overview.empty")}
              </Text>
            </Stack>
          ) : (
            <Stack gap={0}>
              {recent.map((tenant, i) => (
                <motion.div
                  key={tenant.id}
                  variants={item}
                  whileHover={{ background: SA.panelHover }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 20px",
                    borderBottom:
                      i === recent.length - 1 ? "none" : `1px solid ${SA.border}`,
                    cursor: "pointer",
                    borderRadius: 0,
                  }}
                  onClick={() => onNavigate("tenants")}
                >
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 11,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(255,255,255,0.05)",
                      border: `1px solid ${SA.border}`,
                      color: SA.textSoft,
                    }}
                  >
                    <Building2 size={17} />
                  </div>
                  <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600} size="sm" truncate style={{ color: SA.text }}>
                      {tenant.name}
                    </Text>
                    <Text size="xs" style={{ color: SA.muted }} truncate>
                      {tenant.packageName ?? "—"} · {tenant.userCount}{" "}
                      {t("sa.overview.usersShort")}
                    </Text>
                  </Stack>
                  <Badge
                    size="sm"
                    variant="light"
                    styles={{
                      root: {
                        background: tenant.isActive
                          ? "rgba(52,211,153,0.12)"
                          : "rgba(248,113,113,0.12)",
                        color: tenant.isActive ? SA.success : SA.danger,
                        border: `1px solid ${tenant.isActive ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
                      },
                      label: { fontWeight: 700, fontSize: 11 },
                    }}
                  >
                    {t(tenant.isActive ? "sa.status.active" : "sa.status.archived")}
                  </Badge>
                </motion.div>
              ))}
            </Stack>
          )}
        </motion.div>
      </Stack>
    </ScrollArea>
  );
}
