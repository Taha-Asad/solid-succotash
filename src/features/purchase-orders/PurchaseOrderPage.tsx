// ==========================================
// PURCHASE ORDER PAGE
// ==========================================
//
// Buy from suppliers:
//   1. Create PO → select supplier
//   2. Add items → select products, quantity, cost
//   3. Submit → marks as ordered
//   4. Receive → stock goes UP, batches created if expiry
//   5. Record payment → pay the supplier

import { useCallback, useEffect, useState } from "react";

import { motion } from "framer-motion";

import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  ScrollArea,
} from "@mantine/core";

import { useForm } from "@mantine/form";

import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  addPOItem,
  removePOItem,
  submitPurchaseOrder,
  receivePOItems,
  recordPOPayment,
  listSuppliers,
  listProducts,
  getErrorMessage,
} from "../../api/backend";

import type {
  PublicPurchaseOrder,
  PublicProduct,
  PublicSupplier,
  PublicUser,
  PurchaseOrderWithItems,
} from "../../types/backend";

import AnimatedNumber from "../../components/AnimatedNumber";
import { INK } from "../../theme";
import {
  ArrowLeft,
  Banknote,
  CircleDollarSign,
  PackageCheck,
  Plus,
  Send,
  ShoppingCart,
  Trash2,
} from "lucide-react";

// ==========================================
// HELPERS
// ==========================================

function paisaToDisplay(paisa: number): string {
  return (paisa / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayToPaisa(display: string | number): number {
  const n = typeof display === "number" ? display : parseFloat(display);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

const STATUS_COLORS: Record<string, string> = {
  draft: "yellow",
  ordered: "blue",
  received: "teal",
  paid: "green",
  cancelled: "red",
};

const gradientButton = {
  root: {
    background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
    color: "#131C39",
    fontWeight: 700,
    "&:hover": { filter: "brightness(1.05)" },
  },
};

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

// ==========================================
// MAIN COMPONENT
// ==========================================

interface POPageProps {
  user: PublicUser;
}

export default function PurchaseOrderPage({ user }: POPageProps) {
  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (view === "detail" && selectedId) {
    return (
      <PODetailView
        user={user}
        poId={selectedId}
        onBack={() => {
          setSelectedId(null);
          setView("list");
        }}
      />
    );
  }
  return (
    <POListView
      user={user}
      onOpen={(id) => {
        setSelectedId(id);
        setView("detail");
      }}
    />
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
  delay,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tint: string;
  sub: React.ReactNode;
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
            <Text
              size="xs"
              fw={600}
              style={{ color: "#5C6B84", letterSpacing: 0.4, textTransform: "uppercase" }}
            >
              {label}
            </Text>
            <Text fw={800} size="xl" style={{ color: INK.navy, letterSpacing: -0.5 }} className="tabular">
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
      </Card>
    </motion.div>
  );
}

// ==========================================
// PO LIST VIEW
// ==========================================

function POListView({
  user,
  onOpen,
}: {
  user: PublicUser;
  onOpen: (id: string) => void;
}) {
  const [orders, setOrders] = useState<PublicPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<PublicSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const canManage = user.role === "owner" || user.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([listPurchaseOrders(), listSuppliers()]);
      setOrders(o);
      setSuppliers(s);
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

  async function handleCreate(values: {
    supplierId: string;
    poDate: string;
    expectedDate: string;
    referenceNote: string;
  }) {
    try {
      const po = await createPurchaseOrder(values);
      setCreateOpen(false);
      await load();
      onOpen(po.id);
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  const totalPOs = orders.length;
  const totalValue = orders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.grandTotal, 0);
  const dueToSuppliers = orders
    .filter((o) => o.status === "received")
    .reduce((sum, o) => sum + o.balanceDue, 0);
  const awaitingReceipt = orders.filter((o) => o.status === "ordered").length;
  const draftCount = orders.filter((o) => o.status === "draft").length;

  return (
    <Stack gap="lg">
      {/* ---- HEADER ---- */}
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Stack gap={2}>
          <Text
            size="xs"
            fw={700}
            style={{ color: INK.gold, letterSpacing: 1.4, textTransform: "uppercase" }}
          >
            Procurement
          </Text>
          <Title order={2} style={{ color: INK.navy, letterSpacing: -0.3 }}>
            Purchase Orders
          </Title>
          <Text size="sm" c="dimmed">
            Order stock from suppliers, receive goods and track supplier payments.
          </Text>
        </Stack>
        {canManage && (
          <Button
            leftSection={<Plus size={16} />}
            onClick={() => setCreateOpen(true)}
            styles={gradientButton}
          >
            New PO
          </Button>
        )}
      </Group>

      {/* ---- SUMMARY CARDS ---- */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <StatCard
          delay={0.05}
          icon={<ShoppingCart size={18} />}
          tint={INK.chart.navy}
          label="Total POs"
          value={String(totalPOs)}
          sub={
            <Group gap={6}>
              <Text size="xs" c="dimmed">{draftCount} in draft</Text>
              <Badge size="xs" color="blue" variant="light">{awaitingReceipt} awaiting</Badge>
            </Group>
          }
        />
        <StatCard
          delay={0.1}
          icon={<CircleDollarSign size={18} />}
          tint={INK.chart.gold}
          label="PO Value"
          value={paisaToDisplay(totalValue)}
          sub={<Text size="xs" c="dimmed">total ordered value</Text>}
        />
        <StatCard
          delay={0.15}
          icon={<Banknote size={18} />}
          tint={dueToSuppliers > 0 ? INK.chart.orange : INK.chart.green}
          label="Due to Suppliers"
          value={paisaToDisplay(dueToSuppliers)}
          sub={
            <Text size="xs" c={dueToSuppliers > 0 ? "orange" : "green"}>
              {dueToSuppliers > 0 ? "ready to pay" : "nothing owed"}
            </Text>
          }
        />
        <StatCard
          delay={0.2}
          icon={<PackageCheck size={18} />}
          tint={INK.chart.teal}
          label="Awaiting Receipt"
          value={String(awaitingReceipt)}
          sub={<Text size="xs" c="dimmed">submitted POs to receive</Text>}
        />
      </SimpleGrid>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {loading ? (
        <Text c="dimmed">Loading purchase orders...</Text>
      ) : orders.length === 0 ? (
        <Card withBorder padding="xl" ta="center">
          <Stack align="center" gap="xs" py="lg">
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `${INK.gold}18`,
                color: INK.gold,
              }}
            >
              <ShoppingCart size={22} />
            </div>
            <Text fw={600} style={{ color: INK.navy }}>
              No purchase orders yet
            </Text>
            <Text size="sm" c="dimmed" maw={320}>
              Create your first purchase order to start buying from suppliers.
            </Text>
          </Stack>
        </Card>
      ) : (
        <Card withBorder shadow="sm" padding="lg">
          <ScrollArea>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>PO #</Table.Th>
                  <Table.Th>Supplier</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                  <Table.Th ta="right">Paid</Table.Th>
                  <Table.Th ta="right">Balance</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {orders.map((po) => (
                  <Table.Tr
                    key={po.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => onOpen(po.id)}
                  >
                    <Table.Td>
                      <Text fw={600} size="sm" className="mono" style={{ color: INK.navy }}>
                        {po.poNumber}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{po.supplierName}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{po.poDate}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLORS[po.status] ?? "gray"} variant="light">
                        {po.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" fw={600} className="tabular">
                        {paisaToDisplay(po.grandTotal)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" className="tabular">{paisaToDisplay(po.amountPaid)}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text
                        size="sm"
                        fw={500}
                        className="tabular"
                        c={po.balanceDue > 0 ? "orange" : "green"}
                      >
                        {paisaToDisplay(po.balanceDue)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}

      <CreatePOModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
        suppliers={suppliers}
      />
    </Stack>
  );
}

// ==========================================
// CREATE PO MODAL
// ==========================================

function CreatePOModal({
  opened,
  onClose,
  onCreate,
  suppliers,
}: {
  opened: boolean;
  onClose: () => void;
  onCreate: (v: {
    supplierId: string;
    poDate: string;
    expectedDate: string;
    referenceNote: string;
  }) => Promise<void>;
  suppliers: PublicSupplier[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    initialValues: {
      supplierId: "",
      poDate: new Date().toISOString().split("T")[0],
      expectedDate: "",
      referenceNote: "",
    },
    validate: {
      supplierId: (v) => (v ? null : "Select a supplier"),
    },
  });

  async function submit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    try {
      await onCreate(values);
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="New Purchase Order" centered>
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="md">
          <Select
            label="Supplier"
            placeholder="Select supplier"
            data={suppliers
              .filter((s) => s.isActive)
              .map((s) => ({ value: s.id, label: s.name }))}
            required
            searchable
            {...form.getInputProps("supplierId")}
          />
          <SimpleGrid cols={2}>
            <TextInput
              label="PO Date"
              type="date"
              required
              {...form.getInputProps("poDate")}
            />
            <TextInput
              label="Expected Date"
              type="date"
              {...form.getInputProps("expectedDate")}
            />
          </SimpleGrid>
          <TextInput
            label="Reference / Note"
            placeholder="Supplier quote, etc."
            {...form.getInputProps("referenceNote")}
          />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} styles={gradientButton}>
              Create PO
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ==========================================
// PO DETAIL VIEW
// ==========================================

function PODetailView({
  user,
  poId,
  onBack,
}: {
  user: PublicUser;
  poId: string;
  onBack: () => void;
}) {
  const [details, setDetails] = useState<PurchaseOrderWithItems | null>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const canManage = user.role === "owner" || user.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([getPurchaseOrder(poId), listProducts()]);
      setDetails(d);
      setProducts(p);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddItem(values: {
    productId: string;
    quantity: number;
    unitCost: number;
    taxRate: number;
    expiryDate: string;
  }) {
    try {
      await addPOItem({ poId, ...values });
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  async function handleRemoveItem(itemId: string) {
    try {
      await removePOItem({ poId, itemId });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleSubmit() {
    try {
      await submitPurchaseOrder(poId);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleReceive() {
    try {
      await receivePOItems(poId);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handlePayment(values: {
    amount: number;
    paymentMethod: string;
    paymentDate: string;
    reference: string;
    notes: string;
  }) {
    try {
      await recordPOPayment({ poId, ...values });
      setPayOpen(false);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (loading) return <Text c="dimmed">Loading purchase order...</Text>;
  if (!details) return <Text c="red">Purchase order not found</Text>;

  const { order, items } = details;
  const isDraft = order.status === "draft";
  const isOrdered = order.status === "ordered";
  const isReceived = order.status === "received";
  const canPay =
    canManage && (isReceived || order.status === "paid") && order.balanceDue > 0;

  return (
    <Stack gap="lg">
      {/* ---- HEADER ---- */}
      <Group justify="space-between" wrap="wrap">
        <Group>
          <Button variant="subtle" leftSection={<ArrowLeft size={16} />} onClick={onBack}>
            Back
          </Button>
          <Title order={3} className="mono" style={{ color: INK.navy }}>
            {order.poNumber}
          </Title>
          <Badge
            color={STATUS_COLORS[order.status]}
            variant="light"
            size="lg"
            styles={{ label: { textTransform: "uppercase" } }}
          >
            {order.status}
          </Badge>
        </Group>
        <Group>
          {isDraft && canManage && (
            <Button color="blue" leftSection={<Send size={15} />} onClick={handleSubmit}>
              Submit to Supplier
            </Button>
          )}
          {isOrdered && canManage && (
            <Button color="green" leftSection={<PackageCheck size={15} />} onClick={handleReceive}>
              Receive Items
            </Button>
          )}
          {canPay && (
            <Button leftSection={<Banknote size={15} />} onClick={() => setPayOpen(true)} styles={gradientButton}>
              Pay Supplier
            </Button>
          )}
        </Group>
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {/* ---- SUPPLIER + SUMMARY ---- */}
      <Grid>
        <Grid.Col span={6}>
          <Card withBorder padding="md">
            <Title order={5} mb="xs">
              Supplier
            </Title>
            <Text fw={500}>{order.supplierName}</Text>
            <Text size="sm" c="dimmed">
              Date: {order.poDate}
            </Text>
            {order.expectedDate && (
              <Text size="sm" c="dimmed">
                Expected: {order.expectedDate}
              </Text>
            )}
            {order.referenceNote && (
              <Text size="sm" c="dimmed">
                Ref: {order.referenceNote}
              </Text>
            )}
          </Card>
        </Grid.Col>
        <Grid.Col span={6}>
          <Card withBorder padding="md">
            <Title order={5} mb="xs">
              Summary
            </Title>
            <SimpleGrid cols={2} spacing="xs">
              <Text size="sm">Subtotal:</Text>
              <Text size="sm" fw={500} className="tabular">{paisaToDisplay(order.subtotal)}</Text>
              <Text size="sm">Tax:</Text>
              <Text size="sm" className="tabular">{paisaToDisplay(order.taxTotal)}</Text>
              <Text size="sm" fw={700}>Total:</Text>
              <Text size="sm" fw={700} className="tabular">{paisaToDisplay(order.grandTotal)}</Text>
              <Text size="sm">Paid:</Text>
              <Text size="sm" c="green" className="tabular">{paisaToDisplay(order.amountPaid)}</Text>
              <Text size="sm" fw={500}>Balance:</Text>
              <Text size="sm" fw={500} c={order.balanceDue > 0 ? "orange" : "green"} className="tabular">
                {paisaToDisplay(order.balanceDue)}
              </Text>
            </SimpleGrid>
          </Card>
        </Grid.Col>
      </Grid>

      {/* ---- ITEMS ---- */}
      <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.08 }}>
        <Group justify="space-between" mb="md">
          <Stack gap={2}>
            <Text fw={700} style={{ color: INK.navy }}>
              Items
            </Text>
            <Text size="xs" c="dimmed">
              Products on this purchase order
            </Text>
          </Stack>
          {isDraft && canManage && (
            <Button size="sm" leftSection={<Plus size={15} />} onClick={() => setAddItemOpen(true)} styles={gradientButton}>
              Add Item
            </Button>
          )}
        </Group>

        {items.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            No items added yet.
          </Text>
        ) : (
          <Card withBorder shadow="sm" padding="lg">
            <ScrollArea>
              <Table striped highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>SKU</Table.Th>
                    <Table.Th>Product</Table.Th>
                    <Table.Th ta="right">Ordered</Table.Th>
                    <Table.Th ta="right">Received</Table.Th>
                    <Table.Th ta="right">Cost</Table.Th>
                    <Table.Th ta="right">Tax</Table.Th>
                    <Table.Th ta="right">Total</Table.Th>
                    {isDraft && <Table.Th></Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>
                        <Badge variant="outline" size="sm">
                          {item.productSku}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{item.productName}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">{item.quantityOrdered}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Badge
                          color={item.quantityReceived >= item.quantityOrdered ? "green" : "yellow"}
                          variant="light"
                          size="sm"
                        >
                          {item.quantityReceived}
                        </Badge>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" className="tabular">{paisaToDisplay(item.unitCost)}</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm">{item.taxRate / 100}%</Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" fw={600} className="tabular">
                          {paisaToDisplay(item.lineTotal)}
                        </Text>
                      </Table.Td>
                      {isDraft && (
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={() => handleRemoveItem(item.id)}
                          >
                            <Trash2 size={15} />
                          </ActionIcon>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>
        )}

        {/* Totals */}
        <Card withBorder padding="md" mt="md">
          <Stack gap="xs" align="flex-end">
            <Group w={300}>
              <Text size="sm" style={{ flex: 1 }}>
                Subtotal:
              </Text>
              <Text size="sm" fw={500} className="tabular">
                {paisaToDisplay(order.subtotal)}
              </Text>
            </Group>
            {order.taxTotal > 0 && (
              <Group w={300}>
                <Text size="sm" style={{ flex: 1 }}>
                  Tax:
                </Text>
                <Text size="sm" className="tabular">
                  {paisaToDisplay(order.taxTotal)}
                </Text>
              </Group>
            )}
            <Divider w={300} />
            <Group w={300}>
              <Text fw={700} style={{ flex: 1 }}>
                Grand Total:
              </Text>
              <Text fw={700} size="lg" className="tabular">
                {paisaToDisplay(order.grandTotal)}
              </Text>
            </Group>
          </Stack>
        </Card>
      </motion.div>

      <AddPOItemModal
        opened={addItemOpen}
        onClose={() => setAddItemOpen(false)}
        onAdd={handleAddItem}
        products={products}
      />
      <POPaymentModal
        opened={payOpen}
        onClose={() => setPayOpen(false)}
        onRecord={handlePayment}
        balanceDue={order.balanceDue}
      />
    </Stack>
  );
}

// ==========================================
// ADD ITEM MODAL
// ==========================================

function AddPOItemModal({
  opened,
  onClose,
  onAdd,
  products,
}: {
  opened: boolean;
  onClose: () => void;
  onAdd: (v: {
    productId: string;
    quantity: number;
    unitCost: number;
    taxRate: number;
    expiryDate: string;
  }) => Promise<void>;
  products: PublicProduct[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    initialValues: {
      productId: "",
      quantity: 1,
      unitCost: 0,
      taxRate: 0,
      expiryDate: "",
    },
    validate: {
      productId: (v) => (v ? null : "Select a product"),
      quantity: (v) => (v > 0 ? null : "Must be > 0"),
    },
  });

  function handleProductChange(id: string) {
    form.setFieldValue("productId", id);
    const prod = products.find((p) => p.id === id);
    if (prod) form.setFieldValue("unitCost", parseFloat(paisaToDisplay(prod.costPrice)));
  }

  async function submit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    try {
      await onAdd({
        ...values,
        unitCost: displayToPaisa(values.unitCost),
        taxRate: Math.round(values.taxRate * 100),
      });
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Add Item" centered>
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="md">
          <Select
            label="Product"
            placeholder="Select product"
            data={products
              .filter((p) => p.isActive)
              .map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
            required
            searchable
            value={form.values.productId}
            onChange={(v) => v && handleProductChange(v)}
          />
          <SimpleGrid cols={2}>
            <NumberInput
              label="Quantity"
              min={1}
              required
              {...form.getInputProps("quantity")}
            />
            <NumberInput
              label="Unit Cost"
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...form.getInputProps("unitCost")}
            />
          </SimpleGrid>
          <SimpleGrid cols={2}>
            <NumberInput
              label="Tax %"
              decimalScale={2}
              fixedDecimalScale
              suffix="%"
              min={0}
              max={100}
              {...form.getInputProps("taxRate")}
            />
            <TextInput
              label="Expiry Date (optional)"
              placeholder="YYYY-MM-DD"
              {...form.getInputProps("expiryDate")}
            />
          </SimpleGrid>
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} styles={gradientButton}>
              Add Item
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ==========================================
// PAYMENT MODAL
// ==========================================

function POPaymentModal({
  opened,
  onClose,
  onRecord,
  balanceDue,
}: {
  opened: boolean;
  onClose: () => void;
  onRecord: (v: {
    amount: number;
    paymentMethod: string;
    paymentDate: string;
    reference: string;
    notes: string;
  }) => Promise<void>;
  balanceDue: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    initialValues: {
      amount: parseFloat(paisaToDisplay(balanceDue)),
      paymentMethod: "cash",
      paymentDate: new Date().toISOString().split("T")[0],
      reference: "",
      notes: "",
    },
  });

  useEffect(() => {
    form.setFieldValue("amount", parseFloat(paisaToDisplay(balanceDue)));
  }, [balanceDue]);

  async function submit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    try {
      await onRecord({
        ...values,
        amount: displayToPaisa(values.amount),
      });
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Pay Supplier" centered>
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Balance due:{" "}
            <Text span fw={700} className="tabular">
              {paisaToDisplay(balanceDue)}
            </Text>
          </Text>
          <NumberInput
            label="Amount"
            decimalScale={2}
            fixedDecimalScale
            min={0}
            required
            {...form.getInputProps("amount")}
          />
          <SimpleGrid cols={2}>
            <Select
              label="Method"
              data={["cash", "bank_transfer", "card", "cheque", "online", "other"].map(
                (v) => ({ value: v, label: v.replace("_", " ") }),
              )}
              {...form.getInputProps("paymentMethod")}
            />
            <TextInput
              label="Date"
              type="date"
              {...form.getInputProps("paymentDate")}
            />
          </SimpleGrid>
          <TextInput
            label="Reference"
            placeholder="Cheque #, etc."
            {...form.getInputProps("reference")}
          />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} color="green">
              Record Payment
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
