// ==========================================
// SETTINGS PAGE
// ==========================================
//
// Tab 1: Company Profile
// Tab 2: Invoice Settings (FBR fields, numbering)
// Tab 3: FBR Integration (API config, queue)
// Tab 4: Backup & Restore
// Tab 5: Audit Log

import { useCallback, useEffect, useState } from "react";

import {
  Badge,
  Button,
  Card,
  ColorInput,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  ScrollArea,
  NumberInput,
  Select,
  Alert,
  Box,
  Image,
  ActionIcon,
  Switch,
  Textarea,
  PasswordInput,
  Tooltip,
  Loader,
  Modal,
  Stepper,
  Center,
  ThemeIcon,
  List,
  Accordion,
} from "@mantine/core";

import { useForm } from "@mantine/form";

import { useAppTheme } from "../../theme/AppThemeProvider";

import {
  getCompany,
  updateCompany,
  getInvoiceSettings,
  updateInvoiceSettings,
  createBackup,
  restoreBackup,
  listAuditEntries,
  openFileDialog,
  saveFileDialog,
  getErrorMessage,
  getTheme,
  updateTheme,
  readFileBase64,
  getRetentionSummary,
  archiveOldRecords,
  saveInvoiceExcelTemplate,
  analyzeInvoiceExcelTemplate,
  downloadSampleInvoiceTemplate,
  getAllCurrencies,
  getFbrConfig,
  saveFbrConfig,
  testFbrConnection,
  getFbrQueueStatus,
  retryFbrSubmission,
  processFbrQueueNow,
  listCompanyModules,
  setCompanyModule,
} from "../../api/backend";

import type {
  AuditEntry,
  CompanyTheme,
  RetentionSummary,
  ExcelTemplateAnalysis,
} from "../../api/backend";

import type {
  PublicUser,
  CurrencyConfig,
  FbrConfig,
  FbrQueueStatus,
  FbrConnectionTestResult,
  PublicCompany,
  PublicCompanyModule,
} from "../../types/backend";

import {
  Trash2, Upload, Check, Languages as LanguagesIcon, Send, RefreshCw, Zap, AlertTriangle,
  CheckCircle, XCircle, ArrowRight, ArrowLeft, Settings,
  Receipt, FileText, Printer, Eye, Layers,
} from "lucide-react";

import { INK } from "../../theme";
import { useI18n } from "../../i18n/I18nProvider";
import { reportOnboardingEvent } from "../../onboarding/bus";
import {
  LANGUAGES,
  LANGUAGE_ORDER,
  type Lang,
} from "../../i18n/translations";
import SettingsHub, { type SettingsSection } from "./SettingsHub";
import { printHtmlContent } from "../../utils/printInvoice";

// ==========================================
// PROPS
// ==========================================

interface SettingsPageProps {
  user: PublicUser;
  onLogout: () => Promise<void>;
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function SettingsPage({ user, onLogout }: SettingsPageProps) {
  const canEdit = user.role === "owner";
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(null);

  if (activeSection === null) {
    return <SettingsHub user={user} onSelectSection={setActiveSection} />;
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Button
          variant="subtle"
          color="gray"
          size="sm"
          leftSection={<ArrowLeft size={16} />}
          onClick={() => setActiveSection(null)}
          radius="md"
        >
          ← All Settings
        </Button>
      </Group>

      {activeSection === "company" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>My Business Profile</Title>
            <Text size="sm" c="dimmed">
              Update your shop name, official contacts, and tax registrations.
            </Text>
          </Box>
          <CompanyProfileTab />
        </Stack>
      )}

      {activeSection === "invoicing" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Sales, Receipts & FBR</Title>
            <Text size="sm" c="dimmed">
              Configure receipt numbering, designs, and FBR POS digital invoicing.
            </Text>
          </Box>
          <Tabs defaultValue="invoice">
            <Tabs.List mb="md">
              <Tabs.Tab value="invoice">{t("settings.tab.invoice")}</Tabs.Tab>
              {canEdit && <Tabs.Tab value="fbr">FBR Integration</Tabs.Tab>}
            </Tabs.List>
            <Tabs.Panel value="invoice">
              <InvoiceSettingsTab />
            </Tabs.Panel>
            {canEdit && (
              <Tabs.Panel value="fbr">
                <FbrSettingsTab />
              </Tabs.Panel>
            )}
          </Tabs>
        </Stack>
      )}

      {activeSection === "backup" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Data Safety & Backups</Title>
            <Text size="sm" c="dimmed">
              Save instant database snapshots or restore your historical records.
            </Text>
          </Box>
          <Tabs defaultValue="backup">
            <Tabs.List mb="md">
              <Tabs.Tab value="backup">{t("settings.tab.backup")}</Tabs.Tab>
              {canEdit && <Tabs.Tab value="retention">{t("settings.tab.retention")}</Tabs.Tab>}
            </Tabs.List>
            <Tabs.Panel value="backup">
              <BackupRestoreTab onLogout={onLogout} />
            </Tabs.Panel>
            {canEdit && (
              <Tabs.Panel value="retention">
                <RetentionTab />
              </Tabs.Panel>
            )}
          </Tabs>
        </Stack>
      )}

      {activeSection === "appearance" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Theme & Language</Title>
            <Text size="sm" c="dimmed">
              Customize receipt branding colors, store logos, and app language.
            </Text>
          </Box>
          <Tabs defaultValue="theme">
            <Tabs.List mb="md">
              {canEdit && <Tabs.Tab value="theme">{t("settings.tab.theme")}</Tabs.Tab>}
              <Tabs.Tab value="language">{t("settings.tab.language")}</Tabs.Tab>
            </Tabs.List>
            {canEdit && (
              <Tabs.Panel value="theme">
                <ThemeBrandingTab />
              </Tabs.Panel>
            )}
            <Tabs.Panel value="language">
              <LanguageTab />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}

      {activeSection === "advanced" && canEdit && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Modules & Activity Audit</Title>
            <Text size="sm" c="dimmed">
              Toggle optional business capabilities and review staff audit events.
            </Text>
          </Box>
          <Tabs defaultValue="modules">
            <Tabs.List mb="md">
              <Tabs.Tab value="modules">Feature Modules</Tabs.Tab>
              <Tabs.Tab value="audit">{t("settings.tab.audit")}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="modules">
              <ModulesTab companyId={user.companyId ?? ""} />
            </Tabs.Panel>
            <Tabs.Panel value="audit">
              <AuditLogTab />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}
    </Stack>
  );
}

// ==========================================
// LANGUAGE TAB
// ==========================================

function LanguageTab() {
  const { lang, setLang, t } = useI18n();

  return (
    <Card withBorder padding="lg" maw={620}>
      <Group gap="sm" mb="sm">
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 38,
            height: 38,
            borderRadius: 12,
            background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
            color: "#131C39",
          }}
        >
          <LanguagesIcon size={18} />
        </span>
        <Title order={5}>{t("lang.title")}</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="lg">
        {t("lang.settingsIntro")}
      </Text>

      <Stack gap="sm">
        {LANGUAGE_ORDER.map((code: Lang) => {
          const meta = LANGUAGES[code];
          const selected = lang === code;
          return (
            <Box
              key={code}
              onClick={() => setLang(code)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 16px",
                borderRadius: 12,
                cursor: "pointer",
                border: `1.5px solid ${
                  selected ? INK.gold : "var(--app-border)"
                }`,
                background: selected ? "rgba(201,149,42,0.08)" : "var(--app-surface)",
                transition: "border-color 0.15s ease, background 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!selected) e.currentTarget.style.background = "var(--app-soft)";
              }}
              onMouseLeave={(e) => {
                if (!selected)
                  e.currentTarget.style.background = "var(--app-surface)";
              }}
            >
              <Group gap="sm">
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: selected
                      ? "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)"
                      : "var(--app-soft)",
                    color: selected ? "#131C39" : INK.muted,
                    fontWeight: 800,
                    fontSize: 14,
                  }}
                >
                  {code === "ur" ? "اردو" : "EN"}
                </span>
                <Box>
                  <Text fw={700} size="sm" style={{ color: INK.text }}>
                    {meta.native}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {meta.label} · {meta.dir === "rtl" ? "RTL" : "LTR"}
                  </Text>
                </Box>
              </Group>
              {selected && <Check size={18} style={{ color: INK.gold }} />}
            </Box>
          );
        })}
      </Stack>

      <Text size="xs" c="dimmed" mt="md">
        {t("lang.note")}
      </Text>
    </Card>
  );
}

// ==========================================
// COMPANY PROFILE TAB
// ==========================================

function CompanyProfileTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyConfig[]>([]);

  const form = useForm({
    initialValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
      taxNumber: "",
      currencyCode: "PKR",
    },
  });

  useEffect(() => {
    getAllCurrencies()
      .then((list) => setCurrencies(list))
      .catch(() => {});
    getCompany()
      .then((c) => {
        form.setValues({
          name: c.name,
          email: c.email ?? "",
          phone: c.phone ?? "",
          address: c.address ?? "",
          taxNumber: c.taxNumber ?? "",
          currencyCode: c.currencyCode,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(values: typeof form.values) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateCompany({
        ...values,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        taxNumber: values.taxNumber || null,
      });
      reportOnboardingEvent({ type: "settings-saved" });
      setSuccess("Company profile updated.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Text c="dimmed">Loading...</Text>;

  return (
    <Card withBorder padding="lg" maw={600}>
      <Title order={5} mb="md">
        Company Profile
      </Title>
      <form onSubmit={form.onSubmit(handleSave)}>
        <Stack gap="md">
          <TextInput
            label="Company Name"
            required
            {...form.getInputProps("name")}
          />
          <SimpleGrid cols={2}>
            <TextInput label="Email" {...form.getInputProps("email")} />
            <TextInput label="Phone" {...form.getInputProps("phone")} />
          </SimpleGrid>
          <TextInput label="Address" {...form.getInputProps("address")} />
          <SimpleGrid cols={2}>
            <TextInput
              label="Tax Number (NTN)"
              {...form.getInputProps("taxNumber")}
            />
            <Select
              label="Currency"
              data={currencies.length > 0
                ? currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))
                : ["PKR", "USD", "EUR", "GBP", "AED", "SAR", "INR"]
              }
              {...form.getInputProps("currencyCode")}
            />
          </SimpleGrid>
          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          {success && (
            <Text c="green" size="sm">
              {success}
            </Text>
          )}
          <Group justify="flex-end">
            <Button
              type="submit"
              loading={saving}
              data-tour="settings-save"
            >
              Save Changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

// ==========================================
// INVOICE SETTINGS & FORMATTING WORKSPACE
// ==========================================

const INVOICE_PRESETS = [
  {
    id: "wholesale_a4",
    name: "Wholesale Standard (A4)",
    description: "Standard full-page format with product rows, wholesale cartons/qty, signature lines, and previous balance.",
    paperSize: "A4 Sheet (210 × 297 mm)",
    badge: "Recommended",
    icon: FileText,
  },
  {
    id: "thermal_80mm",
    name: "Thermal POS Slip (80mm)",
    description: "Fast receipt for 80mm roll printers. Paper-efficient, high-contrast monospace formatting for counter sales.",
    paperSize: "80mm Roll",
    badge: "Counter POS",
    icon: Receipt,
  },
  {
    id: "compact_a5",
    name: "Compact Voucher (A5)",
    description: "Half-sheet format designed for retail shops to save 50% paper while keeping clear rates and totals.",
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

function InvoiceSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);

  // Toggles for visual elements
  const [showPreviousBalance, setShowPreviousBalance] = useState(true);
  const [showSignatures, setShowSignatures] = useState(true);

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
      termsConditions: "1. Goods once sold can be exchanged within 3 days with original receipt.\n2. Payment is strictly due upon receipt.",
      invoiceDesign: "wholesale_a4",
      designAccentColor: "#1d2b54",
      showQr: true,
      disclaimer: "Goods once sold are not returnable.",
      copyright: "© 2026 Ijaz & Company",
      bankDetails: "Meezan Bank · A/C: 0101-0102938471 · Title: Ijaz & Company",
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
    const isThermal = form.values.invoiceDesign === "thermal_80mm";
    const isCompact = form.values.invoiceDesign === "compact_a5";
    const accent = form.values.designAccentColor || "#1d2b54";
    const compName = company?.name || "Ijaz & Company Traders";
    const prefix = form.values.invoicePrefix || "INV";

    const printHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice Test Print</title>
  <style>
    @page {
      size: ${isThermal ? "80mm auto" : isCompact ? "A5 portrait" : "A4 portrait"};
      margin: ${isThermal ? "2mm" : "12mm"};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ${isThermal ? "'Courier New', Courier, monospace" : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"};
      font-size: ${isThermal ? "11px" : "12px"};
      color: #111827;
      background: #fff;
      padding: ${isThermal ? "4mm 2mm" : "0"};
      line-height: 1.4;
    }
    .header {
      border-bottom: 2px solid ${accent};
      padding-bottom: 8px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .comp-title {
      font-size: ${isThermal ? "15px" : "20px"};
      font-weight: 800;
      color: ${accent};
    }
    .meta { font-size: 11px; color: #4b5563; }
    .inv-title { font-size: 16px; font-weight: 800; text-align: right; color: ${accent}; }
    .customer-box {
      background: #f9fafb;
      padding: 8px 10px;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      margin-bottom: 12px;
    }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th {
      background: ${isThermal ? "transparent" : accent};
      color: ${isThermal ? "#111" : "#fff"};
      border-bottom: ${isThermal ? "1px solid #000" : "none"};
      padding: 6px 8px;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
    }
    td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .totals { margin-top: 10px; margin-left: auto; width: ${isThermal ? "100%" : "280px"}; }
    .totals-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
    .totals-row.grand {
      font-size: 14px;
      font-weight: 800;
      border-top: 2px solid #111;
      padding-top: 6px;
      margin-top: 4px;
      color: ${accent};
    }
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 36px;
      padding-top: 8px;
    }
    .sig-line {
      width: 140px;
      border-top: 1px dashed #6b7280;
      text-align: center;
      font-size: 10px;
      padding-top: 4px;
      color: #374151;
    }
    .footer {
      margin-top: 20px;
      text-align: center;
      font-size: 10px;
      color: #9ca3af;
      border-top: 1px solid #e5e7eb;
      padding-top: 8px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="comp-title">${compName}</div>
      <div class="meta">${company?.address || "Circular Road, Shah Alam, Lahore"}</div>
      <div class="meta">Phone: ${company?.phone || "+92 300 1234567"}${form.values.companyNtn ? " · NTN: " + form.values.companyNtn : ""}</div>
    </div>
    ${!isThermal ? `
    <div style="text-align: right;">
      <div class="inv-title">INVOICE</div>
      <div style="font-weight: 700; font-size: 12px;"># ${prefix}-000142</div>
      <div class="meta">Date: ${new Date().toLocaleDateString("en-PK")}</div>
    </div>` : ""}
  </div>

  ${isThermal ? `
    <div style="text-align:center; font-weight:700; margin-bottom:8px; font-size:11px;">
      INVOICE: ${prefix}-000142 · ${new Date().toLocaleDateString("en-PK")}
    </div>
  ` : ""}

  <div class="customer-box">
    <div style="font-weight: 700; font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 2px;">Billed To:</div>
    <div style="font-weight: 700; font-size: 12px;">Al-Madina General Store (Chaudhry Akram)</div>
    <div style="font-size: 11px; color: #4b5563;">Badami Bagh, Lahore · Phone: 0300-9876543</div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 24px;">#</th>
        <th>Description</th>
        <th class="num" style="width: 50px;">Qty</th>
        <th class="num" style="width: 80px;">Rate</th>
        <th class="num" style="width: 90px;">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td>Dalda Cooking Oil 5L Can</td>
        <td class="num">10</td>
        <td class="num">2,850.00</td>
        <td class="num">28,500.00</td>
      </tr>
      <tr>
        <td>2</td>
        <td>Tapal Danedar Tea 450g Pack</td>
        <td class="num">24</td>
        <td class="num">620.00</td>
        <td class="num">14,880.00</td>
      </tr>
      <tr>
        <td>3</td>
        <td>National Super Kernel Basmati Rice 5kg</td>
        <td class="num">15</td>
        <td class="num">1,450.00</td>
        <td class="num">21,750.00</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span>Subtotal:</span><span class="num">Rs. 65,130.00</span></div>
    <div class="totals-row"><span>Trade Discount (2%):</span><span class="num">-Rs. 1,302.60</span></div>
    <div class="totals-row"><span>GST (18%):</span><span class="num">Rs. 11,488.93</span></div>
    <div class="totals-row grand"><span>Total Payable:</span><span class="num">Rs. 75,316.33</span></div>
    ${showPreviousBalance ? `
      <div class="totals-row" style="margin-top: 6px; color: #dc2626; font-weight: 700;">
        <span>Previous Balance:</span><span class="num">Rs. 18,400.00</span>
      </div>
      <div class="totals-row" style="font-weight: 800; border-top: 1px dashed #ccc; padding-top: 4px;">
        <span>Net Total Due:</span><span class="num">Rs. 93,716.33</span>
      </div>
    ` : ""}
  </div>

  ${showSignatures ? `
    <div class="signatures">
      <div class="sig-line">Customer Signature</div>
      <div class="sig-line">Authorized Signature</div>
    </div>
  ` : ""}

  <div class="footer">
    <div>${form.values.invoiceFooter || "Thank you for your business!"}</div>
    <div>${form.values.termsConditions || "Goods once sold can be exchanged within 7 days with original invoice."}</div>
  </div>
</body>
</html>`;

    printHtmlContent(printHtml);
  }

  if (loading) return <Text c="dimmed">Loading invoice settings...</Text>;

  const activePreset = INVOICE_PRESETS.find((p) => p.id === form.values.invoiceDesign) || INVOICE_PRESETS[0];

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
        <Alert color="red" variant="light" radius="md" icon={<AlertTriangle size={16} />} mb="md">
          {error}
        </Alert>
      )}

      {success && (
        <Alert color="green" variant="light" radius="md" icon={<CheckCircle size={16} />} mb="md">
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
              <Group justify="space-between">
                <div>
                  <Text size="sm" fw={600}>
                    Show Previous Ledger Balance
                  </Text>
                  <Text size="xs" c="dimmed">
                    Appends customer's outstanding balance to invoice total to show net balance due.
                  </Text>
                </div>
                <Switch
                  checked={showPreviousBalance}
                  onChange={(e) => setShowPreviousBalance(e.currentTarget.checked)}
                />
              </Group>

              <Divider />

              <Group justify="space-between">
                <div>
                  <Text size="sm" fw={600}>
                    Dual Signature Lines
                  </Text>
                  <Text size="xs" c="dimmed">
                    Prints dedicated Customer and Authorized Signature acknowledgment lines.
                  </Text>
                </div>
                <Switch
                  checked={showSignatures}
                  onChange={(e) => setShowSignatures(e.currentTarget.checked)}
                />
              </Group>

              <Divider />

              <Group justify="space-between">
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
                        border: form.values.designAccentColor === color ? "3px solid #fff" : "2px solid transparent",
                        boxShadow: form.values.designAccentColor === color ? `0 0 0 2px ${color}` : "none",
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
                    <Button size="xs" variant="outline" onClick={handleUploadTemplate} loading={uploading}>
                      Upload .xlsx
                    </Button>
                    <Button size="xs" variant="light" onClick={handleAnalyzeTemplate} loading={analyzing}>
                      Analyze Placeholders
                    </Button>
                    <Button size="xs" variant="subtle" onClick={handleDownloadSampleTemplate} loading={downloadingSample}>
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

            {/* Recessed Desk Surface Container */}
            <Box
              p={form.values.invoiceDesign === "thermal_80mm" ? 16 : 24}
              style={{
                background: "var(--app-soft)",
                borderRadius: 8,
                border: "1px solid var(--app-border)",
              }}
            >
              {/* Simulated Paper Sheet */}
              <Box
                p={form.values.invoiceDesign === "thermal_80mm" ? 16 : 24}
                style={{
                  background: "#ffffff",
                  color: "#111827",
                  borderRadius: form.values.invoiceDesign === "thermal_80mm" ? 2 : 4,
                  border: form.values.invoiceDesign === "thermal_80mm"
                    ? "1px dashed #9ca3af"
                    : "1px solid #e5e7eb",
                  maxWidth: form.values.invoiceDesign === "thermal_80mm" ? 300 : "100%",
                  margin: "0 auto",
                  fontFamily: form.values.invoiceDesign === "thermal_80mm"
                    ? "'Courier New', Courier, monospace"
                    : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                  fontSize: form.values.invoiceDesign === "thermal_80mm" ? 11 : 12,
                  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.08)",
                }}
              >
                {/* Header */}
                <Box
                  pb={10}
                  mb={12}
                  style={{
                    borderBottom: `2px solid ${form.values.designAccentColor || "#1d2b54"}`,
                    textAlign: form.values.invoiceDesign === "thermal_80mm" ? "center" : "left",
                  }}
                >
                  <Group justify={form.values.invoiceDesign === "thermal_80mm" ? "center" : "space-between"} align="flex-start">
                    <div>
                      <Text
                        fw={800}
                        size={form.values.invoiceDesign === "thermal_80mm" ? "md" : "lg"}
                        style={{ color: form.values.designAccentColor || "#1d2b54", letterSpacing: -0.3 }}
                      >
                        {company?.name || "Ijaz & Company Traders"}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {company?.phone || "+92 300 1234567"} · {company?.address || "Circular Road, Shah Alam, Lahore"}
                      </Text>
                      {form.values.companyNtn && (
                        <Text size="xs" c="dimmed">NTN: {form.values.companyNtn}</Text>
                      )}
                    </div>

                    {form.values.invoiceDesign !== "thermal_80mm" && (
                      <Box style={{ textAlign: "right" }}>
                        <Text fw={800} size="md" style={{ color: form.values.designAccentColor || "#1d2b54" }}>
                          INVOICE
                        </Text>
                        <Text size="xs" fw={700}>
                          {form.values.invoicePrefix}-000142
                        </Text>
                        <Text size="xs" c="dimmed">
                          Date: {new Date().toLocaleDateString("en-PK")}
                        </Text>
                      </Box>
                    )}
                  </Group>

                  {form.values.invoiceDesign === "thermal_80mm" && (
                    <Box mt={6} style={{ borderTop: "1px dashed #9ca3af", paddingTop: 4 }}>
                      <Text size="xs" fw={700}>
                        INVOICE: {form.values.invoicePrefix}-000142 · {new Date().toLocaleDateString("en-PK")}
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
                  <Text size="xs" fw={700} c="dimmed" style={{ textTransform: "uppercase" }}>
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
                    table: { fontSize: form.values.invoiceDesign === "thermal_80mm" ? 10 : 11 },
                    th: {
                      background: form.values.invoiceDesign === "thermal_80mm"
                        ? "transparent"
                        : form.values.designAccentColor || "#1d2b54",
                      color: form.values.invoiceDesign === "thermal_80mm" ? "#000" : "#fff",
                      padding: form.values.invoiceDesign === "thermal_80mm" ? "4px 2px" : "6px 8px",
                    },
                    td: { padding: form.values.invoiceDesign === "thermal_80mm" ? "4px 2px" : "6px 8px" },
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
                  <Group justify="space-between" style={{ width: form.values.invoiceDesign === "thermal_80mm" ? "100%" : 220 }}>
                    <Text size="xs">Subtotal:</Text>
                    <Text size="xs" fw={600}>Rs. 43,380.00</Text>
                  </Group>

                  {showPreviousBalance && (
                    <Group justify="space-between" style={{ width: form.values.invoiceDesign === "thermal_80mm" ? "100%" : 220 }}>
                      <Text size="xs" c="red" fw={600}>Previous Balance:</Text>
                      <Text size="xs" c="red" fw={700}>Rs. 8,500.00</Text>
                    </Group>
                  )}

                  <Group
                    justify="space-between"
                    style={{
                      width: form.values.invoiceDesign === "thermal_80mm" ? "100%" : 220,
                      borderTop: `2px solid ${form.values.designAccentColor || "#1d2b54"}`,
                      paddingTop: 4,
                    }}
                  >
                    <Text size="sm" fw={800} style={{ color: form.values.designAccentColor || "#1d2b54" }}>
                      Total Payable:
                    </Text>
                    <Text size="sm" fw={800} style={{ color: form.values.designAccentColor || "#1d2b54" }}>
                      Rs. {showPreviousBalance ? "51,880.00" : "43,380.00"}
                    </Text>
                  </Group>
                </Stack>

                {/* FBR QR Preview */}
                {form.values.showQr && (
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
                      <Box style={{ borderTop: "1px dashed #6b7280", paddingTop: 2 }} />
                      <Text size="9px" c="dimmed">Customer Signature</Text>
                    </Box>
                    <Box style={{ textAlign: "center", width: 120 }}>
                      <Box style={{ borderTop: "1px dashed #6b7280", paddingTop: 2 }} />
                      <Text size="9px" c="dimmed">Authorized Signature</Text>
                    </Box>
                  </Group>
                )}

                {/* Footer */}
                <Box mt={16} pt={8} style={{ borderTop: "1px solid #f3f4f6", textAlign: "center" }}>
                  <Text size="9px" c="dimmed">
                    {form.values.invoiceFooter || "Goods once sold can be exchanged within 7 days with original invoice."}
                  </Text>
                  {form.values.bankDetails && (
                    <Text size="8px" c="dimmed" mt={2}>
                      {form.values.bankDetails}
                    </Text>
                  )}
                </Box>
              </Box>
            </Box>
          </Card>
        </Box>
      </SimpleGrid>
    </Box>
  );
}

// ==========================================
// THEME & BRANDING TAB
// ==========================================

const DEFAULT_THEME: CompanyTheme = {
  primaryColor: "#1D2B54",
  secondaryColor: "#2E4178",
  accentColor: "#C9952A",
  colorScheme: "light",
  logoBase64: null,
  companyTagline: null,
  erpWatermark: "Powered by Ijaz & Company ERP",
};

function ThemeBrandingTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { colorScheme, setColorScheme } = useAppTheme();

  const form = useForm({
    initialValues: DEFAULT_THEME,
    validate: {
      primaryColor: (v) =>
        /^#[0-9a-fA-F]{6}$/.test(v) ? null : "Enter a valid hex color",
      secondaryColor: (v) =>
        /^#[0-9a-fA-F]{6}$/.test(v) ? null : "Enter a valid hex color",
      accentColor: (v) =>
        /^#[0-9a-fA-F]{6}$/.test(v) ? null : "Enter a valid hex color",
    },
  });

  useEffect(() => {
    getTheme()
      .then((t) => {
        // Only fill the form — do NOT call setColorScheme here. Applying the
        // persisted company scheme on every visit would silently revert a dark
        // theme to light just by opening Settings. The scheme only changes when
        // the user picks it in the Color Scheme dropdown below; the dropdown
        // mirrors the live scheme so it never disagrees with the topbar toggle.
        form.setValues({ ...t, colorScheme });
        setLoading(false);
      })
      .catch((err) => {
        setError(getErrorMessage(err));
        setLoading(false);
      });
  }, []);

  async function handleSave(values: CompanyTheme) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { erpWatermark: _watermark, ...tenantFields } = values;
      const saved = await updateTheme(tenantFields);
      form.setValues(saved);
      setSuccess("Theme & branding updated.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePickLogo() {
    const result = await openFileDialog({
      title: "Choose a Logo",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg"] },
      ],
    });
    const path = Array.isArray(result) ? result[0] : result;
    if (!path) return;
    try {
      const dataUri = await readFileBase64(path);
      form.setFieldValue("logoBase64", dataUri);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (loading) return <Text c="dimmed">Loading...</Text>;

  return (
    <Card withBorder padding="lg" maw={760}>
      <Title order={5} mb="md">
        Theme & Branding
      </Title>
      <Text size="sm" c="dimmed" mb="lg">
        Customize the colors and branding used across the ERP — invoices, logo
        and watermark.
      </Text>
      <form onSubmit={form.onSubmit(handleSave)}>
        <Stack gap="md">
          {/* Brand colors */}
          <SimpleGrid cols={3}>
            <ColorInput
              label="Primary Color"
              format="hex"
              swatches={[INK.navy, INK.navySoft, "#283A6B", "#45619F"]}
              {...form.getInputProps("primaryColor")}
            />
            <ColorInput
              label="Secondary Color"
              format="hex"
              swatches={[INK.navySoft, "#354C85", "#6480BB", "#8FA4D1"]}
              {...form.getInputProps("secondaryColor")}
            />
            <ColorInput
              label="Accent Color"
              format="hex"
              swatches={[INK.gold, INK.goldBright, "#AC7922", "#E1903B"]}
              {...form.getInputProps("accentColor")}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <Select
              label="Color Scheme"
              data={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "auto", label: "Auto (follow system)" },
              ]}
              {...form.getInputProps("colorScheme")}
              onChange={(value) => {
                form.setFieldValue("colorScheme", value ?? "light");
                if (value) setColorScheme(value);
              }}
            />
            <TextInput
              label="Company Tagline"
              placeholder="Your tagline here"
              {...form.getInputProps("companyTagline")}
            />
          </SimpleGrid>

          <Divider label="Logo" labelPosition="left" />

          <Group align="flex-start" gap="lg">
            <Box
              style={{
                width: 120,
                height: 120,
                borderRadius: 16,
                border: `1px dashed ${INK.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                background: INK.paper,
                position: "relative",
              }}
            >
              {form.values.logoBase64 ? (
                <Image
                  src={form.values.logoBase64}
                  alt="Company logo"
                  fit="contain"
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <Text size="xs" c="dimmed" ta="center" px="xs">
                  No logo set
                </Text>
              )}
              {form.values.logoBase64 && (
                <ActionIcon
                  size="sm"
                  color="red"
                  variant="filled"
                  style={{ position: "absolute", top: 6, right: 6 }}
                  onClick={() => form.setFieldValue("logoBase64", null)}
                >
                  <Trash2 size={14} />
                </ActionIcon>
              )}
            </Box>
            <Stack gap="xs">
              <Button
                variant="light"
                leftSection={<Upload size={15} />}
                onClick={handlePickLogo}
              >
                Upload Logo
              </Button>
              <Text size="xs" c="dimmed">
                PNG, JPG, SVG or GIF. Shown on invoices and reports.
              </Text>
            </Stack>
          </Group>

          {/* Live preview */}
          <Divider label="Preview" labelPosition="left" />
          <Box
            style={{
              borderRadius: 16,
              padding: 16,
              background: "linear-gradient(135deg, #10183A 0%, #16214A 55%, #1D2B54 100%)",
              color: "#fff",
            }}
          >
            <Group gap="sm">
              {form.values.logoBase64 ? (
                <Image
                  src={form.values.logoBase64}
                  alt="logo"
                  height={32}
                  fit="contain"
                />
              ) : (
                <Box
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 13,
                    color: form.values.accentColor,
                    background: "rgba(255,255,255,0.08)",
                  }}
                >
                  I&
                </Box>
              )}
              <Box>
                <Text fw={700} size="sm">
                  Ijaz &amp; Company
                </Text>
                {form.values.companyTagline && (
                  <Text size="xs" style={{ color: "#A9B6D6" }}>
                    {form.values.companyTagline}
                  </Text>
                )}
              </Box>
              <Box
                style={{
                  marginLeft: "auto",
                  padding: "4px 10px",
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  background: form.values.accentColor,
                  color: "#131C39",
                }}
              >
                INVOICE
              </Box>
            </Group>
            <Box
              mt="md"
              style={{
                height: 6,
                borderRadius: 3,
                background: form.values.accentColor,
                opacity: 0.9,
              }}
            />
            <Text size="xs" mt="md" style={{ color: "#A9B6D6" }}>
              {form.values.erpWatermark}
            </Text>
          </Box>

          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          {success && (
            <Group gap={6} c="green">
              <Check size={14} />
              <Text c="green" size="sm">
                {success}
              </Text>
            </Group>
          )}
          <Group justify="flex-end">
            <Button type="submit" loading={saving}>
              Save Theme
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

// ==========================================
// BACKUP & RESTORE TAB
// ==========================================

function BackupRestoreTab({ onLogout }: { onLogout: () => Promise<void> }) {
  const [backing, setBacking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleBackup() {
    setBacking(true);
    setError(null);
    setSuccess(null);
    try {
      const path = await saveFileDialog({
        title: "Save Backup",
        defaultPath: "ijazandcompany-backup.db",
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      });
      if (!path) {
        setBacking(false);
        return;
      }
      const result = await createBackup(path);
      setSuccess(`Backup saved to: ${result}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBacking(false);
    }
  }

  async function handleRestore() {
    setError(null);
    setSuccess(null);

    const path = await openFileDialog({
      title: "Select Backup File",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (typeof path !== "string" || !path) return;

    if (
      !confirm(
        "WARNING: This will replace your current database. A safety backup will be created automatically. Continue?",
      )
    ) {
      return;
    }

    setRestoring(true);
    try {
      const result = await restoreBackup(path);
      setSuccess(result);
      // App needs to restart after restore
      setTimeout(() => {
        onLogout();
      }, 3000);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Stack maw={600}>
      <Card withBorder padding="lg">
        <Title order={5} mb="md">
          💾 Backup
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          Save a copy of your database to a location of your choice (USB drive,
          cloud folder, external hard drive).
        </Text>
        <Button onClick={handleBackup} loading={backing}>
          Create Backup...
        </Button>
      </Card>

      <Card withBorder padding="lg" style={{ borderColor: "#fd7e14" }}>
        <Title order={5} mb="md">
          📥 Restore
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          Restore your database from a previous backup file. This will replace
          all current data. A safety backup of the current database is created
          automatically before restoring.
        </Text>
        <Alert color="orange" variant="light" mb="md">
          <Text size="sm" fw={500}>
            ⚠️ Restoring will replace all current data. The app will log you out
            and you'll need to restart.
          </Text>
        </Alert>
        <Button color="orange" onClick={handleRestore} loading={restoring}>
          Restore from Backup...
        </Button>
      </Card>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      {success && (
        <Text c="green" size="sm">
          {success}
        </Text>
      )}

      <Card withBorder padding="lg">
        <Title order={5} mb="md">
          📁 Where is my data?
        </Title>
        <Text size="sm" c="dimmed">
          Your database is stored at:
        </Text>
        <Text size="sm" fw={500} ff="monospace" mt={4}>
          C:\Users\&lt;username&gt;\AppData\Roaming\com.ijazandcompany.erp\ijazandcompany-erp\ijazandcompany.db
        </Text>
        <Text size="sm" c="dimmed" mt="md">
          Backups are saved wherever you choose. We recommend backing up to a
          USB drive or cloud folder regularly.
        </Text>
      </Card>
    </Stack>
  );
}

// ==========================================
// DATA RETENTION TAB
// ==========================================

function RetentionTab() {
  const [summary, setSummary] = useState<RetentionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [years, setYears] = useState(5);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRetentionSummary(years);
      setSummary(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [years]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleArchive() {
    if (
      !confirm(
        `Archive all paid/cancelled records older than ${years} years? Records are soft-deleted, not erased.`,
      )
    ) {
      return;
    }
    setArchiving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await archiveOldRecords(years);
      setSuccess(result);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setArchiving(false);
    }
  }

  return (
    <Stack maw={700}>
      <Card withBorder padding="lg">
        <Title order={5} mb="md">
          Data Retention Policy
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          Old paid invoices and purchase orders are archived to keep the
          database fast. Archived records are soft-deleted — they can be
          restored if needed.
        </Text>

        <Group mb="md">
          <NumberInput
            label="Retention period (years)"
            value={years}
            onChange={(v) => setYears(typeof v === "number" ? v : 5)}
            min={1}
            max={20}
            w={200}
          />
          <Button variant="light" onClick={load} loading={loading} mt={24}>
            Refresh
          </Button>
        </Group>

        {loading ? (
          <Text c="dimmed">Loading...</Text>
        ) : summary ? (
          <Stack gap="md">
            <SimpleGrid cols={3}>
              <Card withBorder padding="md" style={{ borderTop: `3px solid ${INK.navy}` }}>
                <Text size="xs" c="dimmed">
                  Archivable Invoices
                </Text>
                <Title order={4} style={{ color: INK.text }}>
                  {summary.invoicesArchivable}
                </Title>
              </Card>
              <Card withBorder padding="md" style={{ borderTop: `3px solid ${INK.gold}` }}>
                <Text size="xs" c="dimmed">
                  Archivable Purchase Orders
                </Text>
                <Title order={4} style={{ color: INK.text }}>
                  {summary.poArchivable}
                </Title>
              </Card>
              <Card withBorder padding="md" style={{ borderTop: `3px solid ${INK.chart.teal}` }}>
                <Text size="xs" c="dimmed">
                  Archivable Stock Movements
                </Text>
                <Title order={4} style={{ color: INK.text }}>
                  {summary.movementsArchivable}
                </Title>
              </Card>
            </SimpleGrid>

            {summary.oldestInvoiceDate && (
              <Text size="xs" c="dimmed">
                Oldest invoice: {summary.oldestInvoiceDate}
              </Text>
            )}
            {summary.oldestMovementDate && (
              <Text size="xs" c="dimmed">
                Oldest stock movement: {summary.oldestMovementDate}
              </Text>
            )}

            <Alert color="blue" variant="light">
              <Text size="sm">
                Archiving hides old records from normal views but keeps them in
                the database. They can be restored by a database administrator
                if needed for audits.
              </Text>
            </Alert>

            <Group justify="flex-end">
              <Button
                color="orange"
                onClick={handleArchive}
                loading={archiving}
                disabled={
                  summary.invoicesArchivable === 0 &&
                  summary.poArchivable === 0 &&
                  summary.movementsArchivable === 0
                }
              >
                Archive Records Older Than {years} Years
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text c="dimmed">No retention data available.</Text>
        )}

        {error && (
          <Text c="red" size="sm" mt="md">
            {error}
          </Text>
        )}
        {success && (
          <Text c="green" size="sm" mt="md">
            {success}
          </Text>
        )}
      </Card>
    </Stack>
  );
}

// ==========================================
// FBR INTEGRATION TAB
// ==========================================

function FbrSettingsTab() {
  const [config, setConfig] = useState<FbrConfig | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [isActive, setIsActive] = useState(false);

  const [queueStatus, setQueueStatus] = useState<FbrQueueStatus | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [processingQueue, setProcessingQueue] = useState(false);

  const [wizardOpened, setWizardOpened] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizEnvironment, setWizEnvironment] = useState("sandbox");
  const [wizToken, setWizToken] = useState("");
  const [wizSaving, setWizSaving] = useState(false);
  const [wizTesting, setWizTesting] = useState(false);
  const [wizTestResult, setWizTestResult] = useState<FbrConnectionTestResult | null>(null);

  const isConnected = Boolean(config?.pralToken && config?.isActive);
  const lastTestOk = config?.lastTestResult === "success";

  const loadConfig = useCallback(async () => {
    try {
      const [c, co] = await Promise.all([getFbrConfig(), getCompany()]);
      if (c) {
        setConfig(c);
        setEnvironment(c.environment);
        setPralToken(c.pralToken ?? "");
        setIsActive(c.isActive);
        setCompany(co);
      } else {
        setCompany(co);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // We need these for the outer card but also for the wizard
  const [environment, setEnvironment] = useState("sandbox");
  const [pralToken, setPralToken] = useState("");

  const loadQueue = useCallback(async () => {
    try {
      setQueueLoading(true);
      const qs = await getFbrQueueStatus();
      setQueueStatus(qs);
    } catch {
      // Queue load failure is non-critical
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadQueue();
  }, [loadConfig, loadQueue]);

  const handleToggleActive = async (checked: boolean) => {
    if (checked && !config?.pralToken) {
      setWizardOpened(true);
      return;
    }
    setError(null);
    try {
      const updated = await saveFbrConfig(environment, checked, pralToken || null);
      setConfig(updated);
      setIsActive(updated.isActive);
      setSuccess(checked ? "FBR submission enabled." : "FBR submission paused.");
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleProcessQueue = async () => {
    setProcessingQueue(true);
    setError(null);
    try {
      const processed = await processFbrQueueNow();
      setSuccess(`Processed ${processed} queued invoice(s).`);
      await loadQueue();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setProcessingQueue(false);
    }
  };

  const handleRetry = async (queueId: string) => {
    try {
      await retryFbrSubmission(queueId);
      setSuccess("Submission queued for retry.");
      await loadQueue();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  // --- Wizard handlers ---
  const openWizard = () => {
    setWizardStep(0);
    setWizEnvironment(config?.environment ?? "sandbox");
    setWizToken(config?.pralToken ?? "");
    setWizTestResult(null);
    setError(null);
    setWizardOpened(true);
  };

  const handleWizardSaveAndTest = async () => {
    setWizSaving(true);
    setError(null);
    try {
      const updated = await saveFbrConfig(wizEnvironment, true, wizToken || null);
      setConfig(updated);
      setEnvironment(updated.environment);
      setPralToken(updated.pralToken ?? "");
      setIsActive(true);
      setWizSaving(false);
      setWizardStep(2);
    } catch (e) {
      setError(getErrorMessage(e));
      setWizSaving(false);
    }
  };

  const handleWizardTest = async () => {
    setWizTesting(true);
    setWizTestResult(null);
    try {
      const result = await testFbrConnection();
      setWizTestResult(result);
      const updated = await getFbrConfig();
      if (updated) setConfig(updated);
    } catch (e) {
      setWizTestResult({ success: false, message: getErrorMessage(e), timestamp: new Date().toISOString() });
    } finally {
      setWizTesting(false);
    }
  };

  const handleWizardFinish = () => {
    setWizardOpened(false);
    if (wizTestResult?.success) {
      setSuccess("FBR connection configured and verified.");
    }
  };

  if (loading) {
    return <Text c="dimmed">Loading FBR configuration...</Text>;
  }

  const isProduction = (config?.environment ?? environment) === "production";
  const canGoProduction = isConnected && lastTestOk && !isProduction;

  return (
    <>
      <Stack gap="lg">
        {/* ---- Connection status card ---- */}
        <Card withBorder padding="lg" maw={700}>
          <Group gap="sm" mb="sm">
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 12,
                background: isConnected
                  ? "linear-gradient(135deg, #2B8A3E 0%, #40C057 100%)"
                  : "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
                color: isConnected ? "#fff" : "#131C39",
              }}
            >
              {isConnected ? <CheckCircle size={18} /> : <Send size={18} />}
            </span>
            <Title order={5}>FBR Digital Invoicing</Title>
          </Group>
          <Text size="sm" c="dimmed" mb="lg">
            Your ERP can automatically submit finalized sales invoices to FBR.
            {isConnected
              ? " Your connection is active."
              : " Connect your business to get started."}
          </Text>

          <Card
            withBorder
            padding="md"
            style={{
              borderColor: isConnected ? "var(--mantine-color-green-4)" : undefined,
              background: isConnected ? "var(--mantine-color-green-0)" : undefined,
            }}
          >
            <Group justify="space-between" wrap="nowrap">
              <Group gap="md" wrap="nowrap">
                <ThemeIcon
                  size={42}
                  radius="xl"
                  variant="light"
                  color={isConnected ? "green" : "yellow"}
                >
                  {isConnected ? <CheckCircle size={20} /> : <XCircle size={20} />}
                </ThemeIcon>
                <Box>
                  <Text fw={600} size="sm">
                    {isConnected ? "Connected" : "Not Connected"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {isConnected
                      ? `Environment: ${config?.environment === "production" ? "Production" : "Sandbox"}`
                      : "Configure your FBR integration to start submitting invoices."}
                    {config?.lastTestedAt && isConnected && (
                      <> · Last tested: {new Date(config.lastTestedAt).toLocaleDateString()}</>
                    )}
                  </Text>
                </Box>
              </Group>
              <Button
                variant={isConnected ? "light" : "filled"}
                color={isConnected ? "gray" : "green"}
                size="sm"
                onClick={openWizard}
                leftSection={<Settings size={14} />}
              >
                {isConnected ? "Manage Connection" : "Connect FBR"}
              </Button>
            </Group>
          </Card>

          {/* Automatic submission toggle */}
          <Box mt="lg">
            <Group justify="space-between" align="center">
              <Box>
                <Text fw={500} size="sm">Automatic Submission</Text>
                <Text size="xs" c="dimmed">
                  {isConnected
                    ? "Finalized invoices will be automatically queued for FBR submission."
                    : "Connect to FBR first, then enable automatic submission."}
                </Text>
              </Box>
              <Switch
                checked={isActive}
                disabled={!isConnected}
                onChange={(e) => void handleToggleActive(e.currentTarget.checked)}
                size="lg"
              />
            </Group>
          </Box>

          {/* Environment indicator */}
          {isProduction && (
            <Alert color="orange" mt="md" variant="light" title="Production Environment">
              <Text size="sm">
                Invoices are submitted to FBR's live production system.
                All submissions are final and legally binding.
              </Text>
            </Alert>
          )}

          {/* Errors / Success */}
          {error && (
            <Alert color="red" title="Error" variant="light" mt="md">
              {error}
            </Alert>
          )}
          {success && (
            <Alert color="green" title="Success" variant="light" mt="md" onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}
        </Card>

        {/* ---- Queue card ---- */}
        <Card withBorder padding="lg" maw={700}>
          <Group gap="sm" mb="sm">
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 12,
                background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
                color: "#131C39",
              }}
            >
              <AlertTriangle size={18} />
            </span>
            <Title order={5}>Submission Queue</Title>
          </Group>
          <Text size="sm" c="dimmed" mb="md">
            Invoices are submitted asynchronously. Failed submissions are retried
            with exponential backoff (2m → 10m → 30m → 2h) and moved to dead
            letter after 5 attempts.
          </Text>

          {queueLoading ? (
            <Group gap="sm">
              <Loader size="sm" />
              <Text c="dimmed" size="sm">Loading queue...</Text>
            </Group>
          ) : queueStatus ? (
            <Stack gap="md">
              <SimpleGrid cols={4}>
                <Card padding="sm" withBorder>
                  <Text size="xs" c="dimmed">Queued</Text>
                  <Title order={4}>{queueStatus.queued}</Title>
                </Card>
                <Card padding="sm" withBorder>
                  <Text size="xs" c="dimmed">Submitting</Text>
                  <Title order={4} c="blue">{queueStatus.submitting}</Title>
                </Card>
                <Card padding="sm" withBorder>
                  <Text size="xs" c="dimmed">Failed</Text>
                  <Title order={4} c="orange">{queueStatus.failed}</Title>
                </Card>
                <Card padding="sm" withBorder>
                  <Text size="xs" c="dimmed">Dead</Text>
                  <Title order={4} c="red">{queueStatus.dead}</Title>
                </Card>
              </SimpleGrid>

              {queueStatus.items.length > 0 && (
                <ScrollArea>
                  <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Invoice</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Attempts</Table.Th>
                        <Table.Th>IRN</Table.Th>
                        <Table.Th>Error</Table.Th>
                        <Table.Th>Action</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {queueStatus.items.map((item) => (
                        <Table.Tr key={item.id}>
                          <Table.Td>
                            <Text size="sm" fw={500}>
                              {item.invoiceId.slice(0, 8)}...
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="sm" variant="light">
                              {item.invoiceType}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Badge
                              size="sm"
                              color={
                                item.status === "validated"
                                  ? "green"
                                  : item.status === "failed"
                                  ? "orange"
                                  : item.status === "dead"
                                  ? "red"
                                  : "blue"
                              }
                              variant="light"
                            >
                              {item.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">
                              {item.attemptCount}/{item.maxAttempts}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" style={{ fontFamily: "monospace" }}>
                              {item.irn ?? "—"}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed" lineClamp={1} maw={150}>
                              {item.lastError ?? "—"}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {(item.status === "failed" || item.status === "dead") && (
                              <Tooltip label="Retry submission">
                                <ActionIcon
                                  size="sm"
                                  variant="light"
                                  color="blue"
                                  onClick={() => void handleRetry(item.id)}
                                >
                                  <RefreshCw size={12} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}

              {queueStatus.items.length === 0 && (
                <Text c="dimmed" ta="center" py="md">
                  No submissions in queue.
                </Text>
              )}

              <Group justify="flex-end">
                <Button
                  variant="light"
                  loading={processingQueue}
                  onClick={() => void handleProcessQueue()}
                  leftSection={<Send size={14} />}
                >
                  Process Queue Now
                </Button>
              </Group>
            </Stack>
          ) : (
            <Text c="dimmed">No queue data available.</Text>
          )}
        </Card>
      </Stack>

      {/* ========================================== */}
      {/* MANAGE CONNECTION WIZARD                   */}
      {/* ========================================== */}
      <Modal
        opened={wizardOpened}
        onClose={() => setWizardOpened(false)}
        title="Connect FBR Digital Invoicing"
        size="lg"
        closeOnClickOutside={wizardStep === 0}
      >
        <Stepper active={wizardStep} onStepClick={setWizardStep} size="sm">
          {/* Step 0: Business info */}
          <Stepper.Step label="Business Info" description="Verify your details">
            <Stack gap="md" mt="md">
              <Text size="sm" c="dimmed">
                Your ERP will use these details when submitting invoices to FBR.
                They are taken from your Company Profile.
              </Text>

              <Card withBorder padding="md">
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Business Name</Text>
                    <Text size="sm" fw={500}>{company?.name ?? "—"}</Text>
                  </Group>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">NTN</Text>
                    <Text size="sm" fw={500} style={{ fontFamily: "monospace" }}>
                      {company?.ntn ?? company?.taxNumber ?? "—"}
                    </Text>
                  </Group>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">STRN</Text>
                    <Text size="sm" fw={500} style={{ fontFamily: "monospace" }}>
                      {company?.strn ?? "—"}
                    </Text>
                  </Group>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Province</Text>
                    <Text size="sm" fw={500}>{company?.province ?? "—"}</Text>
                  </Group>
                </Stack>
              </Card>

              <Alert color="blue" variant="light" title="FBR Integration">
                <Text size="sm">
                  FBR Digital Invoicing requires your business to be registered
                  with FBR. If your NTN/STRN are missing, update your Company
                  Profile first.
                </Text>
              </Alert>

              <Group justify="flex-end">
                <Button
                  rightSection={<ArrowRight size={14} />}
                  onClick={() => setWizardStep(1)}
                >
                  Continue
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>

          {/* Step 1: Environment + Token */}
          <Stepper.Step label="FBR Connection" description="Enter credentials">
            <Stack gap="md" mt="md">
              <Box>
                <Text fw={500} size="sm" mb={4}>Environment</Text>
                <Select
                  data={[
                    { value: "sandbox", label: "Sandbox (Testing)" },
                    { value: "production", label: "Production (Live)" },
                  ]}
                  value={wizEnvironment}
                  onChange={(v) => v && setWizEnvironment(v)}
                  disabled={canGoProduction === false}
                />
                {wizEnvironment === "sandbox" ? (
                  <Text size="xs" c="dimmed" mt={4}>
                    Used for testing only. No invoices are submitted to FBR.
                  </Text>
                ) : (
                  <Text size="xs" c="orange" mt={4}>
                    Invoices will be submitted to FBR's live system.
                  </Text>
                )}
              </Box>

              <Divider />

              <Box>
                <Text fw={500} size="sm" mb={4}>Security Token</Text>
                <PasswordInput
                  placeholder="Enter your FBR/PRAL security token"
                  value={wizToken}
                  onChange={(e) => setWizToken(e.currentTarget.value)}
                />
                <Text size="xs" c="dimmed" mt={4}>
                  Your token is provided by FBR or a licensed integrator.
                  It is encrypted and stored securely.
                </Text>
              </Box>

              <Group justify="space-between" mt="md">
                <Button variant="subtle" onClick={() => setWizardStep(0)}>
                  Back
                </Button>
                <Button
                  loading={wizSaving}
                  disabled={!wizToken.trim()}
                  onClick={() => void handleWizardSaveAndTest()}
                >
                  Save & Continue
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>

          {/* Step 2: Test connection */}
          <Stepper.Step label="Verify" description="Test connection">
            <Stack gap="md" mt="md">
              {!wizTestResult && (
                <>
                  <Text size="sm" c="dimmed">
                    Test your connection to make sure the token is valid and
                    FBR can authenticate your business.
                  </Text>
                  <Center py="md">
                    <Button
                      loading={wizTesting}
                      onClick={() => void handleWizardTest()}
                      leftSection={<Zap size={14} />}
                      size="lg"
                    >
                      Test Connection
                    </Button>
                  </Center>
                </>
              )}

              {wizTestResult && (
                <Card
                  withBorder
                  padding="md"
                  style={{
                    borderColor: wizTestResult.success ? "var(--mantine-color-green-4)" : "var(--mantine-color-red-4)",
                    background: wizTestResult.success ? "var(--mantine-color-green-0)" : "var(--mantine-color-red-0)",
                  }}
                >
                  <Group gap="sm" mb="sm">
                    <ThemeIcon
                      size={32}
                      radius="xl"
                      variant="light"
                      color={wizTestResult.success ? "green" : "red"}
                    >
                      {wizTestResult.success ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    </ThemeIcon>
                    <Title order={6}>
                      {wizTestResult.success ? "Connection Successful" : "Connection Failed"}
                    </Title>
                  </Group>
                  <Text size="sm">{wizTestResult.message}</Text>

                  {wizTestResult.success && (
                    <List size="sm" mt="sm" spacing={4}>
                      <List.Item>Environment: {wizEnvironment === "production" ? "Production" : "Sandbox"}</List.Item>
                      <List.Item>Business NTN: {company?.ntn ?? company?.taxNumber ?? "—"}</List.Item>
                      <List.Item>
                        {wizEnvironment === "sandbox"
                          ? "You can now submit test invoices."
                          : "Invoices will be submitted to FBR live."}
                      </List.Item>
                    </List>
                  )}

                  {!wizTestResult.success && (
                    <List size="sm" mt="sm" spacing={4} c="dimmed">
                      <List.Item>Verify your token is correct</List.Item>
                      <List.Item>Check the token has not expired</List.Item>
                      <List.Item>Ensure the token matches the selected environment</List.Item>
                    </List>
                  )}
                </Card>
              )}

              <Group justify="space-between" mt="md">
                <Button variant="subtle" onClick={() => setWizardStep(1)}>
                  Back
                </Button>
                {wizTestResult?.success ? (
                  <Button
                    color="green"
                    onClick={handleWizardFinish}
                    leftSection={<Check size={14} />}
                  >
                    Done
                  </Button>
                ) : wizTestResult && !wizTestResult.success ? (
                  <Button
                    variant="light"
                    onClick={() => { setWizTestResult(null); }}
                    leftSection={<RefreshCw size={14} />}
                  >
                    Try Again
                  </Button>
                ) : null}
              </Group>
            </Stack>
          </Stepper.Step>
        </Stepper>
      </Modal>
    </>
  );
}

// ==========================================
// MODULES TAB
// ==========================================

const MODULE_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  inventory: { label: "Inventory", description: "Products, stock management & suppliers" },
  invoices: { label: "Invoices", description: "Create, finalize & manage customer invoices" },
  purchase_orders: { label: "Purchasing", description: "Purchase orders from suppliers" },
  reports: { label: "Reports", description: "Sales, stock & profit analytics" },
  ledger: { label: "Accounts", description: "Chart of accounts & journal entries" },
  users: { label: "Team", description: "Manage company users & roles" },
  settings: { label: "Settings", description: "Company profile, invoice design & backup" },
  import: { label: "Import", description: "Import products, customers & invoices from files" },
};

function ModulesTab({ companyId }: { companyId: string }) {
  const [modules, setModules] = useState<PublicCompanyModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadModules = useCallback(async () => {
    try {
      const list = await listCompanyModules(companyId);
      setModules(list);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const handleToggle = async (moduleKey: string, currentValue: boolean) => {
    setSaving(moduleKey);
    setError(null);
    setSuccess(null);
    try {
      await setCompanyModule({ companyId, moduleKey, isEnabled: !currentValue });
      setModules((prev) =>
        prev.map((m) =>
          m.moduleKey === moduleKey ? { ...m, isEnabled: !currentValue } : m,
        ),
      );
      setSuccess(
        `${MODULE_DESCRIPTIONS[moduleKey]?.label ?? moduleKey} ${!currentValue ? "enabled" : "disabled"}.`,
      );
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <Text c="dimmed">Loading modules...</Text>;
  }

  return (
    <Stack gap="lg">
      <Card withBorder padding="lg" maw={700}>
        <Group gap="sm" mb="sm">
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 38,
              height: 38,
              borderRadius: 12,
              background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
              color: "#131C39",
            }}
          >
            <Zap size={18} />
          </span>
          <Title order={5}>Modules</Title>
        </Group>
        <Text size="sm" c="dimmed" mb="lg">
          Enable or disable modules for your company. Disabled modules are hidden
          from the sidebar and their data is not accessible.
        </Text>

        {error && (
          <Alert color="red" title="Error" variant="light" mb="md">
            {error}
          </Alert>
        )}
        {success && (
          <Alert color="green" title="Updated" variant="light" mb="md">
            {success}
          </Alert>
        )}

        <Stack gap="md">
          {modules.map((mod) => {
            const meta = MODULE_DESCRIPTIONS[mod.moduleKey];
            return (
              <Group
                key={mod.id}
                justify="space-between"
                p="md"
                style={{
                  borderRadius: 8,
                  border: "1px solid var(--app-border)",
                  background: "var(--app-surface)",
                }}
              >
                <Stack gap={2}>
                  <Text fw={500} size="sm">
                    {meta?.label ?? mod.moduleKey}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {meta?.description ?? mod.moduleKey}
                  </Text>
                </Stack>
                <Switch
                  checked={mod.isEnabled}
                  onChange={() => void handleToggle(mod.moduleKey, mod.isEnabled)}
                  disabled={
                    saving !== null ||
                    mod.moduleKey === "settings" ||
                    mod.moduleKey === "ledger"
                  }
                />
              </Group>
            );
          })}
          {modules.length === 0 && (
            <Text c="dimmed" ta="center" py="md">
              No modules found. Run a database migration to seed default modules.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

// ==========================================
// AUDIT LOG TAB
// ==========================================

function AuditLogTab() {
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

  const actionColors: Record<string, string> = {
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
                      color={actionColors[entry.action] ?? "gray"}
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
