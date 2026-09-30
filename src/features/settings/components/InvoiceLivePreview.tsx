import {
  Box,
  Card,
  Group,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import type { PublicCompany } from "../../../types/backend";

interface InvoiceLivePreviewProps {
  company: PublicCompany | null;
  invoiceDesign: string;
  designAccentColor: string;
  companyNtn: string;
  invoicePrefix: string;
  showPreviousBalance: boolean;
  showSignatures: boolean;
  showQr: boolean;
  invoiceFooter: string;
  bankDetails: string;
}

export function InvoiceLivePreview({
  company,
  invoiceDesign,
  designAccentColor,
  companyNtn,
  invoicePrefix,
  showPreviousBalance,
  showSignatures,
  showQr,
  invoiceFooter,
  bankDetails,
}: InvoiceLivePreviewProps) {
  const isThermal = invoiceDesign === "thermal_80mm";
  const accent = designAccentColor || "#1d2b54";

  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      style={{
        position: "sticky",
        top: 20,
        background: "var(--app-surface)",
      }}
    >
      <Group justify="space-between" mb="xs">
        <Text size="xs" fw={700} c="dimmed" style={{ textTransform: "uppercase" }}>
          Live Layout & Typography Preview
        </Text>
        <Text size="xs" c="dimmed">
          {isThermal ? "80mm POS Monospace" : "A4 Sheet (210×297mm)"}
        </Text>
      </Group>

      {/* Recessed Desk Surface Container */}
      <Box
        p={isThermal ? 16 : 24}
        style={{
          background: "var(--app-soft)",
          borderRadius: 8,
          border: "1px solid var(--app-border)",
        }}
      >
        {/* Simulated Paper Sheet */}
        <Box
          p={isThermal ? 16 : 24}
          style={{
            background: "#ffffff",
            color: "#111827",
            borderRadius: isThermal ? 2 : 4,
            border: isThermal
              ? "1px dashed #9ca3af"
              : "1px solid #e5e7eb",
            maxWidth: isThermal ? 300 : "100%",
            margin: "0 auto",
            fontFamily: isThermal
              ? "'Courier New', Courier, monospace"
              : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: isThermal ? 11 : 12,
            boxShadow: "0 2px 10px rgba(0, 0, 0, 0.08)",
          }}
        >
          {/* Header */}
          <Box
            pb={10}
            mb={12}
            style={{
              borderBottom: `2px solid ${accent}`,
              textAlign: isThermal ? "center" : "left",
            }}
          >
            <Group
              justify={isThermal ? "center" : "space-between"}
              align="flex-start"
            >
              <div>
                <Text
                  fw={800}
                  size={isThermal ? "md" : "lg"}
                  style={{ color: accent, letterSpacing: -0.3 }}
                >
                  {company?.name || "Ijaz & Company Traders"}
                </Text>
                <Text size="xs" c="dimmed">
                  {company?.phone || "+92 300 1234567"} ·{" "}
                  {company?.address || "Circular Road, Shah Alam, Lahore"}
                </Text>
                {companyNtn && (
                  <Text size="xs" c="dimmed">
                    NTN: {companyNtn}
                  </Text>
                )}
              </div>

              {!isThermal && (
                <Box style={{ textAlign: "right" }}>
                  <Text fw={800} size="md" style={{ color: accent }}>
                    INVOICE
                  </Text>
                  <Text size="xs" fw={700}>
                    {invoicePrefix}-000142
                  </Text>
                  <Text size="xs" c="dimmed">
                    Date: {new Date().toLocaleDateString("en-PK")}
                  </Text>
                </Box>
              )}
            </Group>

            {isThermal && (
              <Box
                mt={6}
                style={{ borderTop: "1px dashed #9ca3af", paddingTop: 4 }}
              >
                <Text size="xs" fw={700}>
                  INVOICE: {invoicePrefix}-000142 ·{" "}
                  {new Date().toLocaleDateString("en-PK")}
                </Text>
              </Box>
            )}
          </Box>

          {/* Customer Box */}
          <Box
            p={8}
            mb={12}
            style={{
              background: "#f9fafb",
              borderRadius: 4,
              border: "1px solid #f3f4f6",
            }}
          >
            <Text
              size="xs"
              fw={700}
              c="dimmed"
              style={{ textTransform: "uppercase" }}
            >
              Billed To:
            </Text>
            <Text size="xs" fw={700}>
              Al-Madina General Store (Chaudhry Akram)
            </Text>
            <Text size="xs" c="dimmed">
              0300-9876543 · Badami Bagh, Lahore
            </Text>
          </Box>

          {/* Sample Items Table */}
          <Table
            striped
            highlightOnHover={false}
            mb={12}
            styles={{
              table: { fontSize: isThermal ? 10 : 11 },
              th: {
                background: isThermal ? "transparent" : accent,
                color: isThermal ? "#000" : "#fff",
                padding: isThermal ? "4px 2px" : "6px 8px",
              },
              td: { padding: isThermal ? "4px 2px" : "6px 8px" },
            }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th style={{ textAlign: "right" }}>Qty</Table.Th>
                <Table.Th style={{ textAlign: "right" }}>Rate</Table.Th>
                <Table.Th style={{ textAlign: "right" }}>Amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>1</Table.Td>
                <Table.Td>Dalda Cooking Oil 5L Can</Table.Td>
                <Table.Td style={{ textAlign: "right" }}>10</Table.Td>
                <Table.Td style={{ textAlign: "right" }}>2,850.00</Table.Td>
                <Table.Td style={{ textAlign: "right" }}>28,500.00</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>2</Table.Td>
                <Table.Td>Tapal Danedar Tea 450g Pack</Table.Td>
                <Table.Td style={{ textAlign: "right" }}>24</Table.Td>
                <Table.Td style={{ textAlign: "right" }}>620.00</Table.Td>
                <Table.Td style={{ textAlign: "right" }}>14,880.00</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>

          {/* Totals Breakdown */}
          <Stack gap={3} align="flex-end" mb={12}>
            <Group
              justify="space-between"
              style={{ width: isThermal ? "100%" : 220 }}
            >
              <Text size="xs">Subtotal:</Text>
              <Text size="xs" fw={600}>
                Rs. 43,380.00
              </Text>
            </Group>

            {showPreviousBalance && (
              <Group
                justify="space-between"
                style={{ width: isThermal ? "100%" : 220 }}
              >
                <Text size="xs" c="red" fw={600}>
                  Previous Balance:
                </Text>
                <Text size="xs" c="red" fw={700}>
                  Rs. 8,500.00
                </Text>
              </Group>
            )}

            <Group
              justify="space-between"
              style={{
                width: isThermal ? "100%" : 220,
                borderTop: `2px solid ${accent}`,
                paddingTop: 4,
              }}
            >
              <Text size="sm" fw={800} style={{ color: accent }}>
                Total Payable:
              </Text>
              <Text size="sm" fw={800} style={{ color: accent }}>
                Rs. {showPreviousBalance ? "51,880.00" : "43,380.00"}
              </Text>
            </Group>
          </Stack>

          {/* FBR QR Preview */}
          {showQr && (
            <Box
              p={6}
              mb={12}
              style={{
                border: "1px dashed #d97706",
                background: "#fef3c7",
                borderRadius: 4,
                textAlign: "center",
              }}
            >
              <Text size="10px" fw={700} c="#92400e">
                [ FBR Digital Invoice QR Code Verified ]
              </Text>
            </Box>
          )}

          {/* Signatures */}
          {showSignatures && (
            <Group justify="space-between" mt={24} pt={8}>
              <Box style={{ textAlign: "center", width: 120 }}>
                <Box
                  style={{ borderTop: "1px dashed #6b7280", paddingTop: 2 }}
                />
                <Text size="9px" c="dimmed">
                  Customer Signature
                </Text>
              </Box>
              <Box style={{ textAlign: "center", width: 120 }}>
                <Box
                  style={{ borderTop: "1px dashed #6b7280", paddingTop: 2 }}
                />
                <Text size="9px" c="dimmed">
                  Authorized Signature
                </Text>
              </Box>
            </Group>
          )}

          {/* Footer */}
          <Box
            mt={16}
            pt={8}
            style={{ borderTop: "1px solid #f3f4f6", textAlign: "center" }}
          >
            <Text size="9px" c="dimmed">
              {invoiceFooter ||
                "Goods once sold can be exchanged within 7 days with original invoice."}
            </Text>
            {bankDetails && (
              <Text size="8px" c="dimmed" mt={2}>
                {bankDetails}
              </Text>
            )}
          </Box>
        </Box>
      </Box>
    </Card>
  );
}
