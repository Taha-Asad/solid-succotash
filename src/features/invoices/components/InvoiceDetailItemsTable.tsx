import { ActionIcon, Badge, Group, Table, Text } from "@mantine/core";
import type { PublicInvoiceItem } from "../../../types/backend";
import { paisaToDisplay } from "../utils/invoiceHelpers";

interface InvoiceDetailItemsTableProps {
  items: PublicInvoiceItem[];
  isDraft: boolean;
  canEdit: boolean;
  onEditItem: (item: PublicInvoiceItem) => void;
  onRemoveItem: (itemId: string) => void;
}

export function InvoiceDetailItemsTable({
  items,
  isDraft,
  canEdit,
  onEditItem,
  onRemoveItem,
}: InvoiceDetailItemsTableProps) {
  if (items.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="md">
        No items added yet.
      </Text>
    );
  }

  return (
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
                {item.discountAmount > 0
                  ? item.discountType === "amount"
                    ? `-${paisaToDisplay(item.discountAmount)}`
                    : `${item.discountRate / 100}% = ${paisaToDisplay(item.discountAmount)}`
                  : "—"}
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="sm" fw={500}>
                {paisaToDisplay(item.lineTotal)}
              </Text>
            </Table.Td>
            {isDraft && canEdit && (
              <Table.Td>
                <Group gap={4} justify="flex-end" wrap="nowrap">
                  <ActionIcon variant="subtle" onClick={() => onEditItem(item)}>
                    ✎
                  </ActionIcon>
                  <ActionIcon
                    color="red"
                    variant="subtle"
                    onClick={() => onRemoveItem(item.id)}
                  >
                    ✕
                  </ActionIcon>
                </Group>
              </Table.Td>
            )}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
