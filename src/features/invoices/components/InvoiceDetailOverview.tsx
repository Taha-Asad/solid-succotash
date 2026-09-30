import {
  Badge,
  Card,
  Grid,
  Group,
  SimpleGrid,
  Text,
  Title,
} from "@mantine/core";
import type {
  InvoiceFbrStatus,
  PublicCustomer,
  PublicInvoice,
} from "../../../types/backend";
import {
  FBR_STATUS_COLORS,
  paisaToDisplay,
  STATUS_COLORS,
} from "../utils/invoiceHelpers";

interface InvoiceDetailOverviewProps {
  invoice: PublicInvoice;
  customer: PublicCustomer;
  customerTotalDue: number | null;
  fbrStatus: InvoiceFbrStatus | null;
}

export function InvoiceDetailOverview({
  invoice,
  customer,
  customerTotalDue,
  fbrStatus,
}: InvoiceDetailOverviewProps) {
  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card withBorder padding="md">
          <Group justify="space-between" align="center" mb="xs">
            <Title order={5} m={0}>
              Bill To
            </Title>
            {customerTotalDue !== null &&
              (customerTotalDue > 0 ? (
                <Badge color="orange" variant="light" size="sm">
                  ⚠️ Other Pending Khata: {paisaToDisplay(customerTotalDue)} PKR
                </Badge>
              ) : (
                <Badge color="teal" variant="light" size="sm">
                  ✓ Other Bills Clear
                </Badge>
              ))}
          </Group>
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
      <Grid.Col span={{ base: 12, md: 6 }}>
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
            {fbrStatus && fbrStatus.fbrStatus !== "not_submitted" && (
              <>
                <Text size="sm" fw={500}>
                  FBR Status:
                </Text>
                <Badge
                  color={FBR_STATUS_COLORS[fbrStatus.fbrStatus] ?? "gray"}
                  variant="light"
                  size="sm"
                >
                  {fbrStatus.fbrStatus}
                </Badge>
              </>
            )}
            {fbrStatus?.irn && (
              <>
                <Text size="sm" fw={500}>
                  IRN:
                </Text>
                <Text size="sm" style={{ fontFamily: "monospace" }}>
                  {fbrStatus.irn}
                </Text>
              </>
            )}
            {fbrStatus?.queueItem?.lastError && (
              <>
                <Text size="sm" fw={500}>
                  Last Error:
                </Text>
                <Text size="xs" c="red" lineClamp={2}>
                  {fbrStatus.queueItem.lastError}
                </Text>
              </>
            )}
          </SimpleGrid>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
