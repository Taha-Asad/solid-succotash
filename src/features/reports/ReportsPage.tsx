// ==========================================
// REPORTS & ANALYTICS PAGE
// ==========================================
// Five report tabs, each backed by real charts:
//   1. Sales — area trend, top products, top customers
//   2. Stock — stock levels bar chart + status table
//   3. Profit / Loss — revenue vs cost comparison
//   4. Customer Ledger — balances with payment efficiency
//   5. Stock Movements — purchased vs sold comparisons

import { useCallback, useEffect, useState } from "react";
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
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
} from "@mantine/core";

import {
  reportSalesSummary,
  reportSalesByMonth,
  reportTopProducts,
  reportTopCustomers,
  reportStock,
  reportProfitLoss,
  reportCustomerLedger,
  reportProductMovements,
  exportStockCsv,
  exportCustomerLedgerCsv,
  exportSalesCsv,
  exportReportPdf,
  saveFileDialog,
  getErrorMessage,
} from "../../api/backend";

import type {
  SalesSummary,
  SalesByPeriod,
  TopProduct,
  TopCustomer,
  StockSummary,
  ProfitLossSummary,
  CustomerLedgerEntry,
  ProductMovement,
} from "../../types/backend";

import AnimatedNumber from "../../components/AnimatedNumber";
import { INK } from "../../theme";

// ==========================================
// HELPERS
// ==========================================

function p(paisa: number): string {
  return (paisa / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

// Recharts-safe money formatter (tooltip values may be undefined).
const fmtMoney = (value: unknown): string => p(Math.round(Number(value ?? 0) * 100));

// Opens a save dialog and exports the chosen report as CSV or PDF.
async function exportReport(
  kind: "sales" | "stock" | "ledger",
  format: "csv" | "pdf",
): Promise<void> {
  const path = await saveFileDialog({
    title: `Export ${kind} report as ${format.toUpperCase()}`,
    defaultPath: `${kind}-report.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!path) return;

  try {
    if (format === "pdf") {
      await exportReportPdf(kind, path);
    } else if (kind === "sales") {
      await exportSalesCsv(path);
    } else if (kind === "stock") {
      await exportStockCsv(path);
    } else {
      await exportCustomerLedgerCsv(path);
    }
  } catch (err) {
    alert(getErrorMessage(err));
  }
}

// Inline CSV/PDF export button pair.
function ExportButtons({
  kind,
  align = "flex-end",
}: {
  kind: "sales" | "stock" | "ledger";
  align?: "flex-start" | "flex-end" | "space-between";
}) {
  const justify = align === "space-between" ? "space-between" : align;
  return (
    <Group justify={justify}>
      <Group gap="xs">
        <Button size="xs" variant="outline" onClick={() => exportReport(kind, "csv")}>
          Export {kind} CSV
        </Button>
        <Button size="xs" variant="filled" onClick={() => exportReport(kind, "pdf")}>
          Export {kind} PDF
        </Button>
      </Group>
    </Group>
  );
}

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid #E3E8F1",
  boxShadow: "0 10px 30px -12px rgba(29,43,84,0.25)",
};

function LoadingState() {
  return (
    <Box style={{ minHeight: 300, display: "grid", placeItems: "center" }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          border: "3px solid #E3E8F1",
          borderTopColor: INK.gold,
        }}
      />
    </Box>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card withBorder padding="lg" style={{ borderColor: INK.chart.red }}>
      <Text c="red" fw={600}>
        {message}
      </Text>
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <Box
      style={{
        height: 240,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
        background: "#F3F6FB",
        border: "1px dashed #D3DCEB",
      }}
    >
      <Text size="sm" c="dimmed" ta="center" maw={280}>
        {message}
      </Text>
    </Box>
  );
}

function StatCard({
  label,
  value,
  tint,
  suffix,
  decimals = 0,
  footer,
}: {
  label: string;
  value: number;
  tint: string;
  suffix?: string;
  decimals?: number;
  footer?: string;
}) {
  return (
    <motion.div {...fadeUp} transition={{ duration: 0.45 }} className="lift">
      <Card withBorder shadow="sm" padding="lg">
        <Text size="xs" fw={600} style={{ color: "#5C6B84", letterSpacing: 0.4, textTransform: "uppercase" }}>
          {label}
        </Text>
        <Text fw={800} size="xl" style={{ color: tint, letterSpacing: -0.4 }} className="tabular">
          <AnimatedNumber value={value} decimals={decimals} prefix={decimals > 0 ? "₨ " : ""} suffix={suffix} />
        </Text>
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
// MAIN COMPONENT
// ==========================================

export default function ReportsPage() {
  return (
    <Stack gap="lg">
      <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
        <Stack gap={2}>
          <Text size="xs" fw={700} style={{ color: INK.gold, letterSpacing: 1.4, textTransform: "uppercase" }}>
            Analytics
          </Text>
          <Text fw={800} size="xl" style={{ color: INK.navy, letterSpacing: -0.4 }}>
            Reports & Analytics
          </Text>
          <Text size="sm" c="dimmed">
            Deep-dive into sales, stock and profitability.
          </Text>
        </Stack>
      </motion.div>

      <Tabs defaultValue="sales" variant="pills">
        <Tabs.List>
          <Tabs.Tab value="sales">Sales</Tabs.Tab>
          <Tabs.Tab value="stock">Stock</Tabs.Tab>
          <Tabs.Tab value="profit">Profit / Loss</Tabs.Tab>
          <Tabs.Tab value="ledger">Customer Ledger</Tabs.Tab>
          <Tabs.Tab value="movements">Stock Movements</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="sales" pt="md">
          <SalesReport />
        </Tabs.Panel>
        <Tabs.Panel value="stock" pt="md">
          <StockReport />
        </Tabs.Panel>
        <Tabs.Panel value="profit" pt="md">
          <ProfitLossReport />
        </Tabs.Panel>
        <Tabs.Panel value="ledger" pt="md">
          <CustomerLedgerReport />
        </Tabs.Panel>
        <Tabs.Panel value="movements" pt="md">
          <StockMovementsReport />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

// ==========================================
// SALES REPORT
// ==========================================

function SalesReport() {
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [byMonth, setByMonth] = useState<SalesByPeriod[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, tp, tc] = await Promise.all([
        reportSalesSummary(),
        reportSalesByMonth(),
        reportTopProducts(),
        reportTopCustomers(),
      ]);
      setSummary(s);
      setByMonth(m);
      setTopProducts(tp);
      setTopCustomers(tc);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!summary) return null;

  const revenueSeries = byMonth.map((m) => ({
    name: m.period,
    Revenue: m.revenue / 100,
    Collected: m.paid / 100,
  }));

  const productData = topProducts.slice(0, 8).map((prod) => ({
    name:
      prod.productName.length > 18
        ? `${prod.productName.slice(0, 17)}…`
        : prod.productName,
    Revenue: prod.totalRevenue / 100,
    Qty: prod.totalQuantitySold,
  }));

  const customerData = topCustomers.slice(0, 6).map((c) => ({
    name:
      c.customerName.length > 16
        ? `${c.customerName.slice(0, 15)}…`
        : c.customerName,
    Revenue: c.totalRevenue / 100,
    Paid: c.totalPaid / 100,
  }));

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <StatCard label="Total Revenue" value={summary.totalRevenue / 100} decimals={2} tint={INK.chart.navy} footer={`${summary.totalInvoices} invoices · ${p(summary.totalTax)} tax`} />
        <StatCard label="Total Paid" value={summary.totalPaid / 100} decimals={2} tint={INK.chart.green} footer={`${summary.paidCount} paid invoices`} />
        <StatCard label="Outstanding" value={summary.totalOutstanding / 100} decimals={2} tint={summary.totalOutstanding > 0 ? INK.chart.orange : INK.chart.green} footer={`${summary.finalizedCount} pending · ${summary.draftCount} draft`} />
        <StatCard label="Invoices" value={summary.totalInvoices} tint={INK.chart.violet} footer="across all statuses" />
      </SimpleGrid>

      <ExportButtons kind="sales" />

      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }}>
        <Card withBorder shadow="sm" p="lg">
          <Group justify="space-between" mb="md">
            <Stack gap={2}>
              <Text fw={700} style={{ color: INK.navy }}>Monthly Sales Trend</Text>
              <Text size="xs" c="dimmed">Revenue vs collected over time</Text>
            </Stack>
            <Badge color="gold" variant="light">PKR</Badge>
          </Group>
          {revenueSeries.length === 0 ? (
            <EmptyChart message="No sales data yet — create and finalize invoices first." />
          ) : (
            <Box h={280}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={INK.chart.navy} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={INK.chart.navy} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="salesPaid" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={INK.chart.gold} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={INK.chart.gold} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" stroke="#E7ECF5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5C6B84" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#5C6B84" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                  <Tooltip formatter={(value) => [fmtMoney(value), ""]} labelStyle={{ fontWeight: 700 }} contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="Revenue" stroke={INK.chart.navy} strokeWidth={2.5} fill="url(#salesRev)" animationDuration={900} />
                  <Area type="monotone" dataKey="Collected" stroke={INK.chart.gold} strokeWidth={2} fill="url(#salesPaid)" animationDuration={900} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Card>
      </motion.div>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.16 }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Text fw={700} style={{ color: INK.navy }} mb="md">Top Products</Text>
            {productData.length === 0 ? (
              <EmptyChart message="Finalize invoices to reveal top products." />
            ) : (
              <Box h={300}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={productData} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#E7ECF5" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#5C6B84" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "#5C6B84" }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => [fmtMoney(value), "Revenue"]} contentStyle={tooltipStyle} cursor={{ fill: "rgba(29,43,84,0.04)" }} />
                    <Bar dataKey="Revenue" radius={[0, 8, 8, 0]} animationDuration={900}>
                      {productData.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? INK.chart.gold : INK.chart.navy} fillOpacity={1 - i * 0.09} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Card>
        </motion.div>

        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.22 }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Text fw={700} style={{ color: INK.navy }} mb="md">Customer Revenue Share</Text>
            {customerData.length === 0 ? (
              <EmptyChart message="Customer data will appear once invoices are created." />
            ) : (
              <Box h={300}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={customerData}
                      dataKey="Revenue"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={2}
                      cornerRadius={5}
                      animationDuration={900}
                    >
                      {customerData.map((_, i) => (
                        <Cell key={i} fill={[INK.chart.navy, INK.chart.gold, INK.chart.teal, INK.chart.violet, INK.chart.blue, INK.chart.rose][i % 6]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [fmtMoney(value), "Revenue"]} contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
            )}
          </Card>
        </motion.div>
      </SimpleGrid>
    </Stack>
  );
}

// ==========================================
// STOCK REPORT
// ==========================================

function StockReport() {
  const [data, setData] = useState<StockSummary | null>(null);
  const [threshold, setThreshold] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await reportStock(threshold);
      setData(result);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const topStock = data.items.slice(0, 10).map((item) => ({
    name:
      item.productName.length > 18 ? `${item.productName.slice(0, 17)}…` : item.productName,
    Stock: item.quantityInStock,
    fill: item.isLowStock ? INK.chart.orange : INK.chart.teal,
  }));

  const healthyCount = data.totalProducts - data.lowStockCount - data.outOfStockCount;

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <StatCard label="Products" value={data.totalProducts} tint={INK.chart.navy} footer="total SKUs in catalog" />
        <StatCard label="Units in stock" value={data.totalStockUnits} tint={INK.chart.teal} footer="across all products" />
        <StatCard label="Value at cost" value={data.totalValueAtCost / 100} decimals={2} tint={INK.chart.violet} />
        <StatCard label="Value at sell" value={data.totalValueAtSell / 100} decimals={2} tint={INK.chart.green} />
      </SimpleGrid>

      <Group justify="space-between" wrap="wrap">
        <Group>
          <Badge color="red" variant="light" size="lg">{data.outOfStockCount} out of stock</Badge>
          <Badge color="orange" variant="light" size="lg">{data.lowStockCount} low stock</Badge>
          <Badge color="green" variant="light" size="lg">{healthyCount} healthy</Badge>
        </Group>
        <NumberInput
          size="sm"
          label="Low stock threshold"
          value={threshold}
          onChange={(v) => setThreshold(typeof v === "number" ? v : 10)}
          min={1}
          w={160}
        />
        <ExportButtons kind="stock" />
      </Group>

      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }}>
        <Card withBorder shadow="sm" p="lg">
          <Text fw={700} style={{ color: INK.navy }} mb="md">
            Stock Levels — Top 10
          </Text>
          {data.items.length === 0 ? (
            <EmptyChart message="Add products to see stock levels." />
          ) : (
            <Box h={280}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topStock} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#E7ECF5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5C6B84" }} tickLine={false} axisLine={false} interval={0} angle={-18} height={50} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11, fill: "#5C6B84" }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => [`${Number(value ?? 0)} units`, "Stock"]} contentStyle={tooltipStyle} cursor={{ fill: "rgba(29,43,84,0.04)" }} />
                  <Bar dataKey="Stock" radius={[8, 8, 0, 0]} animationDuration={900}>
                    {topStock.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Card>
      </motion.div>

      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.16 }}>
        <Card withBorder shadow="sm" p="lg">
          <Group justify="space-between" mb="md">
            <Text fw={700} style={{ color: INK.navy }}>Stock Register</Text>
            <Badge color="gold" variant="light">{data.items.length} rows</Badge>
          </Group>
          <ScrollArea>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>SKU</Table.Th>
                  <Table.Th>Product</Table.Th>
                  <Table.Th>Category</Table.Th>
                  <Table.Th ta="right">Stock</Table.Th>
                  <Table.Th ta="right">Cost</Table.Th>
                  <Table.Th ta="right">Sell</Table.Th>
                  <Table.Th ta="right">Value (Cost)</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.items.map((item, i) => (
                  <motion.tr
                    key={item.productId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.02 * i, duration: 0.25 }}
                  >
                    <Table.Td>
                      <Badge variant="outline" size="sm" color="gray">{item.productSku}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600} style={{ color: INK.navy }}>{item.productName}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">{item.categoryName ?? "—"}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={700} className="tabular">{item.quantityInStock}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" className="tabular">{p(item.costPrice)}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" className="tabular">{p(item.sellPrice)}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" className="tabular">{p(item.stockValueAtCost)}</Text>
                    </Table.Td>
                    <Table.Td>
                      {item.quantityInStock <= 0 ? (
                        <Badge color="red" variant="light">Out of stock</Badge>
                      ) : item.isLowStock ? (
                        <Badge color="orange" variant="light">Low</Badge>
                      ) : (
                        <Badge color="green" variant="light">OK</Badge>
                      )}
                    </Table.Td>
                  </motion.tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      </motion.div>
    </Stack>
  );
}

// ==========================================
// PROFIT / LOSS REPORT
// ==========================================

function ProfitLossReport() {
  const [data, setData] = useState<ProfitLossSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reportProfitLoss()
      .then(setData)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const barData = [
    { name: "Revenue", Value: data.totalRevenue / 100, fill: INK.chart.navy },
    { name: "Cost of goods", Value: data.totalCost / 100, fill: INK.chart.red },
    {
      name: "Gross profit",
      Value: Math.abs(data.grossProfit) / 100,
      fill: data.grossProfit >= 0 ? INK.chart.green : INK.chart.orange,
    },
  ];

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <StatCard label="Total Revenue" value={data.totalRevenue / 100} decimals={2} tint={INK.chart.navy} footer="from finalized sales" />
        <StatCard label="Cost of Goods" value={data.totalCost / 100} decimals={2} tint={INK.chart.red} footer="inventory at cost" />
        <StatCard label="Gross Profit" value={data.grossProfit / 100} decimals={2} tint={data.grossProfit >= 0 ? INK.chart.green : INK.chart.red} footer={`Margin ${pct(data.profitMarginPct)}`} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Text fw={700} style={{ color: INK.navy }} mb="md">Revenue vs Cost</Text>
            <Box h={280}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#E7ECF5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#5C6B84" }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#5C6B84" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} />
                  <Tooltip formatter={(value) => [fmtMoney(value), ""]} contentStyle={tooltipStyle} cursor={{ fill: "rgba(29,43,84,0.04)" }} />
                  <Bar dataKey="Value" radius={[8, 8, 0, 0]} animationDuration={900}>
                    {barData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </motion.div>

        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.16 }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Text fw={700} style={{ color: INK.navy }} mb="md">Breakdown</Text>
            <Stack gap="md">
              <Row label="Revenue (from sales)" value={p(data.totalRevenue)} />
              <Row label="− Cost of goods sold" value={`−${p(data.totalCost)}`} valueColor={INK.chart.red} />
              <Divider />
              <Row label="= Gross Profit" value={p(data.grossProfit)} bold valueColor={data.grossProfit >= 0 ? INK.chart.green : INK.chart.red} />
              <Divider />
              <Row label="Tax collected from customers" value={p(data.totalTaxCollected)} muted />
              <Row label="Discounts given to customers" value={`−${p(data.totalDiscountsGiven)}`} muted />
              <Box
                style={{
                  marginTop: 8,
                  borderRadius: 12,
                  padding: 14,
                  background: `${INK.chart.navy}10`,
                  border: `1px solid ${INK.chart.navy}22`,
                }}
              >
                <Group justify="space-between">
                  <Text size="sm" fw={700} style={{ color: INK.navy }}>Profit margin</Text>
                  <Text size="lg" fw={800} className="tabular" style={{ color: data.profitMarginPct >= 0 ? INK.chart.green : INK.chart.red }}>
                    {pct(data.profitMarginPct)}
                  </Text>
                </Group>
                <ProgressBar pct={Math.min(100, Math.max(0, data.profitMarginPct))} color={data.profitMarginPct >= 0 ? INK.chart.green : INK.chart.red} />
              </Box>
            </Stack>
          </Card>
        </motion.div>
      </SimpleGrid>

      {data.grossProfit < 0 && (
        <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
          <Card withBorder padding="lg" style={{ borderColor: INK.chart.red, background: `${INK.chart.red}08` }}>
            <Text fw={700} style={{ color: INK.chart.red }}>⚠ You are selling products below cost.</Text>
            <Text size="sm" c="dimmed" mt={4}>
              The cost of goods ({p(data.totalCost)}) exceeds your revenue ({p(data.totalRevenue)}).
              Review your sell prices.
            </Text>
          </Card>
        </motion.div>
      )}
    </Stack>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
  valueColor,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  valueColor?: string;
}) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm" fw={bold ? 700 : 500} c={muted ? "dimmed" : undefined}>
        {label}
      </Text>
      <Text size="sm" fw={bold ? 800 : 600} className="tabular" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </Text>
    </Group>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <Box mt="sm" style={{ height: 8, borderRadius: 999, background: "#E3E8F1", overflow: "hidden" }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        style={{ height: "100%", borderRadius: 999, background: color }}
      />
    </Box>
  );
}

// ==========================================
// CUSTOMER LEDGER
// ==========================================

function CustomerLedgerReport() {
  const [data, setData] = useState<CustomerLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reportCustomerLedger()
      .then(setData)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  const totalInvoiced = data.reduce((s, d) => s + d.totalInvoiced, 0);
  const totalPaid = data.reduce((s, d) => s + d.totalPaid, 0);
  const totalBalance = data.reduce((s, d) => s + d.balanceDue, 0);

  const donutData =
    totalInvoiced <= 0
      ? []
      : [
          { name: "Collected", value: totalPaid, color: INK.chart.green },
          {
            name: "Outstanding",
            value: Math.max(totalBalance, 0),
            color: INK.chart.orange,
          },
        ].filter((d) => d.value > 0);

  const collectionRate = totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 100) : 0;

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <StatCard label="Total Invoiced" value={totalInvoiced / 100} decimals={2} tint={INK.chart.navy} />
        <StatCard label="Total Collected" value={totalPaid / 100} decimals={2} tint={INK.chart.green} footer={`${collectionRate}% collection rate`} />
        <StatCard label="Total Outstanding" value={totalBalance / 100} decimals={2} tint={totalBalance > 0 ? INK.chart.orange : INK.chart.green} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 3 }}>
        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }} style={{ gridColumn: "1 / 2" }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Text fw={700} style={{ color: INK.navy }} mb="md">Receivables Health</Text>
            {donutData.length === 0 ? (
              <EmptyChart message="No customer activity yet." />
            ) : (
              <>
                <Box h={210} pos="relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={4} cornerRadius={6} animationDuration={900}>
                        {donutData.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [fmtMoney(value), ""]} contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <Box style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                    <Text fw={800} size="xl" className="tabular" style={{ color: INK.navy }}>{collectionRate}%</Text>
                  </Box>
                </Box>
                <Stack gap={6}>
                  {donutData.map((d) => (
                    <Group key={d.name} justify="space-between">
                      <Group gap={6}>
                        <Box w={8} h={8} style={{ borderRadius: 4, background: d.color }} />
                        <Text size="xs">{d.name}</Text>
                      </Group>
                      <Text size="xs" fw={700} className="tabular">{p(d.value)}</Text>
                    </Group>
                  ))}
                </Stack>
              </>
            )}
          </Card>
        </motion.div>

        <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.16 }} style={{ gridColumn: "2 / 4" }}>
          <Card withBorder shadow="sm" p="lg" style={{ height: "100%" }}>
            <Group justify="space-between" mb="md">
              <Text fw={700} style={{ color: INK.navy }}>Customer Balances</Text>
              <Group>
                <ExportButtons kind="ledger" align="flex-end" />
                <Badge color="gold" variant="light">{data.length} customers</Badge>
              </Group>
            </Group>
            {data.length === 0 ? (
              <Box style={{ height: 210, display: "grid", placeItems: "center" }}>
                <Text c="dimmed" size="sm">No customer data yet.</Text>
              </Box>
            ) : (
              <ScrollArea style={{ maxHeight: 420 }}>
                <Table highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Customer</Table.Th>
                      <Table.Th ta="right">Invoices</Table.Th>
                      <Table.Th ta="right">Invoiced</Table.Th>
                      <Table.Th ta="right">Paid</Table.Th>
                      <Table.Th ta="right">Balance Due</Table.Th>
                      <Table.Th>Last Payment</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.map((entry, i) => (
                      <motion.tr key={entry.customerId} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.02 * i, duration: 0.25 }}>
                        <Table.Td>
                          <Text size="sm" fw={600} style={{ color: INK.navy }}>{entry.customerName}</Text>
                          <Text size="xs" c="dimmed">Last invoice {entry.lastInvoiceDate ?? "—"}</Text>
                        </Table.Td>
                        <Table.Td ta="right" className="tabular">{entry.invoiceCount}</Table.Td>
                        <Table.Td ta="right" className="tabular">{p(entry.totalInvoiced)}</Table.Td>
                        <Table.Td ta="right" className="tabular" style={{ color: INK.chart.green }}>{p(entry.totalPaid)}</Table.Td>
                        <Table.Td ta="right">
                          <Text size="sm" fw={700} className="tabular" c={entry.balanceDue > 0 ? "orange" : "green"}>
                            {p(entry.balanceDue)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">{entry.lastPaymentDate ?? "—"}</Text>
                        </Table.Td>
                      </motion.tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Card>
        </motion.div>
      </SimpleGrid>
    </Stack>
  );
}

// ==========================================
// STOCK MOVEMENTS REPORT
// ==========================================

function StockMovementsReport() {
  const [data, setData] = useState<ProductMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reportProductMovements()
      .then(setData)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;

  const totals = data.reduce(
    (acc, d) => ({
      purchased: acc.purchased + d.totalPurchased,
      sold: acc.sold + d.totalSold,
      returned: acc.returned + d.totalReturned,
      damaged: acc.damaged + d.totalDamaged,
      adjusted: acc.adjusted + Math.abs(d.totalAdjusted),
    }),
    { purchased: 0, sold: 0, returned: 0, damaged: 0, adjusted: 0 },
  );

  const chartData = data.slice(0, 10).map((item) => ({
    name: item.productName.length > 16 ? `${item.productName.slice(0, 15)}…` : item.productName,
    Purchased: item.totalPurchased,
    Sold: item.totalSold,
  }));

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, lg: 5 }}>
        <StatCard label="Purchased" value={totals.purchased} tint={INK.chart.green} suffix=" u" />
        <StatCard label="Sold" value={totals.sold} tint={INK.chart.blue} suffix=" u" />
        <StatCard label="Returned" value={totals.returned} tint={INK.chart.teal} suffix=" u" />
        <StatCard label="Damaged" value={totals.damaged} tint={INK.chart.red} suffix=" u" />
        <StatCard label="Adjusted" value={totals.adjusted} tint={INK.chart.orange} suffix=" u" />
      </SimpleGrid>

      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }}>
        <Card withBorder shadow="sm" p="lg">
          <Text fw={700} style={{ color: INK.navy }} mb="md">Purchased vs Sold — Top 10</Text>
          {chartData.length === 0 ? (
            <EmptyChart message="Record stock movements to see comparisons." />
          ) : (
            <Box h={300}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#E7ECF5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5C6B84" }} tickLine={false} axisLine={false} interval={0} angle={-20} height={60} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11, fill: "#5C6B84" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(29,43,84,0.04)" }} />
                  <Bar dataKey="Purchased" fill={INK.chart.green} radius={[6, 6, 0, 0]} animationDuration={900} />
                  <Bar dataKey="Sold" fill={INK.chart.blue} radius={[6, 6, 0, 0]} animationDuration={900} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Card>
      </motion.div>

      <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.16 }}>
        <Card withBorder shadow="sm" p="lg">
          <Group justify="space-between" mb="md">
            <Text fw={700} style={{ color: INK.navy }}>Movement Register</Text>
            <Badge color="gold" variant="light">{data.length} products</Badge>
          </Group>
          {data.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">No stock movement data yet.</Text>
          ) : (
            <ScrollArea>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>SKU</Table.Th>
                    <Table.Th>Product</Table.Th>
                    <Table.Th ta="right">Purchased</Table.Th>
                    <Table.Th ta="right">Sold</Table.Th>
                    <Table.Th ta="right">Returned</Table.Th>
                    <Table.Th ta="right">Damaged</Table.Th>
                    <Table.Th ta="right">Adjusted</Table.Th>
                    <Table.Th ta="right">Current</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.map((item, i) => (
                    <motion.tr key={item.productId} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.02 * i, duration: 0.25 }}>
                      <Table.Td>
                        <Badge variant="outline" size="sm" color="gray">{item.productSku}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={600} style={{ color: INK.navy }}>{item.productName}</Text>
                      </Table.Td>
                      <Table.Td ta="right" className="tabular" style={{ color: INK.chart.green }}>+{item.totalPurchased}</Table.Td>
                      <Table.Td ta="right" className="tabular" style={{ color: INK.chart.blue }}>−{item.totalSold}</Table.Td>
                      <Table.Td ta="right" className="tabular" style={{ color: INK.chart.teal }}>+{item.totalReturned}</Table.Td>
                      <Table.Td ta="right" className="tabular" style={{ color: INK.chart.red }}>−{item.totalDamaged}</Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {item.totalAdjusted !== 0 ? (item.totalAdjusted > 0 ? "+" : "") + item.totalAdjusted : "—"}
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={700} className="tabular">{item.currentStock}</Text>
                      </Table.Td>
                    </motion.tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Card>
      </motion.div>
    </Stack>
  );
}
