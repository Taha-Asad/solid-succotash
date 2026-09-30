import { useEffect, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  FileText,
  Layers,
  Printer,
  Receipt,
  Upload,
} from "lucide-react";
import {
  analyzeInvoiceExcelTemplate,
  downloadSampleInvoiceTemplate,
  getCompany,
  getErrorMessage,
  getInvoiceSettings,
  openFileDialog,
  readFileBase64,
  saveFileDialog,
  saveInvoiceExcelTemplate,
  updateInvoiceSettings,
  type ExcelTemplateAnalysis,
} from "../../../api/backend";
import type { PublicCompany } from "../../../types/backend";
import { printHtmlContent } from "../../../utils/printInvoice";
import { InvoiceLivePreview } from "../components/InvoiceLivePreview";
import { generateTestInvoiceHtml } from "../utils/testInvoiceHtml";

const INVOICE_PRESETS = [
  {
    id: "wholesale_a4",
    name: "Wholesale Standard (A4)",
    description:
      "Standard full-page format with product rows, wholesale cartons/qty, signature lines, and previous balance.",
    paperSize: "A4 Sheet (210 × 297 mm)",
    badge: "Recommended",
    icon: FileText,
  },
  {
    id: "thermal_80mm",
    name: "Thermal POS Slip (80mm)",
    description:
      "Fast receipt for 80mm roll printers. Paper-efficient, high-contrast monospace formatting for counter sales.",
    paperSize: "80mm Roll (3-inch)",
    badge: "Counter POS",
    icon: Receipt,
  },
  {
    id: "thermal_58mm",
    name: "Thermal POS Slip (58mm)",
    description:
      "Ultra-compact receipt for 58mm roll printers (mini Bluetooth/USB POS). Zero margins, 4-column item breakdown.",
    paperSize: "58mm Roll (2-inch)",
    badge: "Mini POS",
    icon: Receipt,
  },
  {
    id: "compact_a5",
    name: "Compact Voucher (A5)",
    description:
      "Half-sheet format designed for retail shops to save 50% paper while keeping clear rates and totals.",
    paperSize: "A5 Half-Sheet (148 × 210 mm)",
    badge: "Paper Saver",
    icon: Layers,
  },
];

const ACCENT_SWATCHES = [
  "#1d2b54",
  "#059669",
  "#2563eb",
  "#334155",
  "#b91c1c",
  "#c9952a",
];

export function InvoiceSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);

  // Legacy Excel template state
  const [templateAnalysis, setTemplateAnalysis] =
    useState<ExcelTemplateAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingSample, setDownloadingSample] = useState(false);

  const form = useForm({
    initialValues: {
      companyNtn: "",
      companyStrn: "",
      companyCnic: "",
      invoicePrefix: "INV",
      nextNumber: 1,
      defaultDueDays: 30,
      invoiceFooter: "مال کی واپسی یا تبدیلی صرف 3 دن کے اندر بل کے ساتھ ممکن ہے۔",
      termsConditions:
        "1. Goods once sold can be exchanged within 3 days with original receipt.\n2. Payment is strictly due upon receipt.",
      invoiceDesign: "wholesale_a4",
      designAccentColor: "#1d2b54",
      showQr: true,
      showSignatures: true,
      showPreviousBalance: true,
      disclaimer: "Goods once sold are not returnable.",
      copyright: "© 2026 Corbel ERP",
      bankDetails: "Meezan Bank · A/C: 0101-0102938471 · Title: Corbel Trading Co.",
    },
  });

  useEffect(() => {
    Promise.all([getInvoiceSettings(), getCompany().catch(() => null)])
      .then(([s, c]) => {
        let design = s.invoiceDesign ?? "wholesale_a4";
        if (design === "classic") design = "wholesale_a4";
        form.setValues({
          companyNtn: s.companyNtn ?? "",
          companyStrn: s.companyStrn ?? "",
          companyCnic: s.companyCnic ?? "",
          invoicePrefix: s.invoicePrefix || "INV",
          nextNumber: s.nextNumber || 1,
          defaultDueDays: s.defaultDueDays || 30,
          invoiceFooter: s.invoiceFooter ?? "",
          termsConditions: s.termsConditions ?? "",
          invoiceDesign: design,
          designAccentColor: s.designAccentColor || "#1d2b54",
          showQr: s.showQr ?? true,
          showSignatures: s.showSignatures ?? true,
          showPreviousBalance: s.showPreviousBalance ?? true,
          disclaimer: s.disclaimer ?? "",
          copyright: s.copyright ?? "",
          bankDetails: s.bankDetails ?? "",
        });
        if (c) setCompany(c);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(values: typeof form.values) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateInvoiceSettings(values);
      setSuccess("Invoice format & settings successfully saved / سیٹنگز محفوظ ہو گئیں");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadTemplate() {
    try {
      const result = await openFileDialog({
        title: "Select Excel invoice template",
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
      });
      const path = Array.isArray(result) ? result[0] : result;
      if (!path) return;

      setUploading(true);
      setError(null);
      setSuccess(null);
      const dataUri = await readFileBase64(path);
      const rawBase64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
      await saveInvoiceExcelTemplate(rawBase64);
      setTemplateAnalysis(null);
      setSuccess("Excel template uploaded. Run analysis to verify placeholders.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleAnalyzeTemplate() {
    try {
      setAnalyzing(true);
      setError(null);
      const analysis = await analyzeInvoiceExcelTemplate();
      setTemplateAnalysis(analysis);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleDownloadSampleTemplate() {
    try {
      const path = await saveFileDialog({
        title: "Save sample invoice template",
        defaultPath: "sample-invoice-template.xlsx",
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
      });
      if (!path) return;
      setDownloadingSample(true);
      setError(null);
      setSuccess(null);
      await downloadSampleInvoiceTemplate(path);
      setSuccess("Sample template saved. Open it in Excel to edit the layout.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDownloadingSample(false);
    }
  }

  function handleTestPrint() {
    const printHtml = generateTestInvoiceHtml({
      company,
      values: form.values,
      showPreviousBalance: form.values.showPreviousBalance,
      showSignatures: form.values.showSignatures,
    });
    printHtmlContent(printHtml);
  }

  if (loading) return <Text c="dimmed">Loading invoice settings...</Text>;

  const activePreset =
    INVOICE_PRESETS.find((p) => p.id === form.values.invoiceDesign) ||
    INVOICE_PRESETS[0];

  return (
    <Box pb={40}>
      {/* Title Header with Unified Action Bar */}
      <Group justify="space-between" align="center" mb={24} wrap="wrap" gap="md">
        <Stack gap={2}>
          <Title order={3} style={{ letterSpacing: -0.3 }}>
            Invoice & Print Layout
          </Title>
          <Text size="sm" c="dimmed">
            Configure paper specifications, print layout, and business credentials for counter sales.
          </Text>
        </Stack>

        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<Printer size={16} />}
            onClick={handleTestPrint}
          >
            Test Print
          </Button>
          <Button
            type="button"
            loading={saving}
            onClick={() => form.onSubmit(handleSave)()}
            style={{
              background: form.values.designAccentColor || "var(--app-accent)",
              color: "#fff",
            }}
          >
            Save Changes
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert
          color="red"
          variant="light"
          radius="md"
          icon={<AlertTriangle size={16} />}
          mb="md"
        >
          {error}
        </Alert>
      )}

      {success && (
        <Alert
          color="green"
          variant="light"
          radius="md"
          icon={<CheckCircle size={16} />}
          mb="md"
        >
          {success}
        </Alert>
      )}

      {/* 2-Column Responsive Workspace */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={24} style={{ alignItems: "flex-start" }}>
        {/* ==================== LEFT COLUMN: CONTROLS ==================== */}
        <Stack gap={20}>
          {/* Card 1: 3 Preset Cards */}
          <Card withBorder padding="md" radius="md" style={{ background: "var(--app-surface)" }}>
            <Title order={5} mb={4}>
              1. Paper Format & Layout
            </Title>
            <Text size="xs" c="dimmed" mb={14}>
              Select the paper dimension and layout corresponding to your shop printer:
            </Text>

            <Stack gap={10}>
              {INVOICE_PRESETS.map((preset) => {
                const isSelected = form.values.invoiceDesign === preset.id;
                const IconComponent = preset.icon;
                return (
                  <Box
                    key={preset.id}
                    p={14}
                    onClick={() => form.setFieldValue("invoiceDesign", preset.id)}
                    style={{
                      borderRadius: 8,
                      border: isSelected
                        ? `2px solid ${form.values.designAccentColor || "var(--app-accent)"}`
                        : "1px solid var(--app-border)",
                      background: isSelected
                        ? "var(--app-accent-soft)"
                        : "transparent",
                      cursor: "pointer",
                      transition: "border-color 0.15s ease, background 0.15s ease",
                    }}
                  >
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Group gap={12} align="flex-start" wrap="nowrap">
                        <ThemeIcon
                          size={36}
                          radius="md"
                          style={{
                            background: isSelected
                              ? form.values.designAccentColor || "var(--app-accent)"
                              : "var(--app-soft)",
                            color: isSelected ? "#fff" : "var(--app-muted)",
                          }}
                        >
                          <IconComponent size={18} />
                        </ThemeIcon>
                        <div>
                          <Text fw={700} size="sm">
                            {preset.name}
                          </Text>
                          <Text size="xs" c="dimmed" mt={2}>
                            {preset.description}
                          </Text>
                        </div>
                      </Group>

                      <Badge
                        variant={isSelected ? "filled" : "outline"}
                        size="xs"
                        style={{
                          background: isSelected ? form.values.designAccentColor : undefined,
                          color: isSelected ? "#fff" : undefined,
                        }}
                      >
                        {preset.paperSize}
                      </Badge>
                    </Group>
                  </Box>
                );
              })}
            </Stack>
          </Card>

          {/* Card 2: Simple Toggles & Styling */}
          <Card withBorder padding="md" radius="md" style={{ background: "var(--app-surface)" }}>
            <Title order={5} mb={4}>
              2. Optional Elements & Color
            </Title>
            <Text size="xs" c="dimmed" mb={14}>
              Toggle layout sections to include on printed bills:
            </Text>

            <Stack gap={14}>
              <Group
                justify="space-between"
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() =>
                  form.setFieldValue(
                    "showPreviousBalance",
                    !form.values.showPreviousBalance
                  )
                }
              >
                <div>
                  <Text size="sm" fw={600}>
                    Show Previous Ledger Balance
                  </Text>
                  <Text size="xs" c="dimmed">
                    Appends customer's outstanding balance to invoice total to show net balance due.
                  </Text>
                </div>
                <Switch
                  {...form.getInputProps("showPreviousBalance", {
                    type: "checkbox",
                  })}
                  onClick={(e) => e.stopPropagation()}
                />
              </Group>

              <Divider />

              <Group
                justify="space-between"
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() =>
                  form.setFieldValue(
                    "showSignatures",
                    !form.values.showSignatures
                  )
                }
              >
                <div>
                  <Text size="sm" fw={600}>
                    Dual Signature Lines
                  </Text>
                  <Text size="xs" c="dimmed">
                    Prints dedicated Customer and Authorized Signature acknowledgment lines.
                  </Text>
                </div>
                <Switch
                  {...form.getInputProps("showSignatures", {
                    type: "checkbox",
                  })}
                  onClick={(e) => e.stopPropagation()}
                />
              </Group>

              <Divider />

              <Group
                justify="space-between"
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() =>
                  form.setFieldValue("showQr", !form.values.showQr)
                }
              >
                <div>
                  <Text size="sm" fw={600}>
                    FBR Tax QR Verification Box
                  </Text>
                  <Text size="xs" c="dimmed">
                    Prints digital verification box on finalized POS receipts.
                  </Text>
                </div>
                <Switch
                  {...form.getInputProps("showQr", { type: "checkbox" })}
                  onClick={(e) => e.stopPropagation()}
                />
              </Group>

              <Divider />

              {/* Accent Color */}
              <div>
                <Text size="sm" fw={600} mb={8}>
                  Accent Header Color
                </Text>
                <Group gap={10}>
                  {ACCENT_SWATCHES.map((color) => (
                    <Box
                      key={color}
                      onClick={() => form.setFieldValue("designAccentColor", color)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: color,
                        cursor: "pointer",
                        border:
                          form.values.designAccentColor === color
                            ? "3px solid #fff"
                            : "2px solid transparent",
                        boxShadow:
                          form.values.designAccentColor === color
                            ? `0 0 0 2px ${color}`
                            : "none",
                        transition: "all 0.15s ease",
                      }}
                    />
                  ))}
                </Group>
              </div>
            </Stack>
          </Card>

          {/* Card 3: Business & Payment Info */}
          <Card withBorder padding="md" radius="md" style={{ background: "var(--app-surface)" }}>
            <Title order={5} mb={4}>
              3. Business, Tax & Terms
            </Title>
            <Text size="xs" c="dimmed" mb={14}>
              Tax registration and commercial terms printed on documents:
            </Text>

            <Stack gap="sm">
              <SimpleGrid cols={3}>
                <TextInput
                  label="Prefix"
                  placeholder="INV"
                  {...form.getInputProps("invoicePrefix")}
                />
                <NumberInput
                  label="Next Number"
                  min={1}
                  {...form.getInputProps("nextNumber")}
                />
                <NumberInput
                  label="Due Days"
                  min={1}
                  {...form.getInputProps("defaultDueDays")}
                />
              </SimpleGrid>

              <SimpleGrid cols={3}>
                <TextInput
                  label="Company NTN"
                  placeholder="1234567-8"
                  {...form.getInputProps("companyNtn")}
                />
                <TextInput
                  label="Company STRN"
                  placeholder="STRN number"
                  {...form.getInputProps("companyStrn")}
                />
                <TextInput
                  label="Owner CNIC"
                  placeholder="12345-1234567-1"
                  {...form.getInputProps("companyCnic")}
                />
              </SimpleGrid>

              <TextInput
                label="Footer Note"
                placeholder="Thank you for your business!"
                {...form.getInputProps("invoiceFooter")}
              />

              <Textarea
                label="Terms & Conditions"
                placeholder="Goods once sold can be exchanged within 7 days with original invoice."
                autosize
                minRows={2}
                {...form.getInputProps("termsConditions")}
              />

              <Textarea
                label="Bank & Payment Details"
                placeholder="Meezan Bank · Title: Ijaz & Company · A/C: 0101-1234567"
                autosize
                minRows={2}
                {...form.getInputProps("bankDetails")}
              />
            </Stack>
          </Card>

          {/* Card 4 (Collapsible): Advanced Custom Excel (.xlsx) */}
          <Accordion variant="separated" radius="md">
            <Accordion.Item value="excel-template">
              <Accordion.Control icon={<Upload size={16} />}>
                <Text size="sm" fw={600}>
                  Advanced: Custom Excel Template (.xlsx)
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <Text size="xs" c="dimmed">
                    If you have a specialized pre-printed stationery template designed in Excel:
                  </Text>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={handleUploadTemplate}
                      loading={uploading}
                    >
                      Upload .xlsx
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      onClick={handleAnalyzeTemplate}
                      loading={analyzing}
                    >
                      Analyze Placeholders
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={handleDownloadSampleTemplate}
                      loading={downloadingSample}
                    >
                      Download Sample
                    </Button>
                  </Group>

                  {templateAnalysis && (
                    <Box mt={6}>
                      {templateAnalysis.hasTemplate ? (
                        <Alert color="green" p="xs">
                          Template loaded: {templateAnalysis.knownTokens.length} detected tokens.
                        </Alert>
                      ) : (
                        <Alert color="gray" p="xs">
                          No Excel template currently uploaded.
                        </Alert>
                      )}
                    </Box>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>

        {/* ==================== RIGHT COLUMN: LIVE PREVIEW ==================== */}
        <Box style={{ position: "sticky", top: 16 }}>
          <Card
            withBorder
            padding="lg"
            radius="md"
            style={{
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group justify="space-between" align="center" mb={16}>
              <Group gap={8}>
                <Eye size={16} color="var(--app-muted)" />
                <Text fw={700} size="sm">
                  Live Print Preview
                </Text>
              </Group>

              <Badge
                size="sm"
                variant="light"
                style={{
                  color: form.values.designAccentColor || "var(--app-accent)",
                }}
              >
                {activePreset.name}
              </Badge>
            </Group>

            <InvoiceLivePreview
              company={company}
              invoiceDesign={form.values.invoiceDesign}
              designAccentColor={form.values.designAccentColor}
              companyNtn={form.values.companyNtn}
              invoicePrefix={form.values.invoicePrefix}
              showPreviousBalance={form.values.showPreviousBalance}
              showSignatures={form.values.showSignatures}
              showQr={form.values.showQr}
              invoiceFooter={form.values.invoiceFooter}
              bankDetails={form.values.bankDetails}
            />
          </Card>
        </Box>
      </SimpleGrid>
    </Box>
  );
}
