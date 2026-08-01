// ==========================================
// INVOICE PAGE
// ==========================================
//
// Full invoice management:
//   - List invoices with status badges
//   - Create new invoices
//   - Add/remove line items
//   - Finalize (lock + deduct stock)
//   - Record payments
//   - View invoice details

import { useCallback, useEffect, useState } from "react";

import {
  ActionIcon,
  Badge,
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
  Textarea,
  Title,
  ScrollArea,
  Alert,
} from "@mantine/core";

import { useForm } from "@mantine/form";

import {
  listCustomers,
  createCustomer,
  listInvoices,
  getInvoice,
  createInvoice,
  addInvoiceItem,
  removeInvoiceItem,
  finalizeInvoice,
  recordPayment,
  listProducts,
  generateInvoiceHtml,
  getErrorMessage,
} from "../../api/backend";

import type {
  PublicCustomer,
  PublicInvoice,
  PublicProduct,
  PublicUser,
  InvoiceWithDetails,
} from "../../types/backend";

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
  const num = typeof display === "number" ? display : parseFloat(display);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

const STATUS_COLORS: Record<string, string> = {
  draft: "yellow",
  finalized: "blue",
  paid: "green",
  cancelled: "red",
};

// ==========================================
// PROPS
// ==========================================

interface InvoicePageProps {
  user: PublicUser;
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function InvoicePage({ user }: InvoicePageProps) {
  const [view, setView] = useState<"list" | "detail">("list");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    null,
  );

  function openInvoice(invoiceId: string) {
    setSelectedInvoiceId(invoiceId);
    setView("detail");
  }

  function backToList() {
    setSelectedInvoiceId(null);
    setView("list");
  }

  if (view === "detail" && selectedInvoiceId) {
    return (
      <InvoiceDetailView
        user={user}
        invoiceId={selectedInvoiceId}
        onBack={backToList}
      />
    );
  }

  return <InvoiceListView user={user} onOpenInvoice={openInvoice} />;
}

// ==========================================
// INVOICE LIST VIEW
// ==========================================

function InvoiceListView({
  user,
  onOpenInvoice,
}: {
  user: PublicUser;
  onOpenInvoice: (id: string) => void;
}) {
  const [invoices, setInvoices] = useState<PublicInvoice[]>([]);
  const [customers, setCustomers] = useState<PublicCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const canManage = user.role === "owner" || user.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, cust] = await Promise.all([listInvoices(), listCustomers()]);
      setInvoices(inv);
      setCustomers(cust);
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

  const customerMap = new Map(customers.map((c) => [c.id, c.name]));

  // Summary stats
  const totalInvoices = invoices.length;
  const totalRevenue = invoices
    .filter((i) => i.status !== "cancelled")
    .reduce((sum, i) => sum + i.grandTotal, 0);
  const totalOutstanding = invoices
    .filter((i) => i.status === "finalized")
    .reduce((sum, i) => sum + i.balanceDue, 0);

  async function handleCreateInvoice(values: {
    customerId: string;
    invoiceDate: string;
    dueDate: string;
    poNumber: string;
    referenceNote: string;
  }) {
    try {
      const invoice = await createInvoice(values);
      setCreateModalOpen(false);
      await load();
      onOpenInvoice(invoice.id);
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Invoices</Title>
        {canManage && (
          <Button onClick={() => setCreateModalOpen(true)}>
            + New Invoice
          </Button>
        )}
      </Group>

      {/* Summary cards */}
      <SimpleGrid cols={3}>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Invoices
          </Text>
          <Title order={3}>{totalInvoices}</Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Total Revenue
          </Text>
          <Title order={3}>{paisaToDisplay(totalRevenue)}</Title>
        </Card>
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed">
            Outstanding
          </Text>
          <Title order={3} c={totalOutstanding > 0 ? "orange" : "green"}>
            {paisaToDisplay(totalOutstanding)}
          </Title>
        </Card>
      </SimpleGrid>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {loading ? (
        <Text c="dimmed">Loading invoices...</Text>
      ) : invoices.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No invoices yet. Create your first invoice.
        </Text>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Invoice #</Table.Th>
                <Table.Th>Customer</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Total</Table.Th>
                <Table.Th>Paid</Table.Th>
                <Table.Th>Balance</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {invoices.map((inv) => (
                <Table.Tr
                  key={inv.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => onOpenInvoice(inv.id)}
                >
                  <Table.Td>
                    <Text fw={500} size="sm">
                      {inv.invoiceNumber}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {customerMap.get(inv.customerId) ?? "Unknown"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{inv.invoiceDate}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={STATUS_COLORS[inv.status] ?? "gray"}
                      variant="light"
                    >
                      {inv.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {paisaToDisplay(inv.grandTotal)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{paisaToDisplay(inv.amountPaid)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="sm"
                      fw={500}
                      c={inv.balanceDue > 0 ? "orange" : "green"}
                    >
                      {paisaToDisplay(inv.balanceDue)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}

      <CreateInvoiceModal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateInvoice}
        customers={customers}
        user={user}
        onCustomerCreated={load}
      />
    </Stack>
  );
}

// ==========================================
// CREATE INVOICE MODAL
// ==========================================

function CreateInvoiceModal({
  opened,
  onClose,
  onCreate,
  customers,
  user: _user,
  onCustomerCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreate: (values: {
    customerId: string;
    invoiceDate: string;
    dueDate: string;
    poNumber: string;
    referenceNote: string;
  }) => Promise<void>;
  customers: PublicCustomer[];
  user: PublicUser;
  onCustomerCreated: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);

  const form = useForm({
    initialValues: {
      customerId: "",
      invoiceDate: new Date().toISOString().split("T")[0],
      dueDate: "",
      poNumber: "",
      referenceNote: "",
    },
    validate: {
      customerId: (v) => (v ? null : "Select a customer"),
    },
  });

  const newCustomerForm = useForm({
    initialValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
      cnic: "",
      ntn: "",
      strn: "",
      buyerType: "unregistered",
    },
    validate: {
      name: (v) => (v.trim().length < 1 ? "Name is required" : null),
    },
  });

  async function handleSubmit(values: typeof form.values) {
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

  async function handleCreateCustomer(values: typeof newCustomerForm.values) {
    try {
      const customer = await createCustomer(values);
      await onCustomerCreated();
      form.setFieldValue("customerId", customer.id);
      setShowNewCustomer(false);
      newCustomerForm.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const customerOptions = customers
    .filter((c) => c.isActive)
    .map((c) => ({ value: c.id, label: c.name }));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="New Invoice"
      size="lg"
      centered
    >
      {!showNewCustomer ? (
        <form onSubmit={form.onSubmit(handleSubmit)}>
          <Stack gap="md">
            <Group justify="space-between">
              <Select
                label="Customer"
                placeholder="Select customer"
                data={customerOptions}
                required
                searchable
                style={{ flex: 1 }}
                {...form.getInputProps("customerId")}
              />
              <Button
                variant="subtle"
                size="sm"
                mt={24}
                onClick={() => setShowNewCustomer(true)}
              >
                + New Customer
              </Button>
            </Group>

            <SimpleGrid cols={2}>
              <TextInput
                label="Invoice Date"
                type="date"
                required
                {...form.getInputProps("invoiceDate")}
              />
              <TextInput
                label="Due Date"
                type="date"
                {...form.getInputProps("dueDate")}
              />
            </SimpleGrid>

            <SimpleGrid cols={2}>
              <TextInput
                label="PO Number"
                placeholder="Customer's PO reference"
                {...form.getInputProps("poNumber")}
              />
              <TextInput
                label="Reference / Note"
                placeholder="Any notes"
                {...form.getInputProps("referenceNote")}
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
              <Button type="submit" loading={loading}>
                Create Invoice
              </Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <Stack gap="md">
          <Title order={5}>New Customer</Title>
          <TextInput
            label="Name"
            placeholder="Customer name"
            required
            {...newCustomerForm.getInputProps("name")}
          />
          <SimpleGrid cols={2}>
            <TextInput
              label="Phone"
              {...newCustomerForm.getInputProps("phone")}
            />
            <TextInput
              label="Email"
              {...newCustomerForm.getInputProps("email")}
            />
          </SimpleGrid>
          <Textarea
            label="Address"
            rows={2}
            {...newCustomerForm.getInputProps("address")}
          />
          <SimpleGrid cols={3}>
            <TextInput
              label="CNIC"
              placeholder="12345-1234567-1"
              {...newCustomerForm.getInputProps("cnic")}
            />
            <TextInput label="NTN" {...newCustomerForm.getInputProps("ntn")} />
            <TextInput
              label="STRN"
              {...newCustomerForm.getInputProps("strn")}
            />
          </SimpleGrid>
          <Select
            label="Buyer Type"
            data={[
              { value: "unregistered", label: "Unregistered" },
              { value: "registered", label: "Registered" },
            ]}
            {...newCustomerForm.getInputProps("buyerType")}
          />
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setShowNewCustomer(false)}>
              Back
            </Button>
            <Button
              onClick={() => newCustomerForm.onSubmit(handleCreateCustomer)()}
            >
              Create Customer
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ==========================================
// INVOICE DETAIL VIEW
// ==========================================

function InvoiceDetailView({
  user,
  invoiceId,
  onBack,
}: {
  user: PublicUser;
  invoiceId: string;
  onBack: () => void;
}) {
  const [details, setDetails] = useState<InvoiceWithDetails | null>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addItemModalOpen, setAddItemModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const canManage = user.role === "owner" || user.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [det, prods] = await Promise.all([
        getInvoice(invoiceId),
        listProducts(),
      ]);
      setDetails(det);
      setProducts(prods);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddItem(values: {
    productId: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discountRate: number;
  }) {
    try {
      await addInvoiceItem({ invoiceId, ...values });
      await load();
    } catch (err) {
      throw new Error(getErrorMessage(err));
    }
  }

  async function handleRemoveItem(itemId: string) {
    try {
      await removeInvoiceItem({ invoiceId, itemId });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleFinalize() {
    try {
      await finalizeInvoice(invoiceId);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleRecordPayment(values: {
    amount: number;
    paymentMethod: string;
    paymentDate: string;
    reference: string;
    notes: string;
  }) {
    try {
      await recordPayment({ invoiceId, ...values });
      setPaymentModalOpen(false);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handlePrint() {
    try {
      await generateInvoiceHtml(invoiceId);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (loading) {
    return <Text c="dimmed">Loading invoice...</Text>;
  }

  if (!details) {
    return <Text c="red">Invoice not found</Text>;
  }

  const { invoice, customer, items, payments } = details;
  const isDraft = invoice.status === "draft";
  const isFinalized = invoice.status === "finalized";

  return (
    <Stack>
      {/* Header */}
      <Group justify="space-between">
        <Group>
          <Button variant="subtle" onClick={onBack}>
            ← Back
          </Button>
          <Title order={3}>{invoice.invoiceNumber}</Title>
          <Badge
            color={STATUS_COLORS[invoice.status] ?? "gray"}
            variant="light"
            size="lg"
          >
            {invoice.status.toUpperCase()}
          </Badge>
        </Group>
        <Group>
          <Button variant="outline" onClick={handlePrint}>
            🖨️ Print / PDF
          </Button>
          {isDraft && canManage && (
            <Button color="green" onClick={handleFinalize}>
              ✓ Finalize Invoice
            </Button>
          )}
          {isFinalized && canManage && (
            <Button color="blue" onClick={() => setPaymentModalOpen(true)}>
              💰 Record Payment
            </Button>
          )}
        </Group>
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {/* Invoice info */}
      <Grid>
        <Grid.Col span={6}>
          <Card withBorder padding="md">
            <Title order={5} mb="xs">
              Bill To
            </Title>
            <Text fw={500}>{customer.name}</Text>
            {customer.phone && <Text size="sm">Phone: {customer.phone}</Text>}
            {customer.email && <Text size="sm">Email: {customer.email}</Text>}
            {customer.address && <Text size="sm">{customer.address}</Text>}
            {customer.ntn && <Text size="sm">NTN: {customer.ntn}</Text>}
            {customer.cnic && <Text size="sm">CNIC: {customer.cnic}</Text>}
            <Text size="sm" c="dimmed">
              Type: {customer.buyerType}
            </Text>
          </Card>
        </Grid.Col>
        <Grid.Col span={6}>
          <Card withBorder padding="md">
            <Title order={5} mb="xs">
              Invoice Details
            </Title>
            <SimpleGrid cols={2} spacing="xs">
              <Text size="sm" fw={500}>
                Date:
              </Text>
              <Text size="sm">{invoice.invoiceDate}</Text>
              {invoice.dueDate && (
                <>
                  <Text size="sm" fw={500}>
                    Due Date:
                  </Text>
                  <Text size="sm">{invoice.dueDate}</Text>
                </>
              )}
              {invoice.poNumber && (
                <>
                  <Text size="sm" fw={500}>
                    PO Number:
                  </Text>
                  <Text size="sm">{invoice.poNumber}</Text>
                </>
              )}
              <Text size="sm" fw={500}>
                Status:
              </Text>
              <Badge
                color={STATUS_COLORS[invoice.status]}
                variant="light"
                size="sm"
              >
                {invoice.status}
              </Badge>
            </SimpleGrid>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Line items */}
      <Group justify="space-between">
        <Title order={5}>Items</Title>
        {isDraft && canManage && (
          <Button size="sm" onClick={() => setAddItemModalOpen(true)}>
            + Add Item
          </Button>
        )}
      </Group>

      {items.length === 0 ? (
        <Text c="dimmed" ta="center" py="md">
          No items added yet.
        </Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>SKU</Table.Th>
              <Table.Th>Product</Table.Th>
              <Table.Th>Qty</Table.Th>
              <Table.Th>Unit Price</Table.Th>
              <Table.Th>Tax</Table.Th>
              <Table.Th>Discount</Table.Th>
              <Table.Th>Total</Table.Th>
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
                <Table.Td>
                  <Text size="sm">{item.quantity}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{paisaToDisplay(item.unitPrice)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {item.taxRate / 100}% = {paisaToDisplay(item.taxAmount)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {item.discountRate > 0
                      ? `${item.discountRate / 100}% = ${paisaToDisplay(item.discountAmount)}`
                      : "—"}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={500}>
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
                      ✕
                    </ActionIcon>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* Totals */}
      <Card withBorder padding="md">
        <Stack gap="xs" align="flex-end">
          <Group w={300}>
            <Text size="sm" style={{ flex: 1 }}>
              Subtotal:
            </Text>
            <Text size="sm" fw={500}>
              {paisaToDisplay(invoice.subtotal)}
            </Text>
          </Group>
          {invoice.discountTotal > 0 && (
            <Group w={300}>
              <Text size="sm" c="red" style={{ flex: 1 }}>
                Discount:
              </Text>
              <Text size="sm" c="red">
                -{paisaToDisplay(invoice.discountTotal)}
              </Text>
            </Group>
          )}
          {invoice.taxTotal > 0 && (
            <Group w={300}>
              <Text size="sm" style={{ flex: 1 }}>
                Tax:
              </Text>
              <Text size="sm">{paisaToDisplay(invoice.taxTotal)}</Text>
            </Group>
          )}
          <Divider w={300} />
          <Group w={300}>
            <Text fw={700} style={{ flex: 1 }}>
              Grand Total:
            </Text>
            <Text fw={700} size="lg">
              {paisaToDisplay(invoice.grandTotal)}
            </Text>
          </Group>
          <Group w={300}>
            <Text size="sm" style={{ flex: 1 }}>
              Paid:
            </Text>
            <Text size="sm" c="green">
              {paisaToDisplay(invoice.amountPaid)}
            </Text>
          </Group>
          <Group w={300}>
            <Text fw={500} style={{ flex: 1 }}>
              Balance Due:
            </Text>
            <Text
              fw={500}
              size="lg"
              c={invoice.balanceDue > 0 ? "orange" : "green"}
            >
              {paisaToDisplay(invoice.balanceDue)}
            </Text>
          </Group>
        </Stack>
      </Card>

      {/* Payments */}
      {payments.length > 0 && (
        <>
          <Title order={5}>Payments</Title>
          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Method</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Reference</Table.Th>
                <Table.Th>Notes</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {payments.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    <Text size="sm">{p.paymentDate}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" size="sm">
                      {p.paymentMethod}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {paisaToDisplay(p.amount)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{p.reference ?? "—"}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{p.notes ?? "—"}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}

      {/* Add Item Modal */}
      <AddItemModal
        opened={addItemModalOpen}
        onClose={() => setAddItemModalOpen(false)}
        onAdd={handleAddItem}
        products={products}
      />

      {/* Payment Modal */}
      <PaymentModal
        opened={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        onRecord={handleRecordPayment}
        balanceDue={invoice.balanceDue}
      />
    </Stack>
  );
}

// ==========================================
// ADD ITEM MODAL
// ==========================================

function AddItemModal({
  opened,
  onClose,
  onAdd,
  products,
}: {
  opened: boolean;
  onClose: () => void;
  onAdd: (values: {
    productId: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    discountRate: number;
  }) => Promise<void>;
  products: PublicProduct[];
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      productId: "",
      quantity: 1,
      unitPrice: 0,
      taxRate: 0,
      discountRate: 0,
    },
    validate: {
      productId: (v) => (v ? null : "Select a product"),
      quantity: (v) => (v > 0 ? null : "Must be > 0"),
    },
  });

  // Auto-fill price when product changes
  function handleProductChange(productId: string) {
    form.setFieldValue("productId", productId);
    const product = products.find((p) => p.id === productId);
    if (product) {
      form.setFieldValue(
        "unitPrice",
        parseFloat(paisaToDisplay(product.sellPrice)),
      );
      form.setFieldValue("taxRate", product.taxRate / 100);
    }
  }

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    try {
      await onAdd({
        productId: values.productId,
        quantity: values.quantity,
        unitPrice: displayToPaisa(values.unitPrice),
        taxRate: Math.round(values.taxRate * 100),
        discountRate: Math.round(values.discountRate * 100),
      });
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const productOptions = products
    .filter((p) => p.isActive)
    .map((p) => ({
      value: p.id,
      label: `${p.name} (${p.sku}) — Stock: ${p.quantityInStock}`,
    }));

  return (
    <Modal opened={opened} onClose={onClose} title="Add Item" centered>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Select
            label="Product"
            placeholder="Select product"
            data={productOptions}
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
              label="Unit Price"
              decimalScale={2}
              fixedDecimalScale
              min={0}
              {...form.getInputProps("unitPrice")}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <NumberInput
              label="Tax Rate %"
              decimalScale={2}
              fixedDecimalScale
              suffix="%"
              min={0}
              max={100}
              {...form.getInputProps("taxRate")}
            />
            <NumberInput
              label="Discount %"
              decimalScale={2}
              fixedDecimalScale
              suffix="%"
              min={0}
              max={100}
              {...form.getInputProps("discountRate")}
            />
          </SimpleGrid>

          {/* Preview */}
          {form.values.quantity > 0 && form.values.unitPrice > 0 && (
            <Alert color="blue" variant="light">
              <Text size="sm">
                Line total:{" "}
                {paisaToDisplay(
                  displayToPaisa(form.values.unitPrice * form.values.quantity),
                )}{" "}
                PKR (before tax/discount)
              </Text>
            </Alert>
          )}

          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
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

function PaymentModal({
  opened,
  onClose,
  onRecord,
  balanceDue,
}: {
  opened: boolean;
  onClose: () => void;
  onRecord: (values: {
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

  async function handleSubmit(values: typeof form.values) {
    setError(null);
    setLoading(true);
    try {
      await onRecord({
        amount: displayToPaisa(values.amount),
        paymentMethod: values.paymentMethod,
        paymentDate: values.paymentDate,
        reference: values.reference,
        notes: values.notes,
      });
      form.reset();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Record Payment" centered>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Balance due:{" "}
            <Text span fw={700}>
              {paisaToDisplay(balanceDue)} PKR
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
              label="Payment Method"
              data={[
                { value: "cash", label: "Cash" },
                { value: "bank_transfer", label: "Bank Transfer" },
                { value: "card", label: "Card" },
                { value: "cheque", label: "Cheque" },
                { value: "online", label: "Online" },
                { value: "other", label: "Other" },
              ]}
              {...form.getInputProps("paymentMethod")}
            />
            <TextInput
              label="Payment Date"
              type="date"
              {...form.getInputProps("paymentDate")}
            />
          </SimpleGrid>

          <TextInput
            label="Reference"
            placeholder="Cheque #, Transaction ID, etc."
            {...form.getInputProps("reference")}
          />

          <Textarea label="Notes" rows={2} {...form.getInputProps("notes")} />

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
