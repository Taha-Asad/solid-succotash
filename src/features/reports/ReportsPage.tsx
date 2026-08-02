// ==========================================
// REPORTS & ANALYTICS PAGE
// ==========================================
//
// Five report tabs:
//   1. Sales — revenue, top products, top customers
//   2. Stock — inventory levels, low stock alerts
//   3. Profit/Loss — margins, costs vs revenue
//   4. Customer Ledger — who owes what
//   5. Stock Movements — product in/out history
//
// All data is read-only — reports just display what exists.

import { useCallback, useEffect, useState } from "react";

import {
  Badge,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  ScrollArea,
  NumberInput,
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
  getErrorMessage,
} from "../../api/backend";

import type {
  PublicUser,
  SalesSummary,
  SalesByPeriod,
  TopProduct,
  TopCustomer,
  StockSummary,
  ProfitLossSummary,
  CustomerLedgerEntry,
  ProductMovement,
} from "../../types/backend";

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

// ==========================================
// PROPS & MAIN COMPONENT
// ==========================================

interface ReportsPageProps {
  user: PublicUser;
}

export default function ReportsPage({ user }: ReportsPageProps) {
  return (
    <Stack>
      <Title order={3}>Reports & Analytics</Title>
      <Tabs defaultValue="sales">
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

  if (loading) return <Text c="dimmed">Loading sales report...</Text>;
  if (error) return <Text c="red">{error}</Text>;
  if (!summary) return null;

  return (
    <Stack>
      {/* Summary cards */}
      <SimpleGrid cols={4}>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Revenue
          </Text>
          <Title order={3}>{p(summary.totalRevenue)}</Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Paid
          </Text>
          <Title order={3} c="green">
            {p(summary.totalPaid)}
          </Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Outstanding
          </Text>
          <Title
            order={3}
            c={summary.totalOutstanding > 0 ? "orange" : "green"}
          >
            {p(summary.totalOutstanding)}
          </Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Invoices
          </Text>
          <Title order={3}>{summary.totalInvoices}</Title>
          <Group gap="xs" mt={4}>
            <Badge size="xs" color="green">
              {summary.paidCount} paid
            </Badge>
            <Badge size="xs" color="blue">
              {summary.finalizedCount} pending
            </Badge>
            <Badge size="xs" color="yellow">
              {summary.draftCount} draft
            </Badge>
          </Group>
        </Card>
      </SimpleGrid>

      {/* Sales by month */}
      <Title order={5}>Monthly Sales</Title>
      {byMonth.length === 0 ? (
        <Text c="dimmed">No sales data yet.</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Month</Table.Th>
              <Table.Th>Invoices</Table.Th>
              <Table.Th>Revenue</Table.Th>
              <Table.Th>Tax</Table.Th>
              <Table.Th>Collected</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {byMonth.map((row) => (
              <Table.Tr key={row.period}>
                <Table.Td>
                  <Text fw={500}>{row.period}</Text>
                </Table.Td>
                <Table.Td>{row.invoiceCount}</Table.Td>
                <Table.Td>{p(row.revenue)}</Table.Td>
                <Table.Td>{p(row.tax)}</Table.Td>
                <Table.Td>{p(row.paid)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Grid>
        {/* Top products */}
        <Grid.Col span={6}>
          <Title order={5} mb="xs">
            Top Products
          </Title>
          {topProducts.length === 0 ? (
            <Text c="dimmed">No data yet.</Text>
          ) : (
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Product</Table.Th>
                  <Table.Th>Qty Sold</Table.Th>
                  <Table.Th>Revenue</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {topProducts.slice(0, 10).map((prod) => (
                  <Table.Tr key={prod.productId}>
                    <Table.Td>
                      <Text size="sm">{prod.productName}</Text>
                      <Text size="xs" c="dimmed">
                        {prod.productSku}
                      </Text>
                    </Table.Td>
                    <Table.Td>{prod.totalQuantitySold}</Table.Td>
                    <Table.Td fw={500}>{p(prod.totalRevenue)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Grid.Col>

        {/* Top customers */}
        <Grid.Col span={6}>
          <Title order={5} mb="xs">
            Top Customers
          </Title>
          {topCustomers.length === 0 ? (
            <Text c="dimmed">No data yet.</Text>
          ) : (
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Customer</Table.Th>
                  <Table.Th>Revenue</Table.Th>
                  <Table.Th>Balance</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {topCustomers.slice(0, 10).map((cust) => (
                  <Table.Tr key={cust.customerId}>
                    <Table.Td>
                      <Text size="sm">{cust.customerName}</Text>
                      <Text size="xs" c="dimmed">
                        {cust.totalInvoices} invoices
                      </Text>
                    </Table.Td>
                    <Table.Td fw={500}>{p(cust.totalRevenue)}</Table.Td>
                    <Table.Td c={cust.balanceDue > 0 ? "orange" : "green"}>
                      {p(cust.balanceDue)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Grid.Col>
      </Grid>
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

  if (loading) return <Text c="dimmed">Loading stock report...</Text>;
  if (error) return <Text c="red">{error}</Text>;
  if (!data) return null;

  return (
    <Stack>
      <SimpleGrid cols={4}>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Products
          </Text>
          <Title order={3}>{data.totalProducts}</Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Stock Units
          </Text>
          <Title order={3}>{data.totalStockUnits.toLocaleString()}</Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Value at Cost
          </Text>
          <Title order={3}>{p(data.totalValueAtCost)}</Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Value at Sell Price
          </Text>
          <Title order={3} c="green">
            {p(data.totalValueAtSell)}
          </Title>
        </Card>
      </SimpleGrid>

      <Group>
        <Badge color="red" variant="light">
          {data.outOfStockCount} out of stock
        </Badge>
        <Badge color="orange" variant="light">
          {data.lowStockCount} low stock (≤ {threshold})
        </Badge>
        <NumberInput
          size="xs"
          label="Low stock threshold"
          value={threshold}
          onChange={(v) => setThreshold(typeof v === "number" ? v : 10)}
          min={1}
          w={150}
        />
      </Group>

      <ScrollArea>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>SKU</Table.Th>
              <Table.Th>Product</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Stock</Table.Th>
              <Table.Th>Cost</Table.Th>
              <Table.Th>Sell</Table.Th>
              <Table.Th>Value (Cost)</Table.Th>
              <Table.Th>Value (Sell)</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.items.map((item) => (
              <Table.Tr
                key={item.productId}
                style={item.isLowStock ? { background: "#fff3cd" } : undefined}
              >
                <Table.Td>
                  <Badge variant="outline" size="sm">
                    {item.productSku}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{item.productName}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {item.categoryName ?? "—"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text fw={500}>{item.quantityInStock}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p(item.costPrice)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p(item.sellPrice)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{p(item.stockValueAtCost)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {p(item.stockValueAtSell)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {item.quantityInStock <= 0 ? (
                    <Badge color="red" variant="light">
                      Out of stock
                    </Badge>
                  ) : item.isLowStock ? (
                    <Badge color="orange" variant="light">
                      Low
                    </Badge>
                  ) : (
                    <Badge color="green" variant="light">
                      OK
                    </Badge>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}

// ==========================================
// PROFIT/LOSS REPORT
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

  if (loading) return <Text c="dimmed">Loading profit/loss report...</Text>;
  if (error) return <Text c="red">{error}</Text>;
  if (!data) return null;

  return (
    <Stack>
      <SimpleGrid cols={3}>
        <Card withBorder padding="lg">
          <Text size="xs" c="dimmed">
            Total Revenue
          </Text>
          <Title order={2}>{p(data.totalRevenue)}</Title>
        </Card>
        <Card withBorder padding="lg">
          <Text size="xs" c="dimmed">
            Total Cost
          </Text>
          <Title order={2}>{p(data.totalCost)}</Title>
        </Card>
        <Card
          withBorder
          padding="lg"
          style={{ borderColor: data.grossProfit >= 0 ? "#40c057" : "#fa5252" }}
        >
          <Text size="xs" c="dimmed">
            Gross Profit
          </Text>
          <Title order={2} c={data.grossProfit >= 0 ? "green" : "red"}>
            {p(data.grossProfit)}
          </Title>
          <Text size="sm" c="dimmed">
            Margin: {pct(data.profitMarginPct)}
          </Text>
        </Card>
      </SimpleGrid>

      <Card withBorder padding="md">
        <Title order={5} mb="md">
          Breakdown
        </Title>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text>Revenue (from sales)</Text>
            <Text fw={500}>{p(data.totalRevenue)}</Text>
          </Group>
          <Group justify="space-between">
            <Text c="red">− Cost of goods sold</Text>
            <Text c="red">−{p(data.totalCost)}</Text>
          </Group>
          <Divider />
          <Group justify="space-between">
            <Text fw={700}>= Gross Profit</Text>
            <Text fw={700} c={data.grossProfit >= 0 ? "green" : "red"}>
              {p(data.grossProfit)}
            </Text>
          </Group>
          <Divider />
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Tax collected from customers
            </Text>
            <Text size="sm">{p(data.totalTaxCollected)}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Discounts given to customers
            </Text>
            <Text size="sm">{p(data.totalDiscountsGiven)}</Text>
          </Group>
        </Stack>
      </Card>

      {data.grossProfit < 0 && (
        <Card withBorder padding="md" style={{ borderColor: "#fa5252" }}>
          <Text c="red" fw={500}>
            ⚠ You are selling products below cost.
          </Text>
          <Text size="sm" c="dimmed">
            Check your sell prices. The cost of goods ({p(data.totalCost)})
            exceeds your revenue ({p(data.totalRevenue)}).
          </Text>
        </Card>
      )}
    </Stack>
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

  if (loading) return <Text c="dimmed">Loading customer ledger...</Text>;
  if (error) return <Text c="red">{error}</Text>;

  const totalInvoiced = data.reduce((s, d) => s + d.totalInvoiced, 0);
  const totalPaid = data.reduce((s, d) => s + d.totalPaid, 0);
  const totalBalance = data.reduce((s, d) => s + d.balanceDue, 0);

  return (
    <Stack>
      <SimpleGrid cols={3}>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Invoiced
          </Text>
          <Title order={3}>{p(totalInvoiced)}</Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Collected
          </Text>
          <Title order={3} c="green">
            {p(totalPaid)}
          </Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Outstanding
          </Text>
          <Title order={3} c={totalBalance > 0 ? "orange" : "green"}>
            {p(totalBalance)}
          </Title>
        </Card>
      </SimpleGrid>

      {data.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No customer data yet.
        </Text>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Customer</Table.Th>
                <Table.Th>Invoices</Table.Th>
                <Table.Th>Invoiced</Table.Th>
                <Table.Th>Paid</Table.Th>
                <Table.Th>Balance Due</Table.Th>
                <Table.Th>Last Invoice</Table.Th>
                <Table.Th>Last Payment</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((entry) => (
                <Table.Tr key={entry.customerId}>
                  <Table.Td>
                    <Text fw={500}>{entry.customerName}</Text>
                  </Table.Td>
                  <Table.Td>{entry.invoiceCount}</Table.Td>
                  <Table.Td>{p(entry.totalInvoiced)}</Table.Td>
                  <Table.Td c="green">{p(entry.totalPaid)}</Table.Td>
                  <Table.Td>
                    <Text
                      fw={500}
                      c={entry.balanceDue > 0 ? "orange" : "green"}
                    >
                      {p(entry.balanceDue)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.lastInvoiceDate ?? "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.lastPaymentDate ?? "—"}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
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

  if (loading) return <Text c="dimmed">Loading stock movements...</Text>;
  if (error) return <Text c="red">{error}</Text>;

  return (
    <Stack>
      {data.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No stock movement data yet.
        </Text>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>SKU</Table.Th>
                <Table.Th>Product</Table.Th>
                <Table.Th>Purchased</Table.Th>
                <Table.Th>Sold</Table.Th>
                <Table.Th>Returned</Table.Th>
                <Table.Th>Damaged</Table.Th>
                <Table.Th>Adjusted</Table.Th>
                <Table.Th>Current Stock</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((item) => (
                <Table.Tr key={item.productId}>
                  <Table.Td>
                    <Badge variant="outline" size="sm">
                      {item.productSku}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{item.productName}</Text>
                  </Table.Td>
                  <Table.Td c="green">+{item.totalPurchased}</Table.Td>
                  <Table.Td c="orange">−{item.totalSold}</Table.Td>
                  <Table.Td c="teal">+{item.totalReturned}</Table.Td>
                  <Table.Td c="red">−{item.totalDamaged}</Table.Td>
                  <Table.Td>
                    {item.totalAdjusted !== 0
                      ? (item.totalAdjusted > 0 ? "+" : "") + item.totalAdjusted
                      : "—"}
                  </Table.Td>
                  <Table.Td>
                    <Text fw={500}>{item.currentStock}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}
