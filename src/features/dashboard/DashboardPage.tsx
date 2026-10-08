// ==========================================
// DASHBOARD HOME — Clean, Human, Breathable UI
// Designed according to reference layout & anti-slop rules
// ==========================================

import { useEffect, useState } from "react";

import SalesPerformanceChart from "./SalesPerformanceChart";

import {
  Badge,
  Box,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ActionIcon,
  Avatar,
  Loader,
} from "@mantine/core";

import {
  Plus,
  ArrowRight,
  ReceiptText,
  Package,
  FileText,
} from "lucide-react";

import {
  reportSalesSummary,
  reportSalesByMonth,
  reportStock,
  listInvoices,
  getCompanyCurrency,
  getCompany,
} from "../../api/backend";

import OnboardingCard from "./OnboardingCard";
import HeroIllustration from "./HeroIllustration";

import type {
  PublicUser,
  SalesSummary,
  SalesByPeriod,
  StockSummary,
  PublicInvoice,
  CurrencyConfig,
} from "../../types/backend";

import { formatPaisaWithSymbol } from "../../utils/currency";

export function p(paisa: number, config?: CurrencyConfig | null): string {
  return formatPaisaWithSymbol(paisa, config);
}

interface DashboardHomeProps {
  user: PublicUser;
  onNavigate?: (module: string) => void;
}

export default function DashboardHome({ user, onNavigate }: DashboardHomeProps) {
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [byMonth, setByMonth] = useState<SalesByPeriod[]>([]);
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [recentInvoices, setRecentInvoices] = useState<PublicInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [currencyConfig, setCurrencyConfig] = useState<CurrencyConfig | null>(null);
  const [hasCompanyDetails, setHasCompanyDetails] = useState<boolean>(true);

  const goTo = (module: string) => {
    if (onNavigate) onNavigate(module);
  };

  useEffect(() => {
    getCompanyCurrency()
      .then((c) => setCurrencyConfig(c))
      .catch(() => {});
    getCompany()
      .then((c) => setHasCompanyDetails(Boolean(c.name && c.phone)))
      .catch(() => setHasCompanyDetails(false));
    Promise.all([
      reportSalesSummary().catch(() => null),
      reportSalesByMonth().catch(() => []),
      reportStock(10).catch(() => null),
      listInvoices().catch(() => []),
    ]).then(([s, m, st, inv]) => {
      setSales(s);
      setByMonth(m ?? []);
      setStock(st);
      setRecentInvoices((inv ?? []).slice(0, 6));
      setLoading(false);
    });
  }, []);

  const firstName = user.fullName ? user.fullName.split(" ")[0] : "there";
  const lowStockCount = stock?.lowStockCount ?? 0;
  const totalRevenue = sales?.totalRevenue ?? 0;
  const totalOutstanding = sales?.totalOutstanding ?? 0;
  const totalInvoices = sales?.totalInvoices ?? 0;

  if (loading) {
    return (
      <Box
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "60vh",
        }}
      >
        <Stack align="center" gap="sm">
          <Loader color="indigo" size="md" />
          <Text size="sm" c="dimmed">
            Opening your store overview…
          </Text>
        </Stack>
      </Box>
    );
  }

  return (
    <Stack gap={28} pb="xl">
      {/* 1. ONBOARDING LAUNCHPAD (Non-blocking & Dismissible) */}
      <OnboardingCard
        user={user}
        hasCompanyDetails={hasCompanyDetails}
        hasProducts={(stock?.totalProducts ?? 0) > 0}
        hasInvoices={totalInvoices > 0}
        onNavigate={goTo}
      />

      {/* 2. HERO WELCOME CARD (Clean, Pure White, Breathable) */}
      <Box
        p={{ base: "xl", sm: "32px" }}
        style={{
          background: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          borderRadius: 24,
          boxShadow: "0 4px 20px -4px rgba(18, 28, 56, 0.04)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <Group justify="space-between" align="center" wrap="wrap" gap="xl">
          <Stack gap="sm" style={{ maxWidth: 520 }}>
            <Text
              fw={800}
              style={{
                fontSize: "1.75rem",
                letterSpacing: -0.5,
                color: "var(--app-text)",
                lineHeight: 1.2,
              }}
            >
              Welcome back, {firstName}!
            </Text>

            <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
              {lowStockCount > 0 ? (
                <>
                  You have{" "}
                  <Text span fw={700} c="orange">
                    {lowStockCount} product{lowStockCount > 1 ? "s" : ""} low on stock
                  </Text>
                  . Here is your business snapshot for today.
                </>
              ) : (
                "Your inventory and sales are running smoothly. Ready to record your next transaction?"
              )}
            </Text>

            {/* Clean Pill Action Buttons */}
            <Group gap="md" pt="xs">
              <Button
                size="sm"
                radius="pill"
                leftSection={<Plus size={16} />}
                onClick={() => goTo("invoices")}
                style={{
                  background: "var(--app-accent-gradient, var(--app-accent))",
                  color: "var(--app-on-accent, #ffffff)",
                  fontWeight: 600,
                  boxShadow: "0 4px 14px -2px var(--app-accent-shadow)",
                  transition: "transform 0.15s ease",
                }}
              >
                + New Sale (POS)
              </Button>

              <Button
                variant="default"
                size="sm"
                radius="pill"
                onClick={() => goTo("inventory")}
                style={{
                  background: "var(--app-surface)",
                  borderColor: "var(--app-border)",
                  color: "var(--app-text)",
                  fontWeight: 600,
                }}
              >
                Manage Stock
              </Button>
            </Group>
          </Stack>

          {/* Clean Isometric Illustration */}
          <Box visibleFrom="sm" pr="md">
            <HeroIllustration size={160} />
          </Box>
        </Group>
      </Box>

      {/* 3. BUSINESS PULSE: 3 SOFT HORIZONTAL PRIORITY CARDS */}
      <Box>
        <Group justify="space-between" mb="md" px={4}>
          <Text fw={700} size="md" style={{ letterSpacing: -0.2 }}>
            Business Overview
          </Text>
          <Text
            size="xs"
            fw={600}
            c="indigo"
            style={{ cursor: "pointer" }}
            onClick={() => goTo("reports")}
          >
            Full Analytics &gt;
          </Text>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
          {/* Card 1: Today's Revenue */}
          <Box
            p="xl"
            onClick={() => goTo("reports")}
            style={{
              borderRadius: 22,
              background: "var(--app-accent-gradient)",
              color: "var(--app-on-accent, #ffffff)",
              boxShadow: "0 10px 24px -6px var(--app-accent-shadow)",
              cursor: "pointer",
              transition: "transform 0.2s ease",
            }}
          >
            <Stack justify="space-between" h="100%" gap="md">
              <Group justify="space-between" align="flex-start">
                <Box>
                  <Text size="xs" style={{ opacity: 0.85, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>
                    Total Sales
                  </Text>
                  <Text fw={800} size="1.4rem" mt={4} style={{ letterSpacing: -0.3 }}>
                    {p(totalRevenue, currencyConfig)}
                  </Text>
                </Box>
                <ActionIcon variant="transparent" c="white" size="sm">
                  <ArrowRight size={18} />
                </ActionIcon>
              </Group>

              <Group gap="xs" style={{ opacity: 0.9 }}>
                <ReceiptText size={15} />
                <Text size="xs" fw={500}>
                  {totalInvoices} invoices generated
                </Text>
              </Group>
            </Stack>
          </Box>

          {/* Card 2: Pending Receivables */}
          <Box
            p="xl"
            onClick={() => goTo("invoices")}
            style={{
              borderRadius: 22,
              background: "linear-gradient(135deg, #5C6BC0 0%, #4D5BA8 100%)",
              color: "#ffffff",
              boxShadow: "0 10px 24px -6px rgba(92, 107, 192, 0.35)",
              cursor: "pointer",
              transition: "transform 0.2s ease",
            }}
          >
            <Stack justify="space-between" h="100%" gap="md">
              <Group justify="space-between" align="flex-start">
                <Box>
                  <Text size="xs" style={{ opacity: 0.85, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>
                    Unpaid Invoices
                  </Text>
                  <Text fw={800} size="1.4rem" mt={4} style={{ letterSpacing: -0.3 }}>
                    {p(totalOutstanding, currencyConfig)}
                  </Text>
                </Box>
                <ActionIcon variant="transparent" c="white" size="sm">
                  <ArrowRight size={18} />
                </ActionIcon>
              </Group>

              <Group gap="xs" style={{ opacity: 0.9 }}>
                <FileText size={15} />
                <Text size="xs" fw={500}>
                  {sales?.finalizedCount ?? 0} bills awaiting payment
                </Text>
              </Group>
            </Stack>
          </Box>

          {/* Card 3: Stock Health */}
          <Box
            p="xl"
            onClick={() => goTo("inventory")}
            style={{
              borderRadius: 22,
              background: "linear-gradient(135deg, #E27D60 0%, #C86548 100%)",
              color: "#ffffff",
              boxShadow: "0 10px 24px -6px rgba(226, 125, 96, 0.35)",
              cursor: "pointer",
              transition: "transform 0.2s ease",
            }}
          >
            <Stack justify="space-between" h="100%" gap="md">
              <Group justify="space-between" align="flex-start">
                <Box>
                  <Text size="xs" style={{ opacity: 0.85, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>
                    Stock Health
                  </Text>
                  <Text fw={800} size="1.4rem" mt={4} style={{ letterSpacing: -0.3 }}>
                    {stock?.totalProducts ?? 0} Products
                  </Text>
                </Box>
                <ActionIcon variant="transparent" c="white" size="sm">
                  <ArrowRight size={18} />
                </ActionIcon>
              </Group>

              <Group gap="xs" style={{ opacity: 0.9 }}>
                <Package size={15} />
                <Text size="xs" fw={500}>
                  {lowStockCount > 0 ? `${lowStockCount} items need reorder` : "All items in stock"}
                </Text>
              </Group>
            </Stack>
          </Box>
        </SimpleGrid>
      </Box>

      {/* 4. RECENT INVOICES — AIRY, READABLE TABLE (Clean & Human) */}
      <Box
        p={{ base: "md", sm: "xl" }}
        style={{
          background: "var(--app-surface)",
          border: "1px solid var(--app-border)",
          borderRadius: 24,
          boxShadow: "0 4px 20px -4px rgba(18, 28, 56, 0.04)",
        }}
      >
        <Group justify="space-between" mb="lg">
          <Stack gap={2}>
            <Text fw={700} size="md" style={{ letterSpacing: -0.2 }}>
              Recent Invoices
            </Text>
            <Text size="xs" c="dimmed">
              Latest transactions recorded across your shop
            </Text>
          </Stack>
          <Button
            variant="subtle"
            size="xs"
            color="indigo"
            rightSection={<ArrowRight size={14} />}
            onClick={() => goTo("invoices")}
          >
            View All Invoices
          </Button>
        </Group>

        {recentInvoices.length === 0 ? (
          <Box py="xl" style={{ textAlign: "center" }}>
            <Text size="sm" c="dimmed">
              No invoices created yet. Tap "+ New Sale" to issue your first invoice!
            </Text>
          </Box>
        ) : (
          <Box style={{ overflowX: "auto" }}>
            <Box
              component="table"
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: "0 8px",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ color: "var(--app-muted)", textAlign: "left", fontSize: 12 }}>
                  <th style={{ padding: "8px 16px", fontWeight: 600 }}>Invoice #</th>
                  <th style={{ padding: "8px 16px", fontWeight: 600 }}>Customer / Party</th>
                  <th style={{ padding: "8px 16px", fontWeight: 600 }}>Date</th>
                  <th style={{ padding: "8px 16px", fontWeight: 600 }}>Amount</th>
                  <th style={{ padding: "8px 16px", fontWeight: 600 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentInvoices.map((inv) => {
                  const isPaid = inv.status === "paid";
                  const isPending = inv.status === "finalized";
                  const statusColor = isPaid ? "teal" : isPending ? "yellow" : "gray";
                  const statusLabel = isPaid ? "Paid" : isPending ? "Pending" : "Draft";

                  return (
                    <tr
                      key={inv.id}
                      onClick={() => goTo("invoices")}
                      style={{
                        background: "var(--app-soft)",
                        borderRadius: 12,
                        cursor: "pointer",
                        transition: "background-color 0.15s ease",
                      }}
                    >
                      <td style={{ padding: "14px 16px", borderTopLeftRadius: 12, borderBottomLeftRadius: 12, fontWeight: 700 }}>
                        {inv.invoiceNumber}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <Group gap="xs" wrap="nowrap">
                          <Avatar size={24} radius="xl" color="indigo" style={{ fontSize: 10 }}>
                            {(inv.referenceNote || "Sale").charAt(0).toUpperCase()}
                          </Avatar>
                          <Text size="xs" fw={600} truncate>
                            {inv.referenceNote || "Standard Sale"}
                          </Text>
                        </Group>
                      </td>
                      <td style={{ padding: "14px 16px", color: "var(--app-muted)", whiteSpace: "nowrap" }}>
                        {inv.createdAt.split("T")[0]}
                      </td>
                      <td style={{ padding: "14px 16px", fontWeight: 700 }}>
                        {p(inv.grandTotal, currencyConfig)}
                      </td>
                      <td style={{ padding: "14px 16px", borderTopRightRadius: 12, borderBottomRightRadius: 12 }}>
                        <Badge
                          color={statusColor}
                          variant="light"
                          size="sm"
                          radius="pill"
                          styles={{
                            root: { textTransform: "capitalize", fontWeight: 600 },
                          }}
                        >
                          {statusLabel}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Box>
          </Box>
        )}
      </Box>

      {/* 5. SALES & REVENUE TRAJECTORY CHART (Executive Graph Design) */}
      {byMonth.length > 0 && (
        <SalesPerformanceChart data={byMonth} currencyConfig={currencyConfig} />
      )}
    </Stack>
  );
}
