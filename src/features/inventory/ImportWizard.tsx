// ============================================================================
// SMART IMPORT DROPZONE & ENGINE (Ijaz & Company ERP)
// Human-centered, zero-friction import for Pakistani retail/wholesale merchants.
// Designed under Crow Parliament ethos (Julian Mercer MERCER-UX & Marcus Sterling)
// ============================================================================

import { useEffect, useState, useRef } from "react";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import { reportOnboardingEvent } from "../../onboarding/bus";

import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  Loader,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";

import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  ArrowRight,
  Rocket,
  AlertTriangle,
  Info,
  FileCheck2,
  Plus,
  Trash2,
  RefreshCw,
  Undo2,
  Sparkles,
  Download,
  Settings2,
  FileText,
  ChevronDown,
  ChevronUp,
  Package,
  Users,
  Building2,
  Layers,
  FileBox,
} from "lucide-react";

import {
  analyzeImportFile,
  confirmImport,
  deleteImportTemplate,
  executeImport,
  getErrorMessage,
  getImportJob,
  IMPORT_COMPLETE_EVENT,
  IMPORT_PROGRESS_EVENT,
  listErpAdapters,
  listImportJobs,
  listImportTemplates,
  rollbackImport,
  type ImportProgressEvent,
} from "../../api/backend";

import { notifications } from "@mantine/notifications";

import type {
  ConflictStrategy,
  ErpAdapterInfo,
  FieldMapping,
  FileAnalysis,
  ImportJob,
  ImportResult,
  ImportTarget,
  ImportTemplate,
  PublicUser,
  RollbackResult,
} from "../../types/backend";

import { INK } from "../../theme";

// ==========================================
// TARGETS CONFIGURATION
// ==========================================

interface TargetMeta {
  value: ImportTarget;
  label: string;
  icon: React.ReactNode;
  subtitle: string;
  noun: string;
  stat: string;
  requiredFields: string[];
}

const TARGETS: TargetMeta[] = [
  {
    value: "products",
    label: "Products",
    icon: <Package size={16} />,
    subtitle: "Names, SKUs, cost prices, sell prices, stock & categories",
    noun: "products",
    stat: "Products Imported",
    requiredFields: ["name", "sku"],
  },
  {
    value: "customers",
    label: "Customers",
    icon: <Users size={16} />,
    subtitle: "Customer names, phones, addresses, CNIC / NTN",
    noun: "customers",
    stat: "Customers Imported",
    requiredFields: ["customer_name"],
  },
  {
    value: "suppliers",
    label: "Suppliers",
    icon: <Building2 size={16} />,
    subtitle: "Distributor names, contact persons, phones & tax info",
    noun: "suppliers",
    stat: "Suppliers Imported",
    requiredFields: ["supplier_name"],
  },
  {
    value: "opening_stock",
    label: "Opening Stock",
    icon: <Layers size={16} />,
    subtitle: "Add starting quantities to already existing SKUs",
    noun: "stock rows",
    stat: "Stock Lines Applied",
    requiredFields: ["sku"],
  },
  {
    value: "invoices",
    label: "Sales Invoices",
    icon: <FileText size={16} />,
    subtitle: "Historical customer sales invoices and totals",
    noun: "invoices",
    stat: "Invoices Imported",
    requiredFields: ["invoice_number", "customer_name"],
  },
  {
    value: "purchase_bills",
    label: "Purchase Bills",
    icon: <FileBox size={16} />,
    subtitle: "Historical supplier bills and line items",
    noun: "purchase bills",
    stat: "Purchase Bills Imported",
    requiredFields: ["po_number", "supplier_name"],
  },
];

const TARGET_FIELD_OPTIONS: Record<ImportTarget, { value: string; label: string }[]> = {
  products: [
    { value: "name", label: "Product Name (Core - Required)" },
    { value: "sku", label: "SKU / Item Code (Core - Required)" },
    { value: "cost_price", label: "Cost Price (Buying)" },
    { value: "sell_price", label: "Sell Price (Retail)" },
    { value: "quantity_in_stock", label: "Quantity / Starting Stock" },
    { value: "unit", label: "Unit of Measure (pcs, box, kg)" },
    { value: "expiry_date", label: "Expiry Date (YYYY-MM-DD)" },
    { value: "category", label: "Category" },
    { value: "supplier", label: "Supplier / Vendor" },
    { value: "tax_rate", label: "Tax Rate (%)" },
    { value: "skip", label: "Skip this column" },
    { value: "custom", label: "Custom Field (specify name)" },
  ],
  customers: [
    { value: "customer_name", label: "Customer Name (Required)" },
    { value: "phone", label: "Phone Number" },
    { value: "email", label: "Email Address" },
    { value: "address", label: "Shop / Home Address" },
    { value: "cnic", label: "CNIC" },
    { value: "ntn", label: "NTN / Tax Number" },
    { value: "strn", label: "STRN" },
    { value: "buyer_type", label: "Buyer Type (Retail / Wholesale)" },
    { value: "skip", label: "Skip this column" },
  ],
  suppliers: [
    { value: "supplier_name", label: "Supplier / Distributor Name (Required)" },
    { value: "contact_person", label: "Contact Person" },
    { value: "phone", label: "Phone Number" },
    { value: "email", label: "Email Address" },
    { value: "address", label: "Office Address" },
    { value: "tax_number", label: "Tax / NTN Number" },
    { value: "skip", label: "Skip this column" },
  ],
  opening_stock: [
    { value: "sku", label: "SKU / Item Code (Required - Must exist)" },
    { value: "quantity", label: "Opening Quantity" },
    { value: "cost_price", label: "Cost Price" },
    { value: "expiry_date", label: "Expiry Date" },
    { value: "name", label: "Product Name (Optional reference)" },
    { value: "skip", label: "Skip this column" },
  ],
  invoices: [
    { value: "invoice_number", label: "Invoice Number (Required)" },
    { value: "invoice_date", label: "Invoice Date" },
    { value: "customer_name", label: "Customer Name (Required)" },
    { value: "product_sku", label: "Product SKU" },
    { value: "quantity", label: "Quantity" },
    { value: "unit_price", label: "Unit Price" },
    { value: "tax_rate", label: "Tax Rate %" },
    { value: "discount", label: "Discount %" },
    { value: "total_amount", label: "Total Bill Amount" },
    { value: "amount_paid", label: "Amount Paid" },
    { value: "status", label: "Status" },
    { value: "skip", label: "Skip this column" },
  ],
  purchase_bills: [
    { value: "po_number", label: "Bill / PO Number (Required)" },
    { value: "po_date", label: "Bill Date" },
    { value: "supplier_name", label: "Supplier Name (Required)" },
    { value: "product_sku", label: "Product SKU" },
    { value: "quantity", label: "Quantity" },
    { value: "unit_cost", label: "Unit Cost" },
    { value: "tax_rate", label: "Tax Rate %" },
    { value: "total_amount", label: "Total Amount" },
    { value: "amount_paid", label: "Amount Paid" },
    { value: "expiry_date", label: "Expiry Date" },
    { value: "skip", label: "Skip this column" },
  ],
};

const CONFLICT_OPTIONS = [
  { value: "skip", label: "Skip duplicates (keep existing product intact)" },
  { value: "overwrite", label: "Update existing items with new data" },
  { value: "suffix", label: "Create as new duplicate item (adds -1, -2)" },
];

const LEDGER_NUM: React.CSSProperties = {
  fontFamily:
    'ui-monospace, "SF Mono", "Roboto Mono", "JetBrains Mono", Menlo, monospace',
  fontVariantNumeric: "tabular-nums",
};

interface ImportWizardProps {
  user: PublicUser;
  onComplete: () => void;
  backLabel?: string;
}

const emptyResult: ImportResult = {
  fieldsCreated: 0,
  productsImported: 0,
  customersImported: 0,
  itemsImported: 0,
  rowsWithErrors: 0,
  rowsSkipped: 0,
  jobId: null,
  errors: [],
};

// ==========================================
// SAMPLE CSV GENERATOR
// ==========================================

function downloadSampleCsv(target: ImportTarget) {
  let headers = "";
  let sampleRow = "";
  if (target === "products") {
    headers = "Product Name,SKU,Cost Price,Sell Price,Stock Quantity,Unit,Category,Supplier,Expiry Date";
    sampleRow = "Panadol 500mg,PAN-500,28.50,35.00,100,Box,Medicines,GSK Pakistan,2026-12-31";
  } else if (target === "customers") {
    headers = "Customer Name,Phone,Address,CNIC,NTN,Buyer Type";
    sampleRow = "Al-Madina Pharmacy,03001234567,Shop 4 Saddar Rawalpindi,37405-1234567-1,1234567-8,registered";
  } else if (target === "suppliers") {
    headers = "Supplier Name,Contact Person,Phone,Email,Address,Tax Number";
    sampleRow = "National Pharma Dist,Ahmed Khan,03219876543,sales@nationalpharma.pk,I-9 Islamabad,9876543-2";
  } else if (target === "opening_stock") {
    headers = "SKU,Product Name,Opening Quantity,Cost Price,Expiry Date";
    sampleRow = "PAN-500,Panadol 500mg,100,28.50,2026-12-31";
  } else if (target === "invoices") {
    headers = "Invoice Number,Invoice Date,Customer Name,Product SKU,Quantity,Unit Price,Total Amount";
    sampleRow = "INV-001,2026-09-01,Al-Madina Pharmacy,PAN-500,10,35.00,350.00";
  } else {
    headers = "PO Number,PO Date,Supplier Name,Product SKU,Quantity,Unit Cost,Total Amount";
    sampleRow = "PO-001,2026-09-01,National Pharma Dist,PAN-500,100,28.50,2850.00";
  }
  const blob = new Blob([`${headers}\n${sampleRow}\n`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sample_${target}_import.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function ImportWizard({
  user: _user,
  onComplete,
  backLabel = "Back to Inventory",
}: ImportWizardProps) {
  // Navigation tabs: 'import' or 'history'
  const [activeTab, setActiveTab] = useState<"import" | "history">("import");

  // Import Target
  const [target, setTarget] = useState<ImportTarget>("products");
  const targetMeta = TARGETS.find((t) => t.value === target) || TARGETS[0];

  // File state
  const [file, setFile] = useState<File | null>(null);
  const [fileBytes, setFileBytes] = useState<number[]>([]);
  const [fileType, setFileType] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Analysis & Mapping
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<FileAnalysis | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [customNames, setCustomNames] = useState<Record<number, string>>({});
  const [showAdvancedMapping, setShowAdvancedMapping] = useState(false);

  // Configuration options
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>("skip");
  const [templateName, setTemplateName] = useState("");
  const [adapters, setAdapters] = useState<ErpAdapterInfo[]>([]);
  const [adapter, setAdapter] = useState<string>("");
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);

  // Execution states
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Rollback states
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult | null>(null);

  // History state
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [historyRollbackId, setHistoryRollbackId] = useState<string | null>(null);

  // Load history & templates
  async function loadJobs() {
    setJobsLoading(true);
    try {
      const jobs = await listImportJobs();
      setImportJobs(jobs);
    } catch {
      setImportJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }

  async function loadTemplates() {
    try {
      setTemplates(await listImportTemplates(target));
    } catch {
      setTemplates([]);
    }
  }

  useEffect(() => {
    loadJobs();
    listErpAdapters().then(setAdapters).catch(() => setAdapters([]));
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [target]);

  // Track background import job via Tauri events
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    const jobId = activeJobId;
    const unlisteners: UnlistenFn[] = [];

    const finish = (result: ImportResult) => {
      if (cancelled) return;
      setImportResult(result);
      setActiveJobId(null);
      loadJobs();
    };

    const onProgress = (event: Event<ImportProgressEvent>) => {
      if (cancelled || event.payload.jobId !== jobId) return;
      setJobProgress(event.payload.progress);
    };

    const onCompleteEvent = (event: Event<ImportProgressEvent>) => {
      if (cancelled || event.payload.jobId !== jobId) return;
      setJobProgress(100);
      finish(event.payload.result ?? { ...emptyResult, jobId });
    };

    listen<ImportProgressEvent>(IMPORT_PROGRESS_EVENT, onProgress).then((un) => {
      if (cancelled) un();
      else unlisteners.push(un);
    });
    listen<ImportProgressEvent>(IMPORT_COMPLETE_EVENT, onCompleteEvent).then((un) => {
      if (cancelled) un();
      else unlisteners.push(un);
    });

    const sync = async () => {
      try {
        const status = await getImportJob(jobId);
        if (cancelled) return;
        setJobProgress(status.job.progress);
        if (status.result) finish(status.result);
      } catch {
        if (cancelled) return;
        setActiveJobId(null);
        setError("Import background tracking interrupted. Check history tab.");
      }
    };
    sync();
    const id = setInterval(sync, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
      unlisteners.forEach((un) => un());
    };
  }, [activeJobId]);

  // File analysis handler
  async function runAnalyzeWithBytes(bytes: number[], type: string, currentTarget: ImportTarget) {
    if (bytes.length === 0) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeImportFile({
        fileBytes: bytes,
        fileType: type,
        target: currentTarget,
        adapter: adapter || null,
      });

      setAnalysis(result);
      setMappings(result.proposedMappings);

      const names: Record<number, string> = {};
      result.proposedMappings.forEach((m, i) => {
        if (m.targetField.startsWith("custom:")) {
          names[i] = m.targetField.replace("custom:", "");
        }
      });
      setCustomNames(names);
    } catch (err) {
      setError(getErrorMessage(err));
      setAnalysis(null);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFileSelect(selectedFile: File | null) {
    if (!selectedFile) return;
    setFile(selectedFile);
    setError(null);
    setAnalysis(null);
    setPreview(null);
    setImportResult(null);

    let detectedType = "xlsx";
    const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "xlsx" || ext === "xls") detectedType = "xlsx";
    else if (ext === "csv") detectedType = "csv";
    else if (ext === "docx") detectedType = "docx";
    else if (ext === "pdf") detectedType = "pdf";
    else if (ext === "png" || ext === "jpg" || ext === "jpeg") detectedType = "png";
    else {
      setError("Please upload an Excel (.xlsx/.xls), CSV, Word table (.docx), or PDF file.");
      return;
    }
    setFileType(detectedType);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      setFileBytes(bytes);
      await runAnalyzeWithBytes(bytes, detectedType, target);
    } catch {
      setError("Could not read file. Please ensure it is not open in another program.");
    }
  }

  function handleTargetChange(next: ImportTarget) {
    setTarget(next);
    setAnalysis(null);
    setMappings([]);
    setPreview(null);
    setImportResult(null);
    setError(null);
    if (fileBytes.length > 0 && fileType) {
      runAnalyzeWithBytes(fileBytes, fileType, next);
    }
  }

  function updateMapping(index: number, targetField: string) {
    setMappings((prev) => {
      const next = [...prev];
      if (targetField === "custom") {
        const existingName =
          customNames[index] ||
          next[index].sourceColumn
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
        next[index] = {
          ...next[index],
          targetField: `custom:${existingName}`,
          fieldCategory: "custom",
          confidence: "unknown",
        };
        setCustomNames((p) => ({ ...p, [index]: existingName }));
      } else if (targetField === "skip") {
        next[index] = {
          ...next[index],
          targetField: "skip",
          fieldCategory: "skip",
          confidence: "unknown",
        };
      } else {
        next[index] = {
          ...next[index],
          targetField,
          fieldCategory: "core",
          confidence: "high",
        };
      }
      return next;
    });
  }

  function updateCustomName(index: number, name: string) {
    setCustomNames((prev) => ({ ...prev, [index]: name }));
    setMappings((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        targetField: `custom:${name}`,
      };
      return next;
    });
  }

  function addManualField() {
    setMappings((prev) => [
      ...prev,
      {
        sourceColumn: "Fixed Value",
        sourceIndex: analysis?.headers.length ?? 0,
        targetField: "custom:fixed_field",
        fieldCategory: "custom",
        confidence: "manual",
        manualValue: "",
      },
    ]);
  }

  function removeMapping(index: number) {
    setMappings((prev) => prev.filter((_, i) => i !== index));
  }

  function applyTemplate(tpl: ImportTemplate) {
    if (!analysis) return;
    const norm = (s: string) => s.trim().toLowerCase().replace(/[\s\-_.]/g, "");
    const headerMap = new Map<string, number>();
    analysis.headers.forEach((h, i) => headerMap.set(norm(h), i));

    const next = [...mappings];
    tpl.columnMappings.forEach((tm) => {
      const idx = headerMap.get(norm(tm.sourceColumn));
      if (idx !== undefined && next[idx]) {
        next[idx] = {
          ...next[idx],
          targetField: tm.targetField,
          fieldCategory: tm.fieldCategory,
          manualValue: tm.manualValue,
          confidence: "high",
        };
      }
    });
    setMappings(next);
  }

  async function handleDeleteTemplate(tpl: ImportTemplate) {
    try {
      await deleteImportTemplate(tpl.id);
      setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
      notifications.show({
        title: "Template deleted",
        message: `Template "${tpl.templateName}" removed.`,
        color: "green",
      });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function buildRequest(dryRun: boolean): Parameters<typeof executeImport>[0] {
    const activeMappings = mappings.filter((m) => m.targetField !== "skip");
    return {
      target,
      mappings: activeMappings,
      fileBytes,
      fileType,
      templateName,
      hasHeaderRow: true,
      importData: true,
      conflictStrategy,
      dryRun,
      fileName: file?.name ?? null,
    };
  }

  // Instant Smart Import: automatically validates and submits
  async function handleExecuteSmartImport() {
    setImporting(true);
    setError(null);
    try {
      // Direct confirm import
      const result = await confirmImport(buildRequest(false));
      setJobProgress(0);
      setImportResult(result);
      setActiveJobId(result.jobId ?? null);
      notifications.show({
        title: "Import Started",
        message: `Importing records safely into ${targetMeta.label}...`,
        color: "teal",
      });
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      notifications.show({
        title: "Import Error",
        message,
        color: "red",
      });
    } finally {
      setImporting(false);
    }
  }

  async function handleDryRunPreview() {
    setPreviewing(true);
    setError(null);
    try {
      const result = await executeImport(buildRequest(true));
      setPreview(result);
      notifications.show({
        title: "Verification Passed",
        message: `${(result.productsImported || result.customersImported || result.itemsImported)} records verified clean.`,
        color: "green",
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleRollback() {
    if (!importResult?.jobId) return;
    setRollingBack(true);
    setError(null);
    try {
      const res = await rollbackImport(importResult.jobId);
      setRollbackResult(res);
      loadJobs();
      notifications.show({
        title: "Import Rolled Back",
        message: "All imported items were safely reverted.",
        color: "yellow",
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRollingBack(false);
    }
  }

  async function handleHistoryRollback(jobId: string) {
    setHistoryRollbackId(jobId);
    try {
      const res = await rollbackImport(jobId);
      loadJobs();
      notifications.show({
        title: "Import Rolled Back",
        message: `${res.productsDeleted + res.customersDeleted + res.suppliersDeleted} records removed.`,
        color: "yellow",
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setHistoryRollbackId(null);
    }
  }

  function handleReset() {
    setFile(null);
    setFileBytes([]);
    setAnalysis(null);
    setMappings([]);
    setPreview(null);
    setImportResult(null);
    setError(null);
    setJobProgress(0);
  }

  // Field validation checks
  const mappedFieldKeys = mappings
    .filter((m) => m.targetField !== "skip")
    .map((m) => m.targetField);
  const missingRequired = targetMeta.requiredFields.filter(
    (field) => !mappedFieldKeys.includes(field)
  );

  return (
    <Stack gap="lg" data-tour="import-wizard" style={{ maxWidth: 1100, margin: "0 auto", paddingBottom: 40 }}>
      {/* Top Header & Navigation */}
      <Group justify="space-between" align="center" wrap="wrap">
        <Stack gap={3}>
          <Group gap={10} align="center">
            <Box
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: "color-mix(in srgb, var(--app-accent) 15%, transparent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--app-accent)",
              }}
            >
              <FileSpreadsheet size={20} />
            </Box>
            <div>
              <Title order={3} style={{ color: "var(--app-text)", letterSpacing: -0.3 }}>
                Smart Excel & CSV Import
              </Title>
              <Text size="xs" c="dimmed">
                Fast, automated catalog import for Pakistani retail and wholesale businesses
              </Text>
            </div>
          </Group>
        </Stack>

        <Group gap="sm">
          <SegmentedControl
            size="xs"
            value={activeTab}
            onChange={(val) => setActiveTab(val as "import" | "history")}
            data={[
              { label: "📥 Import Data", value: "import" },
              {
                label: `📜 History (${importJobs.length})`,
                value: "history",
              },
            ]}
          />
          <Button
            variant="subtle"
            color="gray"
            size="sm"
            leftSection={<ArrowLeft size={15} />}
            onClick={() => {
              reportOnboardingEvent({ type: "wizard-closed" });
              onComplete();
            }}
          >
            {backLabel}
          </Button>
        </Group>
      </Group>

      {/* ERROR BANNER */}
      {error && (
        <Alert
          color="red"
          variant="light"
          icon={<AlertTriangle size={18} />}
          withCloseButton
          onClose={() => setError(null)}
        >
          <Text size="sm" fw={600}>{error}</Text>
        </Alert>
      )}

      {/* =====================================================================
          TAB 1: SMART IMPORT WORKFLOW
         ===================================================================== */}
      {activeTab === "import" && (
        <Stack gap="md">
          {/* Target Selector Bar */}
          {!importResult && !activeJobId && (
            <Card withBorder padding="sm" radius="md" style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}>
              <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.8 }}>
                  Importing:
                </Text>
                <Group gap={6} wrap="wrap">
                  {TARGETS.map((t) => {
                    const active = target === t.value;
                    return (
                      <Button
                        key={t.value}
                        size="xs"
                        variant={active ? "filled" : "subtle"}
                        color={active ? "dark" : "gray"}
                        leftSection={t.icon}
                        onClick={() => handleTargetChange(t.value)}
                        style={{
                          borderRadius: 8,
                          backgroundColor: active ? "var(--app-accent)" : undefined,
                          color: active ? "#ffffff" : "var(--app-text)",
                          fontWeight: active ? 700 : 500,
                        }}
                      >
                        {t.label}
                      </Button>
                    );
                  })}
                </Group>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="blue"
                  leftSection={<Download size={13} />}
                  onClick={() => downloadSampleCsv(target)}
                >
                  Download Sample CSV
                </Button>
              </Group>
            </Card>
          )}

          {/* ACTIVE IMPORT PROGRESS STATE */}
          {activeJobId && (
            <Card withBorder padding="xl" radius="md" style={{ background: "var(--app-surface)", textAlign: "center" }}>
              <Stack align="center" gap="md" py="xl">
                <Loader size={44} color="var(--app-accent)" />
                <Title order={4} style={{ color: "var(--app-text)" }}>
                  Importing {targetMeta.label}...
                </Title>
                <Text size="sm" c="dimmed">
                  Please keep this window open. Validating and writing records to database ({jobProgress}%).
                </Text>
                <Progress
                  value={jobProgress}
                  size="md"
                  radius="xl"
                  color="var(--app-accent)"
                  w="100%"
                  maw={460}
                  animated
                />
              </Stack>
            </Card>
          )}

          {/* SUCCESS RESULT STATE */}
          {!activeJobId && importResult && (
            <Card withBorder padding="xl" radius="md" style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}>
              <Stack gap="lg" align="center" ta="center">
                <Box
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 999,
                    background: "color-mix(in srgb, #1E8E5A 18%, transparent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: INK.success,
                  }}
                >
                  <CheckCircle2 size={36} />
                </Box>

                <div>
                  <Title order={3} style={{ color: "var(--app-text)" }}>
                    Import Successfully Completed!
                  </Title>
                  <Text size="sm" c="dimmed" mt={4}>
                    Your {targetMeta.noun} have been safely processed and added to your catalog.
                  </Text>
                </div>

                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" w="100%" maw={600}>
                  <Card withBorder padding="md" radius="md" style={{ background: "var(--app-surface)" }}>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">Imported</Text>
                    <Title order={2} style={{ ...LEDGER_NUM, color: INK.success }}>
                      {(importResult.productsImported || importResult.customersImported || importResult.itemsImported)}
                    </Title>
                  </Card>
                  <Card withBorder padding="md" radius="md" style={{ background: "var(--app-surface)" }}>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">Skipped (Existed)</Text>
                    <Title order={2} style={{ ...LEDGER_NUM, color: importResult.rowsSkipped > 0 ? INK.gold : INK.muted }}>
                      {importResult.rowsSkipped}
                    </Title>
                  </Card>
                  <Card withBorder padding="md" radius="md" style={{ background: "var(--app-surface)" }}>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">Errors</Text>
                    <Title order={2} style={{ ...LEDGER_NUM, color: importResult.rowsWithErrors > 0 ? INK.danger : INK.muted }}>
                      {importResult.rowsWithErrors}
                    </Title>
                  </Card>
                </SimpleGrid>

                {importResult.errors.length > 0 && (
                  <Alert color="red" variant="light" icon={<XCircle size={16} />} w="100%" maw={640} ta="left">
                    <Text fw={600} size="sm" mb={6}>
                      {importResult.rowsWithErrors} row(s) had formatting issues:
                    </Text>
                    <ScrollArea h={120}>
                      <Stack gap={4}>
                        {importResult.errors.map((err, i) => (
                          <Text size="xs" key={i}>
                            • Row {err.rowNumber}: {err.reason}
                          </Text>
                        ))}
                      </Stack>
                    </ScrollArea>
                  </Alert>
                )}

                {/* Rollback safety box */}
                {importResult.jobId && (
                  <Alert
                    color={rollbackResult ? "yellow" : "gray"}
                    variant="light"
                    icon={<Info size={16} />}
                    w="100%"
                    maw={640}
                    ta="left"
                  >
                    <Group justify="space-between" align="center" wrap="wrap">
                      <Stack gap={2}>
                        <Text fw={600} size="sm">
                          {rollbackResult ? "Import Rolled Back" : "Safe 24-Hour Rollback"}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {rollbackResult
                            ? "All records from this import have been completely removed from the catalog."
                            : "Made a mistake or imported wrong file? You can revert this import entirely."}
                        </Text>
                      </Stack>
                      {!rollbackResult && (
                        <Button
                          size="xs"
                          variant="outline"
                          color="red"
                          loading={rollingBack}
                          leftSection={<Undo2 size={13} />}
                          onClick={handleRollback}
                        >
                          Undo This Import
                        </Button>
                      )}
                    </Group>
                  </Alert>
                )}

                <Group justify="center" gap="md" mt="md">
                  <Button
                    variant="default"
                    size="md"
                    onClick={handleReset}
                  >
                    Import Another File
                  </Button>
                  <Button
                    size="md"
                    style={{ backgroundColor: "var(--app-accent)", color: "#fff" }}
                    rightSection={<ArrowRight size={16} />}
                    onClick={() => {
                      reportOnboardingEvent({ type: "import-completed" });
                      onComplete();
                    }}
                  >
                    View in Inventory
                  </Button>
                </Group>
              </Stack>
            </Card>
          )}

          {/* STAGE 1: SMART DROPZONE (When no file is analyzed yet) */}
          {!activeJobId && !importResult && !analysis && (
            <Card
              withBorder
              padding={0}
              radius="lg"
              style={{
                background: "var(--app-surface)",
                borderColor: isDragging ? "var(--app-accent)" : "var(--app-border)",
                borderWidth: isDragging ? 2 : 1,
                transition: "all 150ms ease",
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleFileSelect(e.dataTransfer.files[0]);
                }
              }}
            >
              <Box
                p={48}
                style={{
                  textAlign: "center",
                  cursor: "pointer",
                  background: isDragging
                    ? "color-mix(in srgb, var(--app-accent) 8%, var(--app-surface))"
                    : "transparent",
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  accept=".xlsx,.xls,.csv,.docx,.pdf,.png,.jpg,.jpeg"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />

                <Stack align="center" gap="md">
                  <Box
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 999,
                      background: "color-mix(in srgb, var(--app-accent) 12%, transparent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--app-accent)",
                    }}
                  >
                    {analyzing ? <Loader size={32} color="var(--app-accent)" /> : <Upload size={30} />}
                  </Box>

                  <div>
                    <Text fw={700} size="lg" style={{ color: "var(--app-text)" }}>
                      {analyzing ? "Scanning your file..." : "Drop your Excel or CSV file here"}
                    </Text>
                    <Text size="sm" c="dimmed" mt={4} maw={460} mx="auto">
                      {analyzing
                        ? "Matching columns and extracting item data automatically..."
                        : "Click to browse from your computer or drag and drop your spreadsheet. We automatically detect your columns."}
                    </Text>
                  </div>

                  <Group gap={8} wrap="wrap" justify="center">
                    <Badge variant="light" color="blue" size="sm">Excel (.xlsx, .xls)</Badge>
                    <Badge variant="light" color="teal" size="sm">CSV (.csv)</Badge>
                    <Badge variant="light" color="gray" size="sm">Word Tables (.docx)</Badge>
                    <Badge variant="light" color="gray" size="sm">Scanned Invoices (PDF/Image)</Badge>
                  </Group>

                  <Button
                    size="sm"
                    variant="light"
                    color="dark"
                    leftSection={<FileSpreadsheet size={15} />}
                    style={{ marginTop: 8 }}
                  >
                    Choose Spreadsheet File
                  </Button>
                </Stack>
              </Box>
            </Card>
          )}

          {/* STAGE 2: INSTANT PREVIEW & 1-CLICK ACTION (When file is analyzed) */}
          {!activeJobId && !importResult && analysis && (
            <Stack gap="md">
              {/* File Status Strip */}
              <Card withBorder padding="md" radius="md" style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}>
                <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                  <Group gap="sm">
                    <Box
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 8,
                        background: "color-mix(in srgb, var(--app-accent) 15%, transparent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--app-accent)",
                      }}
                    >
                      <FileCheck2 size={22} />
                    </Box>
                    <div>
                      <Group gap={8}>
                        <Text fw={700} size="sm" style={{ color: "var(--app-text)" }}>
                          {file?.name}
                        </Text>
                        <Badge size="xs" variant="filled" color="dark">
                          {fileType.toUpperCase()}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed" style={LEDGER_NUM}>
                        {analysis.totalRows.toLocaleString()} rows detected • {analysis.headers.length} columns found
                      </Text>
                    </div>
                  </Group>

                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      onClick={handleReset}
                    >
                      Choose Different File
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="blue"
                      leftSection={<Settings2 size={14} />}
                      rightSection={showAdvancedMapping ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      onClick={() => setShowAdvancedMapping(!showAdvancedMapping)}
                    >
                      {showAdvancedMapping ? "Hide Column Settings" : "Adjust Columns"}
                    </Button>
                  </Group>
                </Group>
              </Card>

              {/* Missing Required Fields Alert with Quick Fix */}
              {missingRequired.length > 0 && (
                <Alert
                  color="yellow"
                  variant="light"
                  icon={<AlertTriangle size={18} />}
                  title="Required column mapping needed"
                >
                  <Text size="sm" mb="xs">
                    The system needs to know which column represents the required field:{" "}
                    <strong>{missingRequired.join(", ")}</strong>.
                  </Text>
                  <Group gap="md" wrap="wrap">
                    {missingRequired.map((field) => (
                      <Group key={field} gap="xs">
                        <Text size="xs" fw={700}>
                          {field === "name" ? "Product Name" : field === "sku" ? "SKU / Code" : field}:
                        </Text>
                        <Select
                          size="xs"
                          placeholder="Select spreadsheet column"
                          data={analysis.headers.map((h, i) => ({
                            value: String(i),
                            label: `${h} (Column ${String.fromCharCode(65 + i)})`,
                          }))}
                          onChange={(val) => {
                            if (val !== null) {
                              const idx = parseInt(val, 10);
                              updateMapping(idx, field);
                            }
                          }}
                        />
                      </Group>
                    ))}
                  </Group>
                </Alert>
              )}

              {/* Live 3-Row Item Cards Preview */}
              <Box>
                <Group justify="space-between" align="center" mb={8}>
                  <Group gap={6}>
                    <Sparkles size={16} color="var(--app-accent)" />
                    <Text fw={700} size="sm" style={{ color: "var(--app-text)" }}>
                      Live Preview (First 3 items from your file)
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Verifying format before writing to catalog
                  </Text>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                  {analysis.sampleRows.slice(0, 3).map((row, idx) => {
                    const getVal = (fieldName: string) => {
                      const m = mappings.find((item) => item.targetField === fieldName);
                      if (!m) return null;
                      if (m.manualValue) return m.manualValue;
                      return row[m.sourceIndex] || null;
                    };

                    const name =
                      getVal("name") ||
                      getVal("customer_name") ||
                      getVal("supplier_name") ||
                      `Item #${idx + 1}`;
                    const sku =
                      getVal("sku") ||
                      getVal("invoice_number") ||
                      getVal("po_number") ||
                      "—";
                    const cost = parseFloat(getVal("cost_price") || "0") || 0;
                    const sell = parseFloat(getVal("sell_price") || "0") || 0;
                    const qty = getVal("quantity_in_stock") || getVal("quantity") || "0";
                    const unit = getVal("unit") || "pcs";
                    const cat = getVal("category") || getVal("contact_person") || null;
                    const expiry = getVal("expiry_date") || null;

                    return (
                      <Card
                        key={idx}
                        padding="md"
                        radius="md"
                        style={{
                          background: "var(--app-surface)",
                          borderColor: "var(--app-border)",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                        }}
                        withBorder
                      >
                        <Stack gap={6}>
                          <Group justify="space-between" align="flex-start" wrap="nowrap">
                            <Text fw={700} size="sm" lineClamp={1} style={{ color: "var(--app-text)" }}>
                              {name}
                            </Text>
                            <Badge size="xs" variant="outline" color="gray" style={LEDGER_NUM}>
                              {sku}
                            </Badge>
                          </Group>

                          {cat && (
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {cat}
                            </Text>
                          )}

                          <Group justify="space-between" align="center" mt={4}>
                            <Text size="xs" c="dimmed">
                              Stock:{" "}
                              <Text component="span" fw={600} style={LEDGER_NUM}>
                                {qty} {unit}
                              </Text>
                            </Text>
                            {sell > 0 && (
                              <Text size="xs" fw={700} style={{ ...LEDGER_NUM, color: "var(--app-accent)" }}>
                                Rs. {sell.toLocaleString()}
                              </Text>
                            )}
                          </Group>

                          {cost > 0 && sell > 0 && (
                            <Group justify="space-between" align="center">
                              <Text size="xs" c="dimmed" style={LEDGER_NUM}>
                                Cost: Rs. {cost.toLocaleString()}
                              </Text>
                              <Badge
                                size="xs"
                                color={sell >= cost ? "green" : "red"}
                                variant="light"
                              >
                                {sell >= cost
                                  ? `+${(((sell - cost) / cost) * 100).toFixed(0)}%`
                                  : "Loss"}
                              </Badge>
                            </Group>
                          )}

                          {expiry && (
                            <Text size="xs" c="dimmed">
                              Exp: <Text component="span" fw={500}>{expiry}</Text>
                            </Text>
                          )}
                        </Stack>
                      </Card>
                    );
                  })}
                </SimpleGrid>
              </Box>

              {/* COLLAPSIBLE ADVANCED MAPPINGS DRAWER */}
              <Collapse expanded={showAdvancedMapping}>
                <Card withBorder padding="md" radius="md" style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}>
                  <Stack gap="md">
                    <Group justify="space-between" align="center" wrap="wrap">
                      <div>
                        <Text fw={700} size="sm" style={{ color: "var(--app-text)" }}>
                          Column Matching Details
                        </Text>
                        <Text size="xs" c="dimmed">
                          Match your spreadsheet columns with ERP fields. Unneeded columns can be skipped.
                        </Text>
                      </div>
                      <Group gap="xs" wrap="wrap">
                        {templates.length > 0 && (
                          <Group gap={4}>
                            <Select
                              size="xs"
                              placeholder="Apply Saved Template"
                              data={templates.map((t) => ({ value: t.id, label: t.templateName }))}
                              onChange={(id) => {
                                const tpl = templates.find((t) => t.id === id);
                                if (tpl) applyTemplate(tpl);
                              }}
                            />
                            {templates.slice(0, 2).map((t) => (
                              <Badge
                                key={t.id}
                                size="xs"
                                variant="light"
                                color="gray"
                                style={{ cursor: "pointer" }}
                                rightSection={
                                  <span
                                    role="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteTemplate(t);
                                    }}
                                  >
                                    ×
                                  </span>
                                }
                              >
                                {t.templateName}
                              </Badge>
                            ))}
                          </Group>
                        )}
                        <Button
                          size="xs"
                          variant="light"
                          color="blue"
                          leftSection={<Plus size={13} />}
                          onClick={addManualField}
                        >
                          Add Fixed Value
                        </Button>
                      </Group>
                    </Group>

                    <ScrollArea.Autosize mah={320}>
                      <Table striped highlightOnHover withTableBorder verticalSpacing="xs">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th style={{ width: 40 }}>#</Table.Th>
                            <Table.Th>Spreadsheet Header</Table.Th>
                            <Table.Th>Mapped To Field</Table.Th>
                            <Table.Th>Sample Content</Table.Th>
                            <Table.Th style={{ width: 40 }} />
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {mappings.map((m, idx) => {
                            const isManual = m.confidence === "manual";
                            return (
                              <Table.Tr key={idx}>
                                <Table.Td>
                                  <Text size="xs" c="dimmed" style={LEDGER_NUM}>
                                    {isManual ? "＋" : String.fromCharCode(65 + idx)}
                                  </Text>
                                </Table.Td>
                                <Table.Td>
                                  {isManual ? (
                                    <TextInput
                                      size="xs"
                                      placeholder="Field label"
                                      value={m.sourceColumn}
                                      onChange={(e) => {
                                        const val = e.currentTarget.value;
                                        setMappings((prev) => {
                                          const next = [...prev];
                                          next[idx] = { ...next[idx], sourceColumn: val };
                                          return next;
                                        });
                                      }}
                                    />
                                  ) : (
                                    <Text fw={600} size="xs" style={{ color: "var(--app-text)" }}>
                                      {m.sourceColumn}
                                    </Text>
                                  )}
                                </Table.Td>
                                <Table.Td>
                                  <Stack gap={4}>
                                    <Select
                                      size="xs"
                                      data={TARGET_FIELD_OPTIONS[target]}
                                      value={
                                        m.targetField === "skip"
                                          ? "skip"
                                          : m.fieldCategory === "custom"
                                            ? "custom"
                                            : m.targetField
                                      }
                                      onChange={(val) => val && updateMapping(idx, val)}
                                    />
                                    {m.fieldCategory === "custom" && !isManual && (
                                      <TextInput
                                        size="xs"
                                        placeholder="Custom field key"
                                        value={customNames[idx] ?? ""}
                                        onChange={(e) => updateCustomName(idx, e.currentTarget.value)}
                                      />
                                    )}
                                  </Stack>
                                </Table.Td>
                                <Table.Td>
                                  {isManual ? (
                                    <TextInput
                                      size="xs"
                                      placeholder="Value for every row"
                                      value={m.manualValue ?? ""}
                                      onChange={(e) => {
                                        const val = e.currentTarget.value;
                                        setMappings((prev) => {
                                          const next = [...prev];
                                          next[idx] = { ...next[idx], manualValue: val };
                                          return next;
                                        });
                                      }}
                                    />
                                  ) : (
                                    <Text size="xs" c="dimmed" lineClamp={1} style={LEDGER_NUM}>
                                      {analysis.sampleRows
                                        .map((r) => r[m.sourceIndex] ?? "")
                                        .filter(Boolean)
                                        .slice(0, 2)
                                        .join(", ")}
                                    </Text>
                                  )}
                                </Table.Td>
                                <Table.Td>
                                  {isManual && (
                                    <Button
                                      size="compact-xs"
                                      variant="subtle"
                                      color="red"
                                      onClick={() => removeMapping(idx)}
                                    >
                                      <Trash2 size={13} />
                                    </Button>
                                  )}
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea.Autosize>

                    <Divider />

                    {/* Secondary settings */}
                    <SimpleGrid cols={{ base: 1, sm: adapters.length > 0 ? 3 : 2 }} spacing="md">
                      <Select
                        label="Duplicate Handling"
                        description="Action when SKU or item name already exists"
                        data={CONFLICT_OPTIONS}
                        value={conflictStrategy}
                        onChange={(v) => v && setConflictStrategy(v as ConflictStrategy)}
                        size="xs"
                      />
                      {adapters.length > 0 && (
                        <Select
                          label="ERP Column Presets (Optional)"
                          description="Match known accounting software formats"
                          data={adapters.map((a) => ({ value: a.key, label: a.label ?? a.key }))}
                          value={adapter || null}
                          onChange={(v) => {
                            setAdapter(v ?? "");
                            if (fileBytes.length > 0 && fileType) {
                              runAnalyzeWithBytes(fileBytes, fileType, target);
                            }
                          }}
                          clearable
                          size="xs"
                        />
                      )}
                      <TextInput
                        label="Save as Template (Optional)"
                        placeholder="e.g. My Supplier Format"
                        description="Remembers column positions for your next import"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.currentTarget.value)}
                        size="xs"
                      />
                    </SimpleGrid>
                  </Stack>
                </Card>
              </Collapse>

              {/* ACTION BAR: 1-Click Import & Dry Run */}
              <Card withBorder padding="md" radius="md" style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}>
                <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                  <Stack gap={2}>
                    <Text fw={700} size="sm" style={{ color: "var(--app-text)" }}>
                      Ready to import {analysis.totalRows.toLocaleString()} {targetMeta.noun}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {missingRequired.length === 0
                        ? "All required fields are matched. Click import to add items to your catalog."
                        : `Please map ${missingRequired.join(", ")} before continuing.`}
                    </Text>
                  </Stack>

                  <Group gap="sm">
                    <Button
                      variant="outline"
                      color="gray"
                      size="md"
                      loading={previewing}
                      onClick={handleDryRunPreview}
                    >
                      Test Dry Run
                    </Button>
                    <Button
                      size="md"
                      disabled={missingRequired.length > 0}
                      loading={importing}
                      leftSection={<Rocket size={18} />}
                      style={{
                        backgroundColor: "var(--app-accent)",
                        color: "#fff",
                        fontWeight: 700,
                        paddingLeft: 22,
                        paddingRight: 22,
                      }}
                      onClick={handleExecuteSmartImport}
                    >
                      Import {analysis.totalRows.toLocaleString()} {targetMeta.label} Now
                    </Button>
                  </Group>
                </Group>
              </Card>

              {/* Dry Run Preview Results (if run) */}
              {preview && (
                <Alert color="teal" variant="light" icon={<CheckCircle2 size={18} />}>
                  <Text fw={600} size="sm">
                    Verification Results: Ready to import {(preview.productsImported || preview.customersImported || preview.itemsImported)} records cleanly.
                  </Text>
                  <Text size="xs" mt={2}>
                    {preview.rowsSkipped} duplicates will be skipped. {preview.rowsWithErrors} rows with invalid numbers/dates.
                  </Text>
                </Alert>
              )}
            </Stack>
          )}
        </Stack>
      )}

      {/* =====================================================================
          TAB 2: RECENT IMPORTS & ROLLBACK AUDIT
         ===================================================================== */}
      {activeTab === "history" && (
        <Card withBorder padding="lg" radius="md" style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}>
          <Group justify="space-between" align="center" mb="md">
            <div>
              <Text fw={700} size="md" style={{ color: "var(--app-text)" }}>
                Import History & Safety Rollback
              </Text>
              <Text size="xs" c="dimmed">
                Every imported batch can be cleanly reverted within 24 hours.
              </Text>
            </div>
            <Button
              size="xs"
              variant="light"
              leftSection={<RefreshCw size={13} />}
              loading={jobsLoading}
              onClick={loadJobs}
            >
              Refresh
            </Button>
          </Group>

          {importJobs.length === 0 ? (
            <Box py={36} ta="center">
              <Text size="sm" c="dimmed">
                No past imports recorded yet. When you import files, they will appear here.
              </Text>
            </Box>
          ) : (
            <ScrollArea>
              <Table withTableBorder verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Spreadsheet / File</Table.Th>
                    <Table.Th>Target</Table.Th>
                    <Table.Th>Imported</Table.Th>
                    <Table.Th>Errors</Table.Th>
                    <Table.Th>Date & Time</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Action</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {importJobs.map((job) => {
                    const isRolling = historyRollbackId === job.id;
                    const statusColor =
                      job.status === "completed"
                        ? "green"
                        : job.status === "rolled_back"
                          ? "yellow"
                          : "blue";

                    return (
                      <Table.Tr key={job.id}>
                        <Table.Td>
                          <Text fw={600} size="sm" style={{ color: "var(--app-text)" }}>
                            {job.fileName ?? "Import file"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color="dark" size="sm">
                            {job.fileType}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" style={LEDGER_NUM} fw={600}>
                            {job.importedRecords}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text
                            size="sm"
                            style={{
                              ...LEDGER_NUM,
                              color: job.errorRows > 0 ? INK.danger : INK.muted,
                            }}
                          >
                            {job.errorRows}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {new Date(job.createdAt).toLocaleString()}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge color={statusColor} variant="light" size="sm">
                            {job.status.replace("_", " ")}
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right">
                          {job.rollbackAvailable && (
                            <Tooltip label="Remove all records created by this file run">
                              <Button
                                size="compact-xs"
                                variant="outline"
                                color="red"
                                leftSection={<Undo2 size={12} />}
                                loading={isRolling}
                                disabled={jobsLoading}
                                onClick={() => handleHistoryRollback(job.id)}
                              >
                                Roll back
                              </Button>
                            </Tooltip>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Card>
      )}
    </Stack>
  );
}
