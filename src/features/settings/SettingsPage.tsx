// ==========================================
// SETTINGS PAGE
// ==========================================
//
// Tab 1: Company Profile
// Tab 2: Invoice Settings (FBR fields, numbering)
// Tab 3: Backup & Restore
// Tab 4: Audit Log

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
  Kbd,
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
} from "../../api/backend";

import type {
  AuditEntry,
  CompanyTheme,
  RetentionSummary,
  ExcelTemplateAnalysis,
} from "../../api/backend";

import type { PublicUser } from "../../types/backend";

import { Trash2, Upload, Check } from "lucide-react";

import { INK } from "../../theme";

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

  return (
    <Stack>
      <Title order={3}>Settings</Title>
      <Tabs defaultValue="company">
        <Tabs.List>
          <Tabs.Tab value="company">Company Profile</Tabs.Tab>
          <Tabs.Tab value="invoice">Invoice Settings</Tabs.Tab>
          {canEdit && <Tabs.Tab value="theme">Theme & Branding</Tabs.Tab>}
          <Tabs.Tab value="backup">Backup & Restore</Tabs.Tab>
          {canEdit && <Tabs.Tab value="retention">Data Retention</Tabs.Tab>}
          {canEdit && <Tabs.Tab value="audit">Audit Log</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="company" pt="md">
          <CompanyProfileTab />
        </Tabs.Panel>
        <Tabs.Panel value="invoice" pt="md">
          <InvoiceSettingsTab />
        </Tabs.Panel>
        {canEdit && (
          <Tabs.Panel value="theme" pt="md">
            <ThemeBrandingTab />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="backup" pt="md">
          <BackupRestoreTab onLogout={onLogout} />
        </Tabs.Panel>
        {canEdit && (
          <Tabs.Panel value="retention" pt="md">
            <RetentionTab />
          </Tabs.Panel>
        )}
        {canEdit && (
          <Tabs.Panel value="audit" pt="md">
            <AuditLogTab />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
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
              data={["PKR", "USD", "EUR", "GBP", "AED", "SAR", "INR"]}
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
            <Button type="submit" loading={saving}>
              Save Changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

// ==========================================
// INVOICE SETTINGS TAB
// ==========================================

function InvoiceSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      invoiceFooter: "",
      termsConditions: "",
      invoiceDesign: "classic",
      designAccentColor: "#1d2b54",
      showQr: true,
      disclaimer: "",
      copyright: "",
      bankDetails: "",
    },
  });

  useEffect(() => {
    getInvoiceSettings()
      .then((s) => {
        form.setValues({
          companyNtn: s.companyNtn ?? "",
          companyStrn: s.companyStrn ?? "",
          companyCnic: s.companyCnic ?? "",
          invoicePrefix: s.invoicePrefix,
          nextNumber: s.nextNumber,
          defaultDueDays: s.defaultDueDays,
          invoiceFooter: s.invoiceFooter ?? "",
          termsConditions: s.termsConditions ?? "",
          invoiceDesign: s.invoiceDesign,
          designAccentColor: s.designAccentColor,
          showQr: s.showQr,
          disclaimer: s.disclaimer ?? "",
          copyright: s.copyright ?? "",
          bankDetails: s.bankDetails ?? "",
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
      await updateInvoiceSettings(values);
      setSuccess("Invoice settings updated.");
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

  if (loading) return <Text c="dimmed">Loading...</Text>;

  return (
    <Card withBorder padding="lg" maw={700}>
      <Title order={5} mb="md">
        Invoice Settings
      </Title>
      <form onSubmit={form.onSubmit(handleSave)}>
        <Stack gap="md">
          <Title order={6}>FBR Tax Information</Title>
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

          <Divider />
          <Title order={6}>Invoice Numbering</Title>
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
              label="Default Due Days"
              min={1}
              {...form.getInputProps("defaultDueDays")}
            />
          </SimpleGrid>

          <Divider />
          <Title order={6}>Invoice Design</Title>
          <SimpleGrid cols={2}>
            <Select
              label="Design"
              data={[
                { value: "classic", label: "Classic" },
                { value: "modern", label: "Modern" },
                { value: "minimal", label: "Minimal" },
                { value: "excel", label: "Excel Template" },
              ]}
              {...form.getInputProps("invoiceDesign")}
            />
            <ColorInput
              label="Accent Color"
              format="hex"
              swatches={[
                "#1d2b54",
                "#2563eb",
                "#0d9488",
                "#c9952a",
                "#b91c1c",
                "#374151",
              ]}
              {...form.getInputProps("designAccentColor")}
            />
          </SimpleGrid>
          <Switch
            label="Show FBR QR code on finalized invoices"
            {...form.getInputProps("showQr", { type: "checkbox" })}
          />

          <Divider />
          <Title order={6}>Invoice Content</Title>
          <TextInput
            label="Footer Text"
            placeholder="Thank you for your business!"
            {...form.getInputProps("invoiceFooter")}
          />
          <Textarea
            label="Terms & Conditions"
            placeholder="Payment due within 30 days..."
            autosize
            minRows={2}
            {...form.getInputProps("termsConditions")}
          />
          <Textarea
            label="Bank Details"
            placeholder="Meezan Bank · A/C 0101-1234567 · IBAN PK00MEZN..."
            autosize
            minRows={2}
            {...form.getInputProps("bankDetails")}
          />
          <Textarea
            label="Disclaimer"
            placeholder="Goods once sold are not returnable..."
            autosize
            minRows={2}
            {...form.getInputProps("disclaimer")}
          />
          <TextInput
            label="Copyright"
            placeholder="© 2026 Ijaz & Company"
            {...form.getInputProps("copyright")}
          />

          <Divider />
          <Title order={6}>Excel Template</Title>
          <Text size="sm" c="dimmed">
            Upload an .xlsx invoice layout and the system fills placeholders
            like <Kbd>{"{{customer_name}}"}</Kbd>, <Kbd>{"{{invoice_number}}"}</Kbd>,{" "}
            <Kbd>{"{{grand_total}}"}</Kbd> and <Kbd>{"{{items_1_name}}"}</Kbd>.
          </Text>
          <Group gap="sm">
            <Button variant="outline" onClick={handleUploadTemplate} loading={uploading}>
              Upload Template
            </Button>
            <Button variant="light" onClick={handleAnalyzeTemplate} loading={analyzing}>
              Analyze Template
            </Button>
            <Button
              variant="subtle"
              onClick={handleDownloadSampleTemplate}
              loading={downloadingSample}
            >
              Download Sample
            </Button>
          </Group>
          {templateAnalysis && (
            <Stack gap={6}>
              {templateAnalysis.unknownTokens.length > 0 && (
                <Alert color="red" title="Unknown placeholders found">
                  {templateAnalysis.unknownTokens.join(", ")}
                </Alert>
              )}
              {templateAnalysis.missingCommonTokens.length > 0 && (
                <Alert color="yellow" title="Recommended placeholders missing">
                  {templateAnalysis.missingCommonTokens.join(", ")}
                </Alert>
              )}
              {templateAnalysis.knownTokens.length === 0 &&
                templateAnalysis.unknownTokens.length === 0 &&
                templateAnalysis.missingCommonTokens.length > 0 && (
                  <Alert color="gray" title="No placeholders detected">
                    Add placeholders like {"{{customer_name}}"} to your template
                    cells.
                  </Alert>
                )}
              {templateAnalysis.knownTokens.length > 0 &&
                templateAnalysis.unknownTokens.length === 0 &&
                templateAnalysis.missingCommonTokens.length === 0 && (
                  <Alert color="green" title="Template looks good">
                    All detected placeholders are recognised.
                  </Alert>
                )}
              {templateAnalysis.hasTemplate && templateAnalysis.knownTokens.length > 0 && (
                <Text size="sm" c="dimmed">
                  Recognised: {templateAnalysis.knownTokens.length} placeholder
                  token(s).
                </Text>
              )}
            </Stack>
          )}

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
            <Button type="submit" loading={saving}>
              Save Settings
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
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
  const { setColorScheme } = useAppTheme();

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
        form.setValues(t);
        if (t.colorScheme) {
          setColorScheme(t.colorScheme as "light" | "dark" | "auto");
        }
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
