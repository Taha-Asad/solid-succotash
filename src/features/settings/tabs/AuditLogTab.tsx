import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  getErrorMessage,
  listAuditEntries,
  type AuditEntry,
} from "../../../api/backend";

const ACTION_COLORS: Record<string, string> = {
  create: "green",
  update: "blue",
  delete: "red",
  finalize: "teal",
  import: "violet",
  login: "cyan",
  logout: "gray",
  backup: "yellow",
  restore: "orange",
};

export function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAuditEntries(pageSize, page * pageSize);
      setEntries(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={5}>Audit Log</Title>
        <Group>
          <Button
            size="xs"
            variant="subtle"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            ← Previous
          </Button>
          <Text size="sm">Page {page + 1}</Text>
          <Button
            size="xs"
            variant="subtle"
            disabled={entries.length < pageSize}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </Button>
        </Group>
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {loading ? (
        <Text c="dimmed">Loading...</Text>
      ) : entries.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No audit entries yet.
        </Text>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>User</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Resource</Table.Th>
                <Table.Th>Details</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>
                    <Text size="xs">{entry.createdAt}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.userEmail}</Text>
                    <Text size="xs" c="dimmed">
                      {entry.userRole}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={ACTION_COLORS[entry.action] ?? "gray"}
                      variant="light"
                      size="sm"
                    >
                      {entry.action}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.resource}</Text>
                    {entry.resourceId && (
                      <Text size="xs" c="dimmed">
                        {entry.resourceId.slice(0, 8)}...
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" lineClamp={2}>
                      {entry.details ?? "—"}
                    </Text>
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
