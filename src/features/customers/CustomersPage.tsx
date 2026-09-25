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
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";

import {
  deleteCustomer,
  getErrorMessage,
  listCustomers,
} from "../../api/backend";

import type { PublicCustomer, PublicUser } from "../../types/backend";
import CustomerFormPage from "./CustomerFormPage";

import { INK } from "../../theme";
import {
  Search,
  Trash2,
  Plus,
  Users,
  MessageSquare,
  Building2,
  UserCheck,
} from "lucide-react";

export default function CustomersPage({ user }: { user: PublicUser }) {
  const canManage = user.role === "owner" || user.role === "admin";

  const [customers, setCustomers] = useState<PublicCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "create">("list");

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

  if (viewMode === "create") {
    return (
      <CustomerFormPage
        onBack={() => setViewMode("list")}
        onCustomerCreated={() => {
          setViewMode("list");
          void load();
        }}
      />
    );
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
            onClick={() => setViewMode("create")}
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
                  onClick={() => setViewMode("create")}
                >
                  Add Your First Customer
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Card>

    </Stack>
  );
}
