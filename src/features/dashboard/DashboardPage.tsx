// ==========================================
// DASHBOARD HOME — Analytics overview
// ==========================================
// Animated stat cards, revenue trend area chart, invoice-status
// donut, top products bars, stock health, and recent invoices.

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

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

import {
  Badge,
  Box,
  Card,
  Divider,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";

import {
  TrendingUp,
  Wallet,
  Receipt,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  CircleDollarSign,
} from "lucide-react";

import {
  reportSalesSummary,
  reportSalesByMonth,
  reportTopProducts,
  reportStock,
  listInvoices,
  listPurchaseOrders,
} from "../../api/backend";

import type {
  PublicUser,
  SalesSummary,
  SalesByPeriod,
  StockSummary,
  TopProduct,
  PublicInvoice,
  PublicPurchaseOrder,
} from "../../types/backend";

import AnimatedNumber from "../../components/AnimatedNumber";
import { INK } from "../../theme";

// ==========================================
// HELPERS
// ==========================================

export function p(paisa: number): string {
  return (paisa / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Recharts-safe money formatter (tooltip values may be undefined).
const fmtMoney = (value: unknown): string => p(Math.round(Number(value ?? 0) * 100));

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function DashboardHome({ user }: { user: PublicUser }) {
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [byMonth, setByMonth] = useState<SalesByPeriod[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [recentInvoices, setRecentInvoices] = useState<PublicInvoice[]>([]);
  const [recentPOs, setRecentPOs] = useState<PublicPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      reportSalesSummary().catch(() => null),
      reportSalesByMonth().catch(() => []),
      reportTopProducts().catch(() => []),
      reportStock(10).catch(() => null),
      listInvoices().catch(() => []),
      listPurchaseOrders().catch(() => []),
    ]).then(([s, m, tp, st, inv, po]) => {
      setSales(s);
      setByMonth(m ?? []);
      setTopProducts(tp ?? []);
      setStock(st);
      setRecentInvoices((inv ?? []).slice(0, 6));
      setRecentPOs((po ?? []).slice(0, 6));
      setLoading(false);
    });
  }, []);

  // Derive invoice-status donut data
  const statusData = useMemo(() => {
    if (!sales) return [];
    return [
      { name: "Paid", value: sales.paidCount, color: INK.chart.green },
      { name: "Pending", value: sales.finalizedCount, color: INK.chart.blue },
      { name: "Draft", value: sales.draftCount, color: INK.chart.orange },
      { name: "Cancelled", value: sales.cancelledCount, color: INK.chart.red },
    ].filter((d) => d.value > 0);
  }, [sales]);

  // Chart-friendly monthly revenue series
  const revenueSeries = useMemo(
    () =>
      byMonth.map((m) => ({
        name: m.period,
        Revenue: m.revenue / 100,
        Collected: m.paid / 100,
      })),
    [byMonth],
  );

  const productData = useMemo(
    () =>
      topProducts.slice(0, 7).map((prod) => ({
        name:
          prod.productName.length > 16
            ? `${prod.productName.slice(0, 15)}…`
            : prod.productName,
        Value: prod.totalRevenue / 100,
        fill: INK.chart.navy,
      })),
    [topProducts],
  );

  const lowStockItems = stock?.items
    .filter((i) => i.isLowStock)
    .slice(0, 5) ?? [];

  const collectionRate = useMemo(() => {
    if (!sales || sales.totalRevenue <= 0) return 0;
    return Math.round((sales.totalPaid / sales.totalRevenue) * 100);
  }, [sales]);

  if (loading) {
    return (
      <Stack align="center" justify="center" style={{ minHeight: "60vh" }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            border: `3px solid ${INK.border}`,
            borderTopColor: INK.gold,
          }}
        />
        <Text c="dimmed" size="sm">
          Loading your dashboard…
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      {/* ---- HERO BANNER ---- */}
      <motion.div
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <Box
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 20,
            padding: "28px 32px",
            background:
              "linear-gradient(120deg, #131C39 0%, #1D2B54 55%, #2E4178 100%)",
            color: "#fff",
          }}
        >
          <motion.div
            aria-hidden
            style={{
              position: "absolute",
              width: 320,
              height: 320,
              borderRadius: "50%",
              right: -80,
              top: -140,
              background:
                "radial-gradient(circle, rgba(201,149,42,0.35) 0%, transparent 70%)",
            }}
            animate={{ scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden
            style={{
              position: "absolute",
              width: 220,
              height: 220,
              borderRadius: "50%",
              right: 160,
              bottom: -120,
              background:
                "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)",
            }}
            animate={{ scale: [1.2, 1, 1.2] }}
            transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
          />
          <Group justify="space-between" align="flex-start" wrap="wrap" style={{ position: "relative" }}>
            <Stack gap={4}>
              <Text size="xs" style={{ color: "#E6C965", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>
                Welcome back
              </Text>
              <Text fw={800} size="xl" style={{ letterSpacing: -0.4 }}>
                {user.fullName.split(" ")[0]}, here’s your business at a glance.
              </Text>
              <Text size="sm" style={{ color: "#A9B6D6" }}>
                Revenue collection rate is{" "}
                <Text span fw={700} style={{ color: collectionRate >= 70 ? "#7AD69A" : "#F0C15A" }}>
                  {collectionRate}%
                </Text>{" "}
                —{" "}
                {collectionRate >= 70
                  ? "healthy cash flow."
                  : "consider following up on outstanding invoices."}
              </Text>
            </Stack>
            <Group gap={10}>
              <Badge size="lg" variant="light" color="gold" styles={{ label: { fontWeight: 700 } }}>
                <Group gap={6} wrap="nowrap">
                  <CircleDollarSign size={14} />
                  {user.role.toUpperCase()}
                </Group>
              </Badge>
            </Group>
          </Group>
        </Box>
      </motion.div>

      {/* ---- STAT CARDS ---- */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <StatCard
          delay={0.05}
          icon={<TrendingUp size={18} />}
          tint={INK.chart.navy}
          label="Total Revenue"
          value={sales ? p(sales.totalRevenue) : "—"}
          sub={
            <Group gap={6}>
              <Text size="xs" c="dimmed">{sales?.totalInvoices ?? 0} invoices</Text>
              <Badge size="xs" color="blue" variant="light">{sales?.paidCount ?? 0} paid</Badge>
            </Group>
          }
          footer={
            sales && sales.totalTax > 0 ? `Includes ${p(sales.totalTax)} tax` : "No tax recorded yet"
          }
        />
        <StatCard
          delay={0.1}
          icon={<Wallet size={18} />}
          tint={INK.chart.green}
          label="Collected"
          value={sales ? p(sales.totalPaid) : "—"}
          sub={
            <Group gap={6}>
              <ArrowUpRight size={14} color={INK.chart.green} />
              <Text size="xs" style={{ color: INK.chart.green }}>{collectionRate}% collection rate</Text>
            </Group>
          }
          footer="Cash actually received"
        />
        <StatCard
          delay={0.15}
          icon={<Receipt size={18} />}
          tint={sales && sales.totalOutstanding > 0 ? INK.chart.orange : INK.chart.green}
          label="Outstanding"
          value={sales ? p(sales.totalOutstanding) : "—"}
          sub={
            <Group gap={6}>
              <ArrowDownRight size={14} color={sales && sales.totalOutstanding > 0 ? INK.chart.orange : INK.chart.green} />
              <Text size="xs" c="dimmed">{sales?.finalizedCount ?? 0} pending invoices</Text>
            </Group>
          }
          footer={
            sales && sales.totalOutstanding > 0
              ? "Follow up to recover receivables"
              : "Nothing owed — great!"
          }
        />
        <StatCard
          delay={0.2}
          icon={<Package size={18} />}
          tint={INK.chart.violet}
          label="Products"
          value={String(stock?.totalProducts ?? 0)}
          sub={
            <Group gap={6}>
              <Text size="xs" c="dimmed">{stock?.totalStockUnits.toLocaleString() ?? 0} units</Text>
            </Group>
          }
          footer={
            <Group gap={6}>
              <AlertTriangle size={12} color={stock && stock.lowStockCount > 0 ? INK.chart.orange : INK.chart.green} />
              <Text size="xs" c={stock && stock.lowStockCount > 0 ? "orange" : "green"}>
                {stock?.lowStockCount ?? 0} low stock
              </Text>
            </Group>
          }
        />
      </SimpleGrid>

      {/* ---- CHARTS ROW 1 ---- */}
      <Group align="stretch" grow>
        {/* Revenue trend */}
        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }} style={{ flex: 2, minWidth: 300 }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Group justify="space-between" mb="md">
              <Stack gap={2}>
                <Text fw={700} style={{ color: INK.text }}>Revenue Trend</Text>
                <Text size="xs" c="dimmed">Monthly invoiced vs collected</Text>
              </Stack>
              <Badge color="gold" variant="light" size="sm">PKR</Badge>
            </Group>
            {revenueSeries.length === 0 ? (
              <EmptyChart message="No monthly sales data yet. Create and finalize invoices to see trends." />
            ) : (
              <Box h={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={INK.chart.navy} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={INK.chart.navy} stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="paidFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={INK.chart.gold} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={INK.chart.gold} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 4" stroke="#E7ECF5" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                    <Tooltip
                      formatter={(value) => [fmtMoney(value), ""]}
                      labelStyle={{ fontWeight: 700, color: INK.text }}
                      contentStyle={{ borderRadius: 12, border: `1px solid ${INK.border}`, boxShadow: "0 10px 30px -12px rgba(29,43,84,0.25)" }}
                    />
                    <Area type="monotone" dataKey="Revenue" stroke={INK.chart.navy} strokeWidth={2.5} fill="url(#revFill)" animationDuration={900} />
                    <Area type="monotone" dataKey="Collected" stroke={INK.chart.gold} strokeWidth={2} fill="url(#paidFill)" animationDuration={900} />
                  </AreaChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Card>
        </motion.div>

        {/* Invoice status donut */}
        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.16 }} style={{ flex: 1, minWidth: 260 }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Text fw={700} style={{ color: INK.text }} mb="md">Invoice Status</Text>
            {statusData.length === 0 ? (
              <EmptyChart message="No invoices yet." />
            ) : (
              <>
                <Box h={210} pos="relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={86}
                        paddingAngle={3}
                        cornerRadius={6}
                        animationDuration={900}
                      >
                        {statusData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [`${Number(value ?? 0)} invoices`, String(name)]}
                        contentStyle={{ borderRadius: 12, border: `1px solid ${INK.border}` }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <Box
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      pointerEvents: "none",
                    }}
                  >
                    <Text fw={800} size="xl" style={{ color: INK.text }} className="tabular">
                      {sales?.totalInvoices ?? 0}
                    </Text>
                    <Text size="xs" c="dimmed">total invoices</Text>
                  </Box>
                </Box>
                <Stack gap={6} mt="sm">
                  {statusData.map((d) => (
                    <Group key={d.name} justify="space-between">
                      <Group gap={6}>
                        <Box w={8} h={8} style={{ borderRadius: 4, background: d.color }} />
                        <Text size="xs">{d.name}</Text>
                      </Group>
                      <Text size="xs" fw={700} className="tabular">{d.value}</Text>
                    </Group>
                  ))}
                </Stack>
              </>
            )}
          </Card>
        </motion.div>
      </Group>

      {/* ---- CHARTS ROW 2 ---- */}
      <Group align="stretch" grow>
        {/* Top products */}
        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.22 }} style={{ flex: 2, minWidth: 300 }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Text fw={700} style={{ color: INK.text }} mb="md">Top Products by Revenue</Text>
            {productData.length === 0 ? (
              <EmptyChart message="Finalize invoices to surface your best sellers." />
            ) : (
              <Box h={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={productData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#E7ECF5" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: INK.muted }} tickLine={false} axisLine={false} />
                    <Tooltip
                      formatter={(value) => [fmtMoney(value), "Revenue"]}
                      contentStyle={{ borderRadius: 12, border: `1px solid ${INK.border}` }}
                      cursor={{ fill: "rgba(29,43,84,0.04)" }}
                    />
                    <Bar dataKey="Value" radius={[0, 8, 8, 0]} animationDuration={900}>
                      {productData.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? INK.chart.gold : INK.chart.navy} fillOpacity={i === 0 ? 1 : 1 - i * 0.1} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Card>
        </motion.div>

        {/* Stock health */}
        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.28 }} style={{ flex: 1, minWidth: 260 }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Group justify="space-between" mb="md">
              <Text fw={700} style={{ color: INK.text }}>Stock Health</Text>
              <Badge color={lowStockItems.length > 0 ? "orange" : "green"} variant="light" size="sm">
                {lowStockItems.length} low
              </Badge>
            </Group>

            {stock ? (
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Stock value at cost</Text>
                  <Text size="sm" fw={700} className="tabular">{p(stock.totalValueAtCost)}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Stock value at sell</Text>
                  <Text size="sm" fw={700} className="tabular" style={{ color: INK.chart.green }}>{p(stock.totalValueAtSell)}</Text>
                </Group>
                <Divider />
                <Group justify="space-between">
                  <Text size="xs" fw={600}>Potential profit</Text>
                  <Text size="sm" fw={800} className="tabular" style={{ color: INK.chart.green }}>
                    {p(stock.totalValueAtSell - stock.totalValueAtCost)}
                  </Text>
                </Group>

                <Divider my="xs" label="Low stock alert" labelPosition="left" styles={{ label: { fontSize: 11, fontWeight: 700 } }} />

                {lowStockItems.length === 0 ? (
                  <Text size="xs" c="dimmed" ta="center" py="md">
                    All products are well stocked. 
                  </Text>
                ) : (
                  <Stack gap="sm">
                    {lowStockItems.map((item) => {
                      const max = Math.max(item.quantityInStock, 10);
                      const pct = Math.max(0, Math.min(100, (item.quantityInStock / max) * 100));
                      return (
                        <Box key={item.productId}>
                          <Group justify="space-between" mb={4}>
                            <Text size="xs" fw={600} style={{ color: INK.text }} truncate>
                              {item.productName}
                            </Text>
                            <Text size="xs" className="tabular" c={item.quantityInStock <= 0 ? "red" : "orange"}>
                              {item.quantityInStock} left
                            </Text>
                          </Group>
                          <Progress
                            value={pct}
                            size="sm"
                            radius="xl"
                            color={item.quantityInStock <= 0 ? "red" : "orange"}
                          />
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </Stack>
            ) : (
              <EmptyChart message="No stock data yet." />
            )}
          </Card>
        </motion.div>
      </Group>

      {/* ---- RECENT INVOICES ---- */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.34 }}>
        <Card withBorder shadow="sm" p="lg">
          <Group justify="space-between" mb="md">
            <Stack gap={2}>
              <Text fw={700} style={{ color: INK.text }}>Recent Invoices</Text>
              <Text size="xs" c="dimmed">Latest billing activity</Text>
            </Stack>
            <Badge color="gold" variant="light" size="sm">
              {recentInvoices.length} shown
            </Badge>
          </Group>
          {recentInvoices.length === 0 ? (
            <EmptyChart message="No invoices yet. Head to the Invoices module to create your first bill." />
          ) : (
            <Box style={{ overflowX: "auto" }}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Invoice</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Total</Table.Th>
                    <Table.Th ta="right">Balance</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {recentInvoices.map((inv, i) => (
                    <motion.tr
                      key={inv.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i, duration: 0.3 }}
                    >
                      <Table.Td>
                        <Text size="sm" fw={600} style={{ color: INK.text }} className="mono">
                          {inv.invoiceNumber}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">{inv.invoiceDate}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="sm"
                          variant="light"
                          color={
                            inv.status === "paid"
                              ? "green"
                              : inv.status === "finalized"
                                ? "blue"
                                : inv.status === "cancelled"
                                  ? "red"
                                  : "yellow"
                          }
                        >
                          {inv.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={600} className="tabular">{p(inv.grandTotal)}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text
                          size="sm"
                          className="tabular"
                          c={inv.balanceDue > 0 ? "orange" : "green"}
                        >
                          {p(inv.balanceDue)}
                        </Text>
                      </Table.Td>
                    </motion.tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}
        </Card>
      </motion.div>

      {/* ---- RECENT PURCHASE ORDERS ---- */}
      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.4 }}>
        <Card withBorder shadow="sm" p="lg">
          <Group justify="space-between" mb="md">
            <Stack gap={2}>
              <Text fw={700} style={{ color: INK.text }}>Recent Purchase Orders</Text>
              <Text size="xs" c="dimmed">Latest procurement activity</Text>
            </Stack>
            <Badge color="gold" variant="light" size="sm">
              {recentPOs.length} shown
            </Badge>
          </Group>
          {recentPOs.length === 0 ? (
            <EmptyChart message="No purchase orders yet. Head to the Purchasing module to order stock from suppliers." />
          ) : (
            <Box style={{ overflowX: "auto" }}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>PO</Table.Th>
                    <Table.Th>Supplier</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Total</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {recentPOs.map((po, i) => (
                    <motion.tr
                      key={po.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.05 * i, duration: 0.3 }}
                    >
                      <Table.Td>
                        <Text size="sm" fw={600} style={{ color: INK.text }} className="mono">
                          {po.poNumber}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{po.supplierName}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">{po.poDate}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="sm"
                          variant="light"
                          color={
                            po.status === "paid"
                              ? "green"
                              : po.status === "received"
                                ? "teal"
                                : po.status === "ordered"
                                  ? "blue"
                                  : po.status === "cancelled"
                                    ? "red"
                                    : "yellow"
                          }
                        >
                          {po.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={600} className="tabular">{p(po.grandTotal)}</Text>
                      </Table.Td>
                    </motion.tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}
        </Card>
      </motion.div>
    </Stack>
  );
}

// ==========================================
// STAT CARD
// ==========================================

function StatCard({
  label,
  value,
  icon,
  tint,
  sub,
  footer,
  delay,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tint: string;
  sub: React.ReactNode;
  footer?: React.ReactNode;
  delay: number;
}) {
  const isMoney = value.includes(".");
  const isDash = value === "—";
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className="lift"
    >
      <Card withBorder shadow="sm" padding="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text size="xs" fw={600} style={{ color: INK.muted, letterSpacing: 0.4, textTransform: "uppercase" }}>
              {label}
            </Text>
            <Text fw={800} size="xl" style={{ color: INK.text, letterSpacing: -0.5 }} className="tabular">
              {isDash ? (
                "—"
              ) : isMoney ? (
                <AnimatedNumber value={parseFloat(value.replace(/[^0-9.-]/g, "")) || 0} decimals={2} prefix="₨ " />
              ) : (
                <AnimatedNumber value={parseInt(value, 10) || 0} />
              )}
            </Text>
          </Stack>
          <ThemeIcon
            radius="md"
            size="lg"
            variant="light"
            style={{ background: `${tint}18`, color: tint }}
          >
            {icon}
          </ThemeIcon>
        </Group>
        <Box mt="xs">{sub}</Box>
        {footer && (
          <>
            <Divider my="sm" />
            <Text size="xs" c="dimmed">{footer}</Text>
          </>
        )}
      </Card>
    </motion.div>
  );
}

// ==========================================
// EMPTY CHART STATE
// ==========================================

function EmptyChart({ message }: { message: string }) {
  return (
    <Box
      style={{
        height: 220,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
        background: "var(--app-soft)",
        border: "1px dashed var(--app-border)",
      }}
    >
      <Text size="sm" c="dimmed" ta="center" maw={260}>
        {message}
      </Text>
    </Box>
  );
}
