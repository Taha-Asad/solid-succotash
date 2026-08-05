// ==========================================
// CUSTOMERS PAGE
// ==========================================
//
// Customer directory:
//   - List all customers (soft-deleted rows excluded)
//   - Search by name / email / phone / CNIC / NTN
//   - Delete (archive) a customer; invoice history is kept

import { useCallback, useEffect, useState } from "react";

import {
  ActionIcon,
  Alert,
  Badge,
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

import { INK } from "../../theme";
import { Search, Trash2 } from "lucide-react";

export default function CustomersPage({ user }: { user: PublicUser }) {
  const canManage = user.role === "owner" || user.role === "admin";

  const [customers, setCustomers] = useState<PublicCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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

  async function handleDelete(customer: PublicCustomer) {
    if (!confirm(`Delete customer "${customer.name}"? Invoice history is kept.`)) return;
    try {
      await deleteCustomer(customer.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = query
    ? customers.filter((c) =>
        [c.name, c.email, c.phone, c.cnic, c.ntn].some((v) =>
          v?.toLowerCase().includes(query),
        ),
      )
    : customers;

  return (
    <Stack gap="lg">
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
            Sales
          </Text>
          <Title order={2} style={{ color: INK.navy, letterSpacing: -0.3 }}>
            Customer Directory
          </Title>
          <Text size="sm" c="dimmed">
            View and manage your customers. Deleting a customer keeps their
            invoice history.
          </Text>
        </Stack>
        <TextInput
          placeholder="Search customers…"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          leftSection={<Search size={15} />}
          w={{ base: "100%", sm: 280 }}
        />
      </Group>

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
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Phone</Table.Th>
                  <Table.Th>CNIC / NTN</Table.Th>
                  <Table.Th>Buyer Type</Table.Th>
                  <Table.Th>Status</Table.Th>
                  {canManage && <Table.Th>Actions</Table.Th>}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((customer) => (
                  <Table.Tr key={customer.id}>
                    <Table.Td>
                      <Text fw={600} size="sm" style={{ color: INK.navy }}>
                        {customer.name}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{customer.email || "—"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{customer.phone || "—"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{customer.cnic || customer.ntn || "—"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={customer.buyerType === "registered" ? "blue" : "gray"}
                        variant="light"
                        radius="sm"
                      >
                        {customer.buyerType}
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
                    {canManage && (
                      <Table.Td>
                        <Group gap="xs">
                          <Tooltip label="Delete customer">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              onClick={() => handleDelete(customer)}
                            >
                              <Trash2 size={15} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          {!loading && filtered.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="lg">
              {customers.length === 0
                ? "No customers yet."
                : "No customers match your search."}
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
