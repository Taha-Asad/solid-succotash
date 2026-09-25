// ==========================================
// CUSTOMERS PAGE
// Modern Customer Directory & Khata Registry
// ==========================================

import { useCallback, useEffect, useState } from "react";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";

import {
  deleteCustomer,
  createCustomer,
  getErrorMessage,
  listCustomers,
} from "../../api/backend";

import type { PublicCustomer, PublicUser } from "../../types/backend";

import { INK } from "../../theme";
import {
  Search,
  Trash2,
  Plus,
  Users,
  MessageSquare,
  AlertCircle,
  Building2,
  UserCheck,
} from "lucide-react";

export default function CustomersPage({ user }: { user: PublicUser }) {
  const canManage = user.role === "owner" || user.role === "admin";

  const [customers, setCustomers] = useState<PublicCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Add Customer Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      name: "",
      phone: "",
      email: "",
      address: "",
      buyerType: "unregistered",
      cnic: "",
      ntn: "",
      strn: "",
    },
    validate: {
      name: (val) =>
        val.trim().length === 0 ? "Customer or business name is required" : null,
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCustomers(await listCustomers());
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

  async function handleCreateCustomer(values: typeof form.values) {
    setCreating(true);
    setCreateError(null);
    try {
      await createCustomer({
        name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        address: values.address.trim(),
        buyerType: values.buyerType,
        cnic: values.cnic.trim(),
        ntn: values.ntn.trim(),
        strn: values.strn.trim(),
      });
      setCreateModalOpen(false);
      form.reset();
      await load();
    } catch (err) {
      setCreateError(getErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(customer: PublicCustomer) {
    if (
      !confirm(
        `Archive customer "${customer.name}"? Historical invoices and ledgers will be preserved.`,
      )
    )
      return;
    try {
      await deleteCustomer(customer.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function handleOpenWhatsApp(phone: string, name: string) {
    const cleaned = phone.replace(/[^0-9]/g, "");
    const formatted = cleaned.startsWith("0")
      ? `92${cleaned.slice(1)}`
      : cleaned;
    const msg = encodeURIComponent(
      `Assalam-o-Alaikum ${name}, this is from our accounts department regarding your invoice and ledger balance.`,
    );
    window.open(`https://wa.me/${formatted}?text=${msg}`, "_blank");
  }

  const query = search.trim().toLowerCase();
  const filtered = query
    ? customers.filter((c) =>
        [c.name, c.email, c.phone, c.cnic, c.ntn, c.address].some((v) =>
          v?.toLowerCase().includes(query),
        ),
      )
    : customers;

  const totalCount = customers.length;
  const activeCount = customers.filter((c) => c.isActive).length;
  const registeredCount = customers.filter(
    (c) => c.buyerType === "registered",
  ).length;

  return (
    <Stack gap="lg">
      {/* Header & Controls */}
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Stack gap={2}>
          <Text
            size="xs"
            fw={700}
            style={{
              color: INK.gold,
              letterSpacing: 1.4,
              textTransform: "uppercase",
            }}
          >
            Sales & Ledger
          </Text>
          <Title order={2} style={{ color: INK.text, letterSpacing: -0.3 }}>
            Customer Directory
          </Title>
          <Text size="sm" c="dimmed">
            Manage your retail, wholesale, and corporate client accounts.
          </Text>
        </Stack>

        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Search by name, phone, NTN, CNIC…"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            leftSection={<Search size={15} />}
            w={{ base: "100%", sm: 260 }}
          />

          <Button
            leftSection={<Plus size={16} />}
            onClick={() => {
              setCreateError(null);
              form.reset();
              setCreateModalOpen(true);
            }}
            style={{
              background: "var(--app-accent, #1d2b54)",
              color: "#ffffff",
              fontWeight: 600,
            }}
          >
            + New Customer
          </Button>
        </Group>
      </Group>

      {/* Summary KPI Badges */}
      <Group gap="md">
        <Badge
          size="lg"
          variant="light"
          color="gray"
          leftSection={<Users size={14} />}
          style={{ textTransform: "none", fontWeight: 600 }}
        >
          {totalCount} Total Customers
        </Badge>
        <Badge
          size="lg"
          variant="light"
          color="green"
          leftSection={<UserCheck size={14} />}
          style={{ textTransform: "none", fontWeight: 600 }}
        >
          {activeCount} Active
        </Badge>
        <Badge
          size="lg"
          variant="light"
          color="blue"
          leftSection={<Building2 size={14} />}
          style={{ textTransform: "none", fontWeight: 600 }}
        >
          {registeredCount} FBR Registered B2B
        </Badge>
      </Group>

      {/* Main Table Card */}
      <Card withBorder shadow="sm" padding="lg">
        <Stack gap="md">
          {error && (
            <Alert color="red" title="Error">
              {error}
            </Alert>
          )}

          <ScrollArea>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name / Business</Table.Th>
                  <Table.Th>Contact Phone</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>CNIC / NTN</Table.Th>
                  <Table.Th>Buyer Type</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((customer) => (
                  <Table.Tr key={customer.id}>
                    <Table.Td>
                      <Stack gap={1}>
                        <Text fw={600} size="sm" style={{ color: INK.text }}>
                          {customer.name}
                        </Text>
                        {customer.address && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {customer.address}
                          </Text>
                        )}
                      </Stack>
                    </Table.Td>

                    <Table.Td>
                      {customer.phone ? (
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm">{customer.phone}</Text>
                          <Tooltip label="Chat on WhatsApp">
                            <ActionIcon
                              variant="subtle"
                              color="teal"
                              size="sm"
                              onClick={() => {
                                if (customer.phone) {
                                  handleOpenWhatsApp(customer.phone, customer.name);
                                }
                              }}
                            >
                              <MessageSquare size={13} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      ) : (
                        <Text size="sm" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>

                    <Table.Td>
                      <Text size="sm">{customer.email || "—"}</Text>
                    </Table.Td>

                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {customer.ntn || customer.cnic || "—"}
                      </Text>
                    </Table.Td>

                    <Table.Td>
                      <Badge
                        color={
                          customer.buyerType === "registered" ? "blue" : "gray"
                        }
                        variant="light"
                        radius="sm"
                      >
                        {customer.buyerType === "registered"
                          ? "B2B Registered"
                          : "End-Consumer"}
                      </Badge>
                    </Table.Td>

                    <Table.Td>
                      <Badge
                        color={customer.isActive ? "green" : "red"}
                        variant="light"
                        radius="sm"
                      >
                        {customer.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </Table.Td>

                    <Table.Td style={{ textAlign: "right" }}>
                      {canManage && (
                        <Group gap="xs" justify="flex-end">
                          <Tooltip label="Archive customer">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={() => handleDelete(customer)}
                            >
                              <Trash2 size={15} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>

          {!loading && filtered.length === 0 && (
            <Stack align="center" justify="center" py="xl" gap="sm">
              <Users size={36} color="var(--app-muted, #94a3b8)" />
              <Text size="md" fw={600} c="dimmed">
                {customers.length === 0
                  ? "No customers registered yet."
                  : "No customers match your search criteria."}
              </Text>
              {customers.length === 0 && (
                <Button
                  variant="light"
                  size="sm"
                  leftSection={<Plus size={15} />}
                  onClick={() => setCreateModalOpen(true)}
                >
                  Add Your First Customer
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Card>

      {/* ==================== CREATE CUSTOMER MODAL ==================== */}
      <Modal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={
          <Group gap="xs">
            <Users size={18} color="var(--app-accent)" />
            <Text fw={700} size="md" style={{ color: INK.text }}>
              Add New Customer / Account
            </Text>
          </Group>
        }
        size="lg"
        centered
        radius="md"
        styles={{
          header: {
            background: "var(--app-surface)",
            borderBottom: `1px solid ${INK.border}`,
          },
          content: { background: "var(--app-surface)" },
        }}
      >
        <form onSubmit={form.onSubmit(handleCreateCustomer)}>
          <Stack gap="md" pt="xs">
            {createError && (
              <Alert
                color="red"
                variant="light"
                radius="md"
                icon={<AlertCircle size={16} />}
              >
                {createError}
              </Alert>
            )}

            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Customer / Business Name"
                placeholder="e.g. Haji Muhammad Aslam or ABC Corp"
                required
                radius="md"
                {...form.getInputProps("name")}
              />

              <TextInput
                label="Phone / Mobile (WhatsApp)"
                placeholder="e.g. 0300-1234567"
                radius="md"
                {...form.getInputProps("phone")}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Email Address"
                placeholder="client@company.com"
                type="email"
                radius="md"
                {...form.getInputProps("email")}
              />

              <Select
                label="Buyer Tax Classification"
                data={[
                  { value: "unregistered", label: "End-Consumer / Unregistered" },
                  { value: "registered", label: "Registered Business (Sales Tax / NTN)" },
                ]}
                radius="md"
                {...form.getInputProps("buyerType")}
              />
            </SimpleGrid>

            <Textarea
              label="Billing / Shipping Address"
              placeholder="e.g. Shop # 14, Main Market, Gulberg, Lahore"
              radius="md"
              rows={2}
              {...form.getInputProps("address")}
            />

            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput
                label="CNIC (National ID)"
                placeholder="e.g. 35201-1234567-1"
                radius="md"
                {...form.getInputProps("cnic")}
              />

              <TextInput
                label="NTN (National Tax No)"
                placeholder="e.g. 1234567-8"
                radius="md"
                {...form.getInputProps("ntn")}
              />

              <TextInput
                label="STRN (Sales Tax Reg No)"
                placeholder="e.g. 01-02-1234-567-89"
                radius="md"
                {...form.getInputProps("strn")}
              />
            </SimpleGrid>

            <Group justify="flex-end" gap="sm" mt="md">
              <Button
                variant="default"
                size="sm"
                radius="md"
                onClick={() => setCreateModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                radius="md"
                loading={creating}
                style={{
                  background: "var(--app-accent, #1d2b54)",
                  color: "#ffffff",
                  fontWeight: 600,
                }}
              >
                Save Customer
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
