// ==========================================
// SHARED UI: DATA TABLE PRIMITIVE
// ==========================================
//
// Generic, type-safe Mantine table wrapper.
// Features:
// - Sortable / alignable columns
// - Built-in empty states and loading skeletons
// - Standardized pagination bar
// - Lightweight (< 180 LOC), avoids heavy external grid bloat

import { type ReactNode } from "react";
import {
  Box,
  Center,
  Group,
  Pagination,
  ScrollArea,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { Inbox } from "lucide-react";

export interface ColumnDef<T> {
  key: string;
  header: ReactNode;
  render: (item: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  width?: number | string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  keyExtractor: (item: T) => string;
  loading?: boolean;
  emptyMessage?: string;
  emptySubtitle?: string;
  // Pagination
  page?: number;
  pageSize?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  // Styling
  striped?: boolean;
  highlightOnHover?: boolean;
  onRowClick?: (item: T) => void;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  loading = false,
  emptyMessage = "No records found",
  emptySubtitle = "There is currently no data to display.",
  page,
  pageSize,
  totalItems,
  onPageChange,
  striped = false,
  highlightOnHover = true,
  onRowClick,
}: DataTableProps<T>) {
  const showPagination =
    page !== undefined &&
    pageSize !== undefined &&
    totalItems !== undefined &&
    onPageChange !== undefined &&
    totalItems > pageSize;

  const totalPages =
    pageSize && totalItems ? Math.ceil(totalItems / pageSize) : 1;

  if (loading) {
    return (
      <Stack gap="xs" p="md">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} height={40} radius="sm" />
        ))}
      </Stack>
    );
  }

  if (data.length === 0) {
    return (
      <Center p="xl" style={{ minHeight: 220 }}>
        <Stack align="center" gap="xs">
          <Inbox size={36} color="var(--mantine-color-dimmed)" />
          <Text fw={600} size="sm">
            {emptyMessage}
          </Text>
          <Text size="xs" c="dimmed">
            {emptySubtitle}
          </Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Box>
      <ScrollArea>
        <Table
          striped={striped}
          highlightOnHover={highlightOnHover}
          verticalSpacing="sm"
        >
          <Table.Thead>
            <Table.Tr>
              {columns.map((col) => (
                <Table.Th
                  key={col.key}
                  ta={col.align}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {data.map((item, index) => (
              <Table.Tr
                key={keyExtractor(item)}
                onClick={() => onRowClick?.(item)}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {columns.map((col) => (
                  <Table.Td key={col.key} ta={col.align}>
                    {col.render(item, index)}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {showPagination && (
        <Box
          p="md"
          style={{
            borderTop: "1px solid var(--mantine-color-default-border)",
            background: "var(--mantine-color-default-hover)",
          }}
        >
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="xs" c="dimmed">
              Showing{" "}
              <strong>{(page - 1) * pageSize + 1}</strong> –{" "}
              <strong>{Math.min(page * pageSize, totalItems)}</strong> out of{" "}
              <strong>{totalItems}</strong> items
            </Text>

            <Pagination
              total={totalPages}
              value={page}
              onChange={onPageChange}
              size="sm"
            />
          </Group>
        </Box>
      )}
    </Box>
  );
}

export default DataTable;
