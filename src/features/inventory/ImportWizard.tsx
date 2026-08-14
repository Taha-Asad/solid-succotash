// ==========================================
// IMPORT WIZARD — Schema Discovery Engine
// ==========================================
//
// This is not just "import products from Excel."
// This is the system that ONBOARDS a company by learning
// how they currently organize their business data.
//
// Steps:
//   1. Upload — user picks their .xlsx or .csv file
//   2. Analyze — Rust reads headers, proposes field mappings
//   3. Map — user reviews and adjusts the mapping
//   4. Confirm — preview + import
//   5. Result — what was created/imported
//
// ---- Visual identity ----
// Matches DashboardPage / InventoryPage: navy for structure, gold for
// the moments that matter (the active step, the final import action,
// the success state), tabular monospace for counts and sample data.
// Motion is used deliberately, not scattered: each step fades/slides
// in once when it becomes active, the "Analyze" step gets a rotating
// status line so the wait doesn't feel dead, and the result checkmark
// gets a single pop-in. Everything respects prefers-reduced-motion.

import { useEffect, useState } from "react";

import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";

import { reportOnboardingEvent } from "../../onboarding/bus";

import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  FileInput,
  Group,
  List,
  Loader,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Table,
  Text,
  TextInput,
  Title,
  ScrollArea,
} from "@mantine/core";

import {
  Upload,
  FileSpreadsheet,
  ScanSearch,
  ArrowLeftRight,
  ClipboardCheck,
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
  History,
  RefreshCw,
  Undo2,
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
// IMPORT TARGETS (spec §23 "Import Wizard")
// ==========================================

const IMPORT_TARGETS: {
  value: ImportTarget;
  label: string;
  description: string;
}[] = [
  {
    value: "products",
    label: "Products",
    description: "SKU, name, prices, stock, categories and suppliers",
  },
  {
    value: "customers",
    label: "Customers",
    description: "Name, phone, address, CNIC / NTN and buyer type",
  },
  {
    value: "suppliers",
    label: "Suppliers",
    description: "Name, contact person, phone, email and tax number",
  },
  {
    value: "opening_stock",
    label: "Opening Stock",
    description: "Match products by SKU and add starting quantities",
  },
  {
    value: "invoices",
    label: "Sales Invoices",
    description: "Historical invoices: number, date, customer, items and totals",
  },
  {
    value: "purchase_bills",
    label: "Purchase Bills",
    description: "Historical purchases: PO number, supplier, items and totals",
  },
];

// Fallback payload if a terminal event ever arrives without a result.
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

// Per-target mapping vocabulary for the "Maps To" dropdown.
const TARGET_FIELD_OPTIONS: Record<ImportTarget, { value: string; label: string }[]> = {
  products: [
    { value: "name", label: "Product Name (core)" },
    { value: "sku", label: "SKU / Item Code (core)" },
    { value: "cost_price", label: "Cost Price (core)" },
    { value: "sell_price", label: "Sell Price (core)" },
    { value: "quantity_in_stock", label: "Quantity / Stock (core)" },
    { value: "unit", label: "Unit of Measure (core)" },
    { value: "expiry_date", label: "Expiry Date (core)" },
    { value: "category", label: "Category (core)" },
    { value: "supplier", label: "Supplier (core)" },
    { value: "tax_rate", label: "Tax Rate (core)" },
    { value: "skip", label: "Skip this column" },
    { value: "custom", label: "Custom field (enter name below)" },
  ],
  customers: [
    { value: "customer_name", label: "Customer Name (core)" },
    { value: "email", label: "Email (core)" },
    { value: "phone", label: "Phone (core)" },
    { value: "address", label: "Address (core)" },
    { value: "cnic", label: "CNIC (core)" },
    { value: "ntn", label: "NTN (core)" },
    { value: "strn", label: "STRN (core)" },
    { value: "buyer_type", label: "Buyer Type (core)" },
    { value: "skip", label: "Skip this column" },
  ],
  suppliers: [
    { value: "supplier_name", label: "Supplier Name (core)" },
    { value: "contact_person", label: "Contact Person (core)" },
    { value: "email", label: "Email (core)" },
    { value: "phone", label: "Phone (core)" },
    { value: "address", label: "Address (core)" },
    { value: "tax_number", label: "Tax / NTN Number (core)" },
    { value: "skip", label: "Skip this column" },
  ],
  opening_stock: [
    { value: "sku", label: "SKU / Item Code (core)" },
    { value: "name", label: "Product Name (optional, for messages)" },
    { value: "quantity", label: "Opening Quantity (core)" },
    { value: "cost_price", label: "Cost Price (core)" },
    { value: "expiry_date", label: "Expiry Date (core)" },
    { value: "skip", label: "Skip this column" },
  ],
  invoices: [
    { value: "invoice_number", label: "Invoice Number (core)" },
    { value: "invoice_date", label: "Invoice Date (core)" },
    { value: "customer_name", label: "Customer Name (core)" },
    { value: "product_sku", label: "Product / Item (line)" },
    { value: "quantity", label: "Quantity (line)" },
    { value: "unit_price", label: "Unit Price (line)" },
    { value: "tax_rate", label: "Tax Rate % (line)" },
    { value: "discount", label: "Discount % (line)" },
    { value: "total_amount", label: "Total Amount (summary)" },
    { value: "amount_paid", label: "Amount Paid" },
    { value: "status", label: "Status" },
    { value: "due_date", label: "Due Date" },
    { value: "po_number", label: "Customer PO / Order No" },
    { value: "reference_note", label: "Reference / Notes" },
    { value: "skip", label: "Skip this column" },
  ],
  purchase_bills: [
    { value: "po_number", label: "PO / Bill Number (core)" },
    { value: "po_date", label: "PO / Bill Date (core)" },
    { value: "supplier_name", label: "Supplier Name (core)" },
    { value: "product_sku", label: "Product / Item (line)" },
    { value: "quantity", label: "Quantity (line)" },
    { value: "unit_cost", label: "Unit Cost (line)" },
    { value: "tax_rate", label: "Tax Rate % (line)" },
    { value: "total_amount", label: "Total Amount (summary)" },
    { value: "amount_paid", label: "Amount Paid" },
    { value: "status", label: "Status" },
    { value: "expected_date", label: "Expected Date" },
    { value: "expiry_date", label: "Expiry Date (line)" },
    { value: "reference_note", label: "Reference / Notes" },
    { value: "skip", label: "Skip this column" },
  ],
};

// Fields that must be supplied by the file, per target.
const REQUIRED_FIELDS: Record<ImportTarget, string[]> = {
  products: ["name", "sku"],
  customers: ["customer_name"],
  suppliers: ["supplier_name"],
  opening_stock: ["sku"],
  invoices: ["invoice_number", "customer_name"],
  purchase_bills: ["po_number", "supplier_name"],
};

// Labels used in the confirm/result steps.
const TARGET_LABELS: Record<ImportTarget, { noun: string; stat: string }> = {
  products: { noun: "products", stat: "Products Imported" },
  customers: { noun: "customers", stat: "Customers Imported" },
  suppliers: { noun: "suppliers", stat: "Suppliers Imported" },
  opening_stock: { noun: "opening stock rows", stat: "Stock Lines Applied" },
  invoices: { noun: "invoices", stat: "Invoices Imported" },
  purchase_bills: { noun: "purchase bills", stat: "Purchase Bills Imported" },
};

const CONFLICT_OPTIONS = [
  { value: "skip", label: "Skip existing records" },
  { value: "overwrite", label: "Overwrite existing records" },
  { value: "suffix", label: "Add as new (suffix -1, -2…)" },
];

// ==========================================
// DESIGN TOKENS — shared, defined in src/theme.ts
// ==========================================

const LEDGER_NUM: React.CSSProperties = {
  fontFamily:
    'ui-monospace, "SF Mono", "Roboto Mono", "JetBrains Mono", Menlo, monospace',
  fontVariantNumeric: "tabular-nums",
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="xs"
      fw={700}
      style={{
        color: INK.goldDeep,
        letterSpacing: 1.4,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
}

// Scoped animation styles, injected once. Respects reduced-motion.
function WizardStyles() {
  return (
    <style>{`
      @keyframes wiz-fade-up {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes wiz-pop {
        0% { opacity: 0; transform: scale(0.7); }
        70% { opacity: 1; transform: scale(1.08); }
        100% { opacity: 1; transform: scale(1); }
      }
      @keyframes wiz-pulse-ring {
        0% { box-shadow: 0 0 0 0 rgba(184,134,60,0.35); }
        100% { box-shadow: 0 0 0 14px rgba(184,134,60,0); }
      }
      @keyframes wiz-shimmer {
        0% { background-position: 0% 50%; }
        100% { background-position: 200% 50%; }
      }
      .wiz-step-enter {
        animation: wiz-fade-up 320ms ease both;
      }
      .wiz-row-enter {
        animation: wiz-fade-up 260ms ease both;
      }
      .wiz-pop-in {
        animation: wiz-pop 480ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
      }
      .wiz-dropzone {
        transition: border-color 150ms ease, background-color 150ms ease;
      }
      .wiz-dropzone:hover {
        border-color: ${INK.gold} !important;
        background-color: ${INK.goldSoft} !important;
      }
      .wiz-scan-icon {
        animation: wiz-pulse-ring 1.6s ease-out infinite;
      }
      .wiz-shimmer-bar > div {
        background-image: linear-gradient(90deg, ${INK.navy} 0%, ${INK.gold} 50%, ${INK.navy} 100%);
        background-size: 200% 100%;
        animation: wiz-shimmer 1.4s linear infinite;
      }
      .wiz-glow-bar {
        height: 4px;
        border-radius: 999px;
        background-image: linear-gradient(90deg, ${INK.navy} 0%, ${INK.gold} 50%, ${INK.navy} 100%);
        background-size: 200% 100%;
        animation: wiz-shimmer 2.6s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .wiz-step-enter, .wiz-row-enter, .wiz-pop-in, .wiz-scan-icon, .wiz-shimmer-bar > div, .wiz-glow-bar {
          animation: none !important;
        }
      }
    `}</style>
  );
}

// ==========================================
// PROPS
// ==========================================

interface ImportWizardProps {
  user: PublicUser;
  onComplete: () => void; // called when wizard finishes (refresh product list)
  /** Label for the back action in the header (defaults to "Back to Inventory"). */
  backLabel?: string;
}

// ==========================================
// CORE FIELD OPTIONS (what the dropdown shows)
// ==========================================

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "green",
  medium: "yellow",
  low: "orange",
  unknown: "gray",
  manual: "blue",
};

// Rotating status line shown while the "Analyze" step is active —
// gives the wait a sense of progress instead of a static spinner.
const ANALYZE_MESSAGES = [
  "Reading column headers…",
  "Detecting data types…",
  "Matching columns to known fields…",
  "Sampling rows for preview…",
];

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function ImportWizard({
  user: _user,
  onComplete,
  backLabel = "Back to Inventory",
}: ImportWizardProps) {
  const [activeStep, setActiveStep] = useState(0);

  // Import target (products / customers / suppliers / opening stock)
  const [target, setTarget] = useState<ImportTarget>("products");

  // ERP adapter used for header mapping (spec §23.11). When empty, generic
  // header detection runs; the saved-template auto-map (§23.5) is skipped
  // whenever an adapter is pinned.
  const [adapters, setAdapters] = useState<ErpAdapterInfo[]>([]);
  const [adapter, setAdapter] = useState<string>("");

  // Saved per-target templates (§23.5) powering the template picker.
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);

  // Step 1: File upload
  const [file, setFile] = useState<File | null>(null);
  const [fileBytes, setFileBytes] = useState<number[]>([]);
  const [fileType, setFileType] = useState<string>("");

  // Step 2: Analysis
  const [analysis, setAnalysis] = useState<FileAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsgIndex, setAnalyzeMsgIndex] = useState(0);

  // Step 3: Mapping
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [customNames, setCustomNames] = useState<Record<number, string>>({});

  // Step 3/4: Import
  const [templateName, setTemplateName] = useState("");
  const [conflictStrategy, setConflictStrategy] =
    useState<ConflictStrategy>("skip");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  // Live tracking of the background import job started by confirm_import.
  // The Rust worker PUSHES progress via Tauri events (`import:progress` /
  // `import:complete`, spec §23.8); a light `get_import_job` re-sync is kept
  // as a safety net for events that arrive before the listeners register.
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [rollbackResult, setRollbackResult] = useState<RollbackResult | null>(
    null,
  );
  const [rollingBack, setRollingBack] = useState(false);

  // Import history (recent runs, with rollback where available)
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [historyRollbackId, setHistoryRollbackId] = useState<string | null>(
    null,
  );

  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    loadJobs();
  }, []);

  // Load ERP adapters once on mount (spec §23.11).
  useEffect(() => {
    listErpAdapters()
      .then(setAdapters)
      .catch(() => setAdapters([]));
  }, []);

  // Load the saved templates for the current target so the mapping step can
  // offer them in the picker (§23.5).
  async function loadTemplates() {
    try {
      setTemplates(await listImportTemplates(target));
    } catch {
      setTemplates([]);
    }
  }

  useEffect(() => {
    loadTemplates();
  }, [target]);

  // Rotate the analyzing status message while that step is showing
  useEffect(() => {
    if (activeStep !== 1) return;
    setAnalyzeMsgIndex(0);
    const id = setInterval(() => {
      setAnalyzeMsgIndex((i) => (i + 1) % ANALYZE_MESSAGES.length);
    }, 900);
    return () => clearInterval(id);
  }, [activeStep]);

  // Follow the background import job while one is running (confirm gate flow).
  // Primary channel: Tauri push events emitted by the Rust worker. Fallback:
  // a low-frequency `get_import_job` re-sync so a terminal event that fired
  // before the listeners registered still resolves to the result screen.
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

    const onComplete = (event: Event<ImportProgressEvent>) => {
      if (cancelled || event.payload.jobId !== jobId) return;
      setJobProgress(100);
      finish(event.payload.result ?? { ...emptyResult, jobId });
    };

    listen<ImportProgressEvent>(IMPORT_PROGRESS_EVENT, onProgress).then((un) => {
      if (cancelled) un();
      else unlisteners.push(un);
    });
    listen<ImportProgressEvent>(IMPORT_COMPLETE_EVENT, onComplete).then((un) => {
      if (cancelled) un();
      else unlisteners.push(un);
    });

    // Safety re-sync: cover the gap between confirm_import returning and the
    // listeners above being ready, plus any event that got dropped.
    const sync = async () => {
      try {
        const status = await getImportJob(jobId);
        if (cancelled) return;
        setJobProgress(status.job.progress);
        if (status.result) finish(status.result);
      } catch {
        if (cancelled) return;
        setActiveJobId(null);
        setError("Import tracking failed — check Recent Imports below.");
      }
    };
    sync();
    const id = setInterval(sync, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
      unlisteners.forEach((un) => un());
    };
  }, [activeJobId]);

  // ---- Step 1: Read file as bytes ----

  async function handleFileSelect(selectedFile: File | null) {
    if (!selectedFile) return;
    setFile(selectedFile);
    setError(null);

    // Detect file type from extension
    const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "xlsx" || ext === "xls") {
      setFileType("xlsx");
    } else if (ext === "csv") {
      setFileType("csv");
    } else if (ext === "docx") {
      setFileType("docx");
    } else if (ext === "pdf") {
      setFileType("pdf");
    } else if (ext === "png" || ext === "jpg" || ext === "jpeg") {
      setFileType("png");
    } else {
      setError(
        "Please upload an .xlsx, .csv, .docx, .pdf, or image (.png / .jpg) file",
      );
      return;
    }

    // Read file as ArrayBuffer → convert to number[] for Rust
    try {
      const buffer = await selectedFile.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      setFileBytes(bytes);
    } catch (err) {
      setError("Failed to read file");
    }
  }

  // ---- Step 2: Analyze file ----

  function handleTargetChange(next: ImportTarget | null) {
    if (!next) return;
    setTarget(next);
    setAdapter("");
    setAnalysis(null);
    setMappings([]);
    setPreview(null);
    setImportResult(null);
    setError(null);
  }

  async function handleAnalyze() {
    if (fileBytes.length === 0) {
      setError("No file selected");
      return;
    }

    setActiveStep(1);
    setAnalyzing(true);
    setError(null);

    try {
      const result = await analyzeImportFile({
        fileBytes,
        fileType,
        target,
        adapter: adapter || null,
      });

      setAnalysis(result);
      setMappings(result.proposedMappings);

      // Initialize custom names for columns mapped to "custom:<name>"
      const names: Record<number, string> = {};
      result.proposedMappings.forEach((m, i) => {
        if (m.targetField.startsWith("custom:")) {
          names[i] = m.targetField.replace("custom:", "");
        }
      });
      setCustomNames(names);

      setActiveStep(2);
    } catch (err) {
      setError(getErrorMessage(err));
      setActiveStep(0);
    } finally {
      setAnalyzing(false);
    }
  }

  // ---- Step 3: Update a mapping ----

  // Applies a saved template's mappings to the current file by matching
  // source columns against the analyzed headers (spec §23.5).
  function applyTemplate(template: ImportTemplate) {
    if (!analysis) return;
    const norm = (s: string) =>
      s.trim().toLowerCase().replace(/[\s\-_.]/g, "");
    const headerAt = new Map<string, number>();
    analysis.headers.forEach((h, i) => {
      const key = norm(h);
      if (!headerAt.has(key)) headerAt.set(key, i);
    });

    const next = [...mappings];
    template.columnMappings.forEach((tm) => {
      const idx = headerAt.get(norm(tm.sourceColumn));
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
    setCustomNames({});
    next.forEach((m, i) => {
      if (m.targetField.startsWith("custom:")) {
        setCustomNames((prev) => ({
          ...prev,
          [i]: m.targetField.replace("custom:", ""),
        }));
      }
    });
  }

  async function handleDeleteTemplate(template: ImportTemplate) {
    try {
      await deleteImportTemplate(template.id);
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
      notifications.show({
        title: "Template deleted",
        message: `"${template.templateName}" was removed.`,
        color: "green",
      });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function updateMapping(index: number, targetField: string) {
    setMappings((prev) => {
      const next = [...prev];
      if (targetField === "custom") {
        // User chose "custom field" — set to custom:<placeholder>
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
        setCustomNames((prev) => ({ ...prev, [index]: existingName }));
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

  // ---- Step 3: Manually added fields (not columns in the file) ----

  // Adds a field that isn't in the spreadsheet. It carries a constant
  // value applied to every imported row (e.g. "set Category = Medicines").
  function addManualField() {
    setMappings((prev) => [
      ...prev,
      {
        sourceColumn: "Manual field",
        sourceIndex: analysis?.headers.length ?? 0,
        targetField: "custom:manual_field",
        fieldCategory: "custom",
        confidence: "manual",
        manualValue: "",
      },
    ]);
  }

  function updateManualValue(index: number, value: string) {
    setMappings((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], manualValue: value };
      return next;
    });
  }

  function removeMapping(index: number) {
    setMappings((prev) => prev.filter((_, i) => i !== index));
  }

  // Is this a manual field (added in the UI rather than read from the file)?
  function isManualField(m: FieldMapping) {
    return m.confidence === "manual" || m.manualValue !== undefined;
  }

  // ---- Step 4: Preview (dry run) then execute ----

  function buildRequest(dryRun: boolean): Parameters<typeof executeImport>[0] {
    // Filter out skipped columns
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

  async function handlePreview() {
    setPreviewing(true);
    setError(null);
    setPreview(null);

    try {
      const result = await executeImport(buildRequest(true));
      setPreview(result);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      notifications.show({
        title: "Preview failed",
        message,
        color: "red",
      });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setError(null);

    try {
      // Confirm gate (§23.3): only commit once the user has previewed and
      // explicitly confirmed — never on the first action. The result is
      // returned immediately with just a job id; Step 5 polls for progress.
      const result = await confirmImport(buildRequest(false));

      setJobProgress(0);
      setImportResult(result);
      setActiveJobId(result.jobId ?? null);
      setActiveStep(4);
      notifications.show({
        title: "Import started",
        message: "Import scheduled — you'll see live progress on the next screen",
        color: "green",
      });
    } catch (err) {
      const message = getErrorMessage(err);
      console.error("confirm_import failed:", message);
      setError(message);
      notifications.show({
        title: "Import failed",
        message,
        color: "red",
      });
    } finally {
      setImporting(false);
    }
  }

  async function handleRollback() {
    if (!importResult?.jobId) return;
    setRollingBack(true);
    setError(null);

    try {
      const result = await rollbackImport(importResult.jobId);
      setRollbackResult(result);
      loadJobs();
      notifications.show({
        title: "Import rolled back",
        message: `${result.productsDeleted + result.customersDeleted + result.suppliersDeleted} record(s) removed, ${result.quantityReverted} unit(s) reverted`,
        color: "yellow",
      });
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      notifications.show({
        title: "Rollback failed",
        message,
        color: "red",
      });
    } finally {
      setRollingBack(false);
    }
  }

  // Roll back an import from the recent-imports history list.
  async function handleHistoryRollback(jobId: string) {
    setHistoryRollbackId(jobId);
    setError(null);
    try {
      const result = await rollbackImport(jobId);
      loadJobs();
      notifications.show({
        title: "Import rolled back",
        message: `${result.productsDeleted + result.customersDeleted + result.suppliersDeleted} record(s) removed, ${result.quantityReverted} unit(s) reverted`,
        color: "yellow",
      });
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      notifications.show({
        title: "Rollback failed",
        message,
        color: "red",
      });
    } finally {
      setHistoryRollbackId(null);
    }
  }

  // ---- Count mapped fields ----
  const coreCount = mappings.filter(
    (m) => m.fieldCategory === "core" && m.targetField !== "skip",
  ).length;
  const customCount = mappings.filter(
    (m) => m.fieldCategory === "custom",
  ).length;
  const skippedCount = mappings.filter((m) => m.targetField === "skip").length;

  const mappedTargets = mappings.map((m) => m.targetField);
  const missingRequired = REQUIRED_FIELDS[target].filter(
    (f) => !mappedTargets.includes(f),
  );
  const hasExpiry = mappedTargets.includes("expiry_date");
  const importedCount =
    (importResult?.productsImported ?? 0) +
    (importResult?.customersImported ?? 0) +
    (importResult?.itemsImported ?? 0);
  const previewCount =
    (preview?.productsImported ?? 0) +
    (preview?.customersImported ?? 0) +
    (preview?.itemsImported ?? 0);

  return (
    <Stack data-tour="import-wizard">
      <WizardStyles />

      <Box className="wiz-glow-bar" />

      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Eyebrow>Onboarding</Eyebrow>
          <Title order={3} style={{ color: INK.text, letterSpacing: -0.3 }}>
            Import Wizard
          </Title>
          <Text c="dimmed" size="sm" maw={520}>
            Upload your existing inventory file. The system analyzes column
            headers and proposes field mappings — you review, adjust, and
            confirm.
          </Text>
        </Stack>
        <Button
          variant="subtle"
          color="gray"
          leftSection={<ArrowLeft size={15} />}
          onClick={() => {
            reportOnboardingEvent({ type: "wizard-closed" });
            onComplete();
          }}
        >
          {backLabel}
        </Button>
      </Group>

      <Stepper
        active={activeStep}
        onStepClick={setActiveStep}
        mt="md"
        color="dark"
        styles={{
          stepIcon: {
            "&[data-progress]": { borderColor: INK.gold },
            "&[data-completed]": {
              backgroundColor: INK.navy,
              borderColor: INK.navy,
            },
          },
        }}
      >
        {/* ---- STEP 1: UPLOAD ---- */}
        <Stepper.Step
          label="Upload"
          description="Select your file"
          icon={<Upload size={16} />}
        >
          <Stack mt="xl" className="wiz-step-enter">
            <Card
              withBorder
              padding="lg"
              radius="md"
              style={{ borderColor: INK.border }}
            >
              <Stack>
                <Group gap={8}>
                  <FileSpreadsheet size={16} color={INK.gold} />
                  <Text fw={700} size="sm" style={{ color: INK.text }}>
                    What are you importing?
                  </Text>
                </Group>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  {IMPORT_TARGETS.map((t) => (
                    <Box
                      key={t.value}
                      onClick={() => handleTargetChange(t.value)}
                      role="button"
                      style={{
                        border: `2px solid ${
                          target === t.value ? INK.gold : INK.border
                        }`,
                        borderRadius: 10,
                        padding: "12px 14px",
                        cursor: "pointer",
                        background:
                          target === t.value ? INK.goldSoft : INK.paper,
                        transition:
                          "border-color 150ms ease, background-color 150ms ease",
                      }}
                    >
                      <Text fw={700} size="sm" style={{ color: INK.text }}>
                        {t.label}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t.description}
                      </Text>
                    </Box>
                  ))}
                </SimpleGrid>
              </Stack>
            </Card>

            <Card
              withBorder
              padding="lg"
              radius="md"
              style={{ borderColor: INK.border }}
            >
              <Stack>
                <Group gap={8}>
                  <FileSpreadsheet size={16} color={INK.gold} />
                  <Text fw={700} size="sm" style={{ color: INK.text }}>
                    Select your inventory file
                  </Text>
                </Group>
                <Text size="sm" c="dimmed">
                  Supported formats: .xlsx, .xls, .csv, .docx (Word table), .pdf
                  (text layer), and .png / .jpg images (OCR)
                </Text>

                {adapters.length > 0 && (
                  <Select
                    label="ERP adapter (optional)"
                    description="Choose the source system to match its column naming"
                    placeholder="Auto-detect headers"
                    data={adapters.map((a) => ({
                      value: a.key,
                      label: a.label ?? a.key,
                    }))}
                    value={adapter || null}
                    onChange={(value) => {
                      setAdapter(value ?? "");
                      setAnalysis(null);
                      setMappings([]);
                    }}
                    clearable
                    size="sm"
                  />
                )}

                <Alert color="blue" variant="light" icon={<Info size={16} />}>
                  <Text size="xs">
                    <strong>DOCX note:</strong> Your Word document must contain
                    a <strong>table</strong> (Insert → Table in Word). Plain
                    text or bullet lists won't work. If your client sent plain
                    text, copy it into Excel or Google Sheets first, then save
                    as .xlsx.
                  </Text>
                </Alert>

                <Alert color="cyan" variant="light" icon={<Info size={16} />}>
                  <Text size="xs">
                    <strong>PDF / image note:</strong> text-based PDFs (most
                    accounting exports) are read directly. Scanned documents
                    and images are read with OCR, which requires{" "}
                    <strong>Tesseract</strong> to be installed and on your
                    PATH.
                  </Text>
                </Alert>

                <Box
                  className="wiz-dropzone"
                  style={{
                    border: `2px dashed ${INK.border}`,
                    borderRadius: 10,
                    padding: 24,
                    background: INK.paper,
                  }}
                >
                  <Stack align="center" gap={6}>
                    <Upload size={22} color={INK.text} />
                    <FileInput
                      placeholder="Click to browse or drag a file here"
                      accept=".xlsx,.xls,.csv,.docx,.pdf,.png,.jpg,.jpeg"
                      value={file}
                      onChange={handleFileSelect}
                      size="md"
                      w="100%"
                      maw={420}
                      styles={{
                        input: {
                          textAlign: "center",
                          border: "none",
                          background: "transparent",
                        },
                      }}
                    />
                  </Stack>
                </Box>

                {file && (
                  <Alert
                    color="green"
                    variant="light"
                    icon={<FileCheck2 size={16} />}
                    className="wiz-step-enter"
                  >
                    <Group>
                      <Text fw={600} size="sm">
                        {file.name}
                      </Text>
                      <Badge color="dark" variant="filled" radius="sm">
                        {fileType.toUpperCase()}
                      </Badge>
                      <Text size="sm" c="dimmed" style={LEDGER_NUM}>
                        {(file.size / 1024).toFixed(1)} KB
                      </Text>
                    </Group>
                  </Alert>
                )}

                {error && (
                  <Alert
                    color="red"
                    variant="light"
                    icon={<AlertTriangle size={16} />}
                  >
                    {error}
                  </Alert>
                )}

                <Group justify="flex-end">
                  <Button
                    onClick={handleAnalyze}
                    disabled={!file}
                    loading={analyzing}
                    rightSection={<ArrowRight size={15} />}
                    style={{ backgroundColor: INK.navy }}
                  >
                    Analyze File
                  </Button>
                </Group>
              </Stack>
            </Card>
          </Stack>
        </Stepper.Step>

        {/* ---- STEP 2: ANALYZING (loading) ---- */}
        <Stepper.Step
          label="Analyze"
          description="Reading file"
          icon={<ScanSearch size={16} />}
        >
          <Stack mt="xl" align="center" py={32} className="wiz-step-enter">
            <Box
              className="wiz-scan-icon"
              style={{
                width: 56,
                height: 56,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: INK.goldSoft,
                color: INK.gold,
              }}
            >
              <ScanSearch size={26} />
            </Box>
            <Progress
              value={100}
              w="100%"
              maw={420}
              radius="xl"
              className="wiz-shimmer-bar"
            />
            <Text c="dimmed" size="sm" style={{ minHeight: 20 }}>
              {ANALYZE_MESSAGES[analyzeMsgIndex]}
            </Text>
          </Stack>
        </Stepper.Step>

        {/* ---- STEP 3: MAP FIELDS ---- */}
        <Stepper.Step
          label="Map Fields"
          description="Review & adjust"
          icon={<ArrowLeftRight size={16} />}
        >
          <Stack mt="md" className="wiz-step-enter">
            {analysis && (
              <>
                <Alert color="blue" variant="light" icon={<Info size={16} />}>
                  <Text fw={600} size="sm">
                    Found {analysis.headers.length} columns and{" "}
                    <span style={LEDGER_NUM}>{analysis.totalRows}</span> data
                    rows
                  </Text>
                </Alert>

                {analysis.autoTemplateName && (
                  <Alert
                    color="green"
                    variant="light"
                    icon={<FileCheck2 size={16} />}
                  >
                    <Group justify="space-between" wrap="wrap">
                      <Text size="sm">
                        Auto-detected template:{" "}
                        <strong>{analysis.autoTemplateName}</strong> — its
                        mappings were applied. Review below or pick another.
                      </Text>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        leftSection={<Undo2 size={13} />}
                        onClick={() =>
                          analysis &&
                          setMappings(
                            analysis.genericMappings.filter(
                              (m) => m.targetField !== "skip",
                            ),
                          )
                        }
                      >
                        Clear template
                      </Button>
                    </Group>
                  </Alert>
                )}

                {templates.length > 0 && (
                  <Group align="flex-end" gap="sm" wrap="wrap">
                    <Select
                      label="Apply a saved template"
                      placeholder="Choose a saved mapping template"
                      size="sm"
                      w={320}
                      data={templates.map((t) => ({
                        value: t.id,
                        label: `${t.templateName} (used ${t.useCount}x)`,
                      }))}
                      onChange={(id) => {
                        const t = templates.find((x) => x.id === id);
                        if (t) applyTemplate(t);
                      }}
                    />
                    {templates.length > 0 && (
                      <Group gap={6}>
                        {templates.slice(0, 3).map((t) => (
                          <Badge
                            key={t.id}
                            color="gray"
                            variant="light"
                            radius="sm"
                            size="lg"
                          >
                            {t.templateName}
                            <span
                              style={{ cursor: "pointer", marginLeft: 6 }}
                              onClick={() => handleDeleteTemplate(t)}
                              role="button"
                              title={`Delete ${t.templateName}`}
                            >
                              ×
                            </span>
                          </Badge>
                        ))}
                      </Group>
                    )}
                  </Group>
                )}

                <Alert color="yellow" variant="light" icon={<Info size={16} />}>
                  <Text size="xs">
                    <strong>Fully file-driven:</strong> every field comes from
                    your file.{" "}
                    {target === "products" &&
                      "A Product Name and an SKU column are required — they are never auto-generated. A column that looks like an expiry date (expiry, best before, use by…) is auto-mapped to Expiry Date, which enables FIFO batch tracking."}
                    {target === "customers" &&
                      "A Customer Name column is required — it is never auto-generated."}
                    {target === "suppliers" &&
                      "A Supplier Name column is required — it is never auto-generated."}
                    {target === "opening_stock" &&
                      "Rows match products by SKU — run the Products import first. A SKU column is required; quantities are added to existing stock."}
                  </Text>
                </Alert>

                <Group>
                  <Badge color="green" variant="light" radius="sm">
                    {coreCount} core fields
                  </Badge>
                  <Badge color="blue" variant="light" radius="sm">
                    {customCount} custom fields
                  </Badge>
                  {skippedCount > 0 && (
                    <Badge color="gray" variant="light" radius="sm">
                      {skippedCount} skipped
                    </Badge>
                  )}
                </Group>

                <Text size="sm" c="dimmed" mt="sm">
                  Review each column mapping. The system auto-detected based on
                  column headers. You can change any mapping.
                </Text>

                <ScrollArea>
                  <Table
                    striped
                    highlightOnHover
                    withTableBorder
                    verticalSpacing="sm"
                  >
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th style={{ width: 30 }}>#</Table.Th>
                        <Table.Th>Column Header</Table.Th>
                        <Table.Th>Maps To</Table.Th>
                        <Table.Th>Fixed Value</Table.Th>
                        <Table.Th>Confidence</Table.Th>
                        <Table.Th>Sample Data</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {mappings.map((mapping, index) => {
                        const manual = isManualField(mapping);
                        return (
                          <Table.Tr
                            key={index}
                            className="wiz-row-enter"
                            style={{
                              animationDelay: `${Math.min(index, 10) * 30}ms`,
                              background: manual ? INK.goldSoft : undefined,
                            }}
                          >
                            <Table.Td>
                              <Text size="xs" c="dimmed" style={LEDGER_NUM}>
                                {manual ? "＋" : String.fromCharCode(65 + index)}
                              </Text>
                            </Table.Td>
                            <Table.Td>
                              {manual ? (
                                <TextInput
                                  size="xs"
                                  placeholder="Field name (e.g. Batch / Lot)"
                                  value={mapping.sourceColumn}
                                  onChange={(e) => {
                                    const name = e.currentTarget.value;
                                    setMappings((prev) => {
                                      const next = [...prev];
                                      next[index] = {
                                        ...next[index],
                                        sourceColumn: name,
                                        targetField:
                                          mapping.fieldCategory === "custom"
                                            ? `custom:${name}`
                                            : next[index].targetField,
                                      };
                                      return next;
                                    });
                                  }}
                                />
                              ) : (
                                <Text
                                  fw={600}
                                  size="sm"
                                  style={{ color: INK.text }}
                                >
                                  {mapping.sourceColumn}
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Stack gap="xs">
                                <Select
                                  size="xs"
                                  data={TARGET_FIELD_OPTIONS[target]}
                                  value={
                                    mapping.targetField === "skip"
                                      ? "skip"
                                      : mapping.fieldCategory === "custom"
                                        ? "custom"
                                        : mapping.targetField
                                  }
                                  onChange={(value) =>
                                    value && updateMapping(index, value)
                                  }
                                />
                                {mapping.fieldCategory === "custom" &&
                                  !manual && (
                                    <TextInput
                                      size="xs"
                                      placeholder="Field name"
                                      value={customNames[index] ?? ""}
                                      onChange={(e) =>
                                        updateCustomName(
                                          index,
                                          e.currentTarget.value,
                                        )
                                      }
                                      label="Custom field name"
                                    />
                                  )}
                              </Stack>
                            </Table.Td>
                            <Table.Td>
                              {manual && (
                                <TextInput
                                  size="xs"
                                  placeholder="Fixed value for every row"
                                  value={mapping.manualValue ?? ""}
                                  onChange={(e) =>
                                    updateManualValue(index, e.currentTarget.value)
                                  }
                                />
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Group gap={6} justify="space-between">
                                <Badge
                                  color={CONFIDENCE_COLORS[mapping.confidence] ?? "gray"}
                                  variant="light"
                                  size="sm"
                                  radius="sm"
                                >
                                  {mapping.confidence}
                                </Badge>
                                {manual && (
                                  <Button
                                    size="compact-xs"
                                    variant="subtle"
                                    color="red"
                                    onClick={() => removeMapping(index)}
                                  >
                                    <Trash2 size={13} />
                                  </Button>
                                )}
                              </Group>
                            </Table.Td>
                            <Table.Td>
                              {manual ? (
                                <Text size="xs" c="dimmed">
                                  Applies to all rows
                                </Text>
                              ) : (
                                <Text
                                  size="xs"
                                  c="dimmed"
                                  lineClamp={2}
                                  style={LEDGER_NUM}
                                >
                                  {analysis.sampleRows
                                    .map((row) => row[mapping.sourceIndex] ?? "")
                                    .filter((v) => v)
                                    .slice(0, 3)
                                    .join(", ")}
                                </Text>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>

                <Group justify="flex-start" mt="sm">
                  <Button
                    size="xs"
                    variant="light"
                    color="blue"
                    leftSection={<Plus size={14} />}
                    onClick={addManualField}
                  >
                    Add a field manually
                  </Button>
                  <Text size="xs" c="dimmed">
                    Add values that aren't columns in your file — e.g. set
                    the same Category or Batch for every imported row.
                  </Text>
                </Group>

                {error && (
                  <Alert
                    color="red"
                    variant="light"
                    icon={<AlertTriangle size={16} />}
                  >
                    {error}
                  </Alert>
                )}

                <Group justify="space-between" mt="md">
                  <Button
                    variant="subtle"
                    color="gray"
                    leftSection={<ArrowLeft size={15} />}
                    onClick={() => setActiveStep(0)}
                  >
                    Choose Different File
                  </Button>
                  <Button
                    rightSection={<ArrowRight size={15} />}
                    style={{ backgroundColor: INK.navy }}
                    onClick={() => setActiveStep(3)}
                  >
                    Review & Import
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Stepper.Step>

        {/* ---- STEP 4: CONFIRM ---- */}
        <Stepper.Step
          label="Confirm"
          description="Review & import"
          icon={<ClipboardCheck size={16} />}
        >
          <Stack mt="md" className="wiz-step-enter">
            <Eyebrow>Import Summary</Eyebrow>

            <SimpleGrid cols={3}>
              <SummaryStat
                label="Total Rows"
                value={analysis?.totalRows ?? 0}
              />
              <SummaryStat label="Core Fields" value={coreCount} />
              <SummaryStat label="Custom Fields" value={customCount} accent />
            </SimpleGrid>

            <Divider />

            {missingRequired.length > 0 && (
              <Alert
                color="yellow"
                variant="light"
                icon={<AlertTriangle size={16} />}
              >
                <Text fw={600} size="sm" mb={4}>
                  Required fields are not mapped
                </Text>
                <Text size="sm">
                  Every row must supply its required fields directly from your
                  file — the system never auto-generates them.{" "}
                  {missingRequired.includes("name") &&
                    "Map a column to Product Name. "}
                  {missingRequired.includes("sku") && "Map a column to SKU. "}
                  {missingRequired.includes("customer_name") &&
                    "Map a column to Customer Name. "}
                  {missingRequired.includes("supplier_name") &&
                    "Map a column to Supplier Name. "}
                  Rows without them will fail with a descriptive error (no
                  partial imports).
                </Text>
              </Alert>
            )}

            {target === "opening_stock" && (
              <Alert color="teal" variant="light" icon={<Info size={16} />}>
                <Text size="sm">
                  <strong>Products must already exist:</strong> opening stock
                  rows are matched to products by SKU. Run the Products import
                  first, then this file.
                </Text>
              </Alert>
            )}

            {hasExpiry && (
              <Alert color="teal" variant="light" icon={<Info size={16} />}>
                <Text size="sm">
                  <strong>Expiry tracking is on:</strong> imported stock will be
                  held as expiry batches. Sales drain them FIFO (soonest expiry
                  first). Blank expiry cells stay unbatched; unreadable dates
                  fail loudly rather than being guessed.
                </Text>
              </Alert>
            )}

            <Divider />

            {target !== "opening_stock" && (
              <>
                <Text fw={700} size="sm" style={{ color: INK.text }}>
                  Duplicate handling
                </Text>
                <Text size="xs" c="dimmed">
                  What should happen when a record already exists (matched by
                  SKU or name)?
                </Text>
                <Select
                  size="sm"
                  data={CONFLICT_OPTIONS}
                  value={conflictStrategy}
                  onChange={(v) => v && setConflictStrategy(v as ConflictStrategy)}
                  maw={360}
                />
              </>
            )}

            <Divider />

            <Text fw={700} size="sm" style={{ color: INK.text }}>
              Field Mapping
            </Text>
            <List size="sm" spacing="xs">
              {mappings
                .filter((m) => m.targetField !== "skip")
                .map((m, i) => (
                  <List.Item key={i}>
                    <Text size="sm">
                      <Text span fw={600} style={{ color: INK.text }}>
                        {m.sourceColumn}
                      </Text>
                      {" → "}
                      <Badge
                        size="xs"
                        color={m.fieldCategory === "core" ? "green" : "blue"}
                        variant="light"
                        radius="sm"
                      >
                        {m.targetField}
                      </Badge>
                      {m.confidence === "manual" &&
                        m.manualValue != null &&
                        m.manualValue.trim() !== "" && (
                          <Text span size="xs" c="dimmed">
                            {" "}
                            = "{m.manualValue.trim()}"
                          </Text>
                        )}
                    </Text>
                  </List.Item>
                ))}
            </List>

            {target === "products" && customCount > 0 && (
              <Alert color="blue" variant="light" icon={<Info size={16} />}>
                <Text size="sm" fw={600} mb="xs">
                  Custom fields will be created:
                </Text>
                <List size="sm">
                  {mappings
                    .filter((m) => m.fieldCategory === "custom")
                    .map((m, i) => (
                      <List.Item key={i}>
                        {m.targetField.replace("custom:", "")} — stored in each
                        product's custom_fields JSON
                      </List.Item>
                    ))}
                </List>
                <Text size="xs" c="dimmed" mt="xs">
                  After import, these fields will appear in the product form and
                  table automatically.
                </Text>
              </Alert>
            )}

            <TextInput
              label="Template Name (optional)"
              placeholder="e.g. Main Inventory, Electronics Stock"
              description="Save this mapping for future imports"
              value={templateName}
              onChange={(e) => setTemplateName(e.currentTarget.value)}
            />

            {error && (
              <Alert
                color="red"
                variant="light"
                icon={<AlertTriangle size={16} />}
              >
                {error}
              </Alert>
            )}

            {preview && (
              <Alert color="blue" variant="light" icon={<Info size={16} />}>
                <Text fw={600} size="sm" mb={4}>
                  Preview ({previewCount} will be imported)
                </Text>
                <List size="sm">
                  <List.Item>
                    Ready to import: {previewCount}{" "}
                    {TARGET_LABELS[target].noun}
                  </List.Item>
                  {preview.rowsSkipped > 0 && (
                    <List.Item>
                      Skipped (already exist): {preview.rowsSkipped}
                    </List.Item>
                  )}
                  {preview.rowsWithErrors > 0 && (
                    <List.Item>
                      Will fail: {preview.rowsWithErrors} row(s) — see list
                      below
                    </List.Item>
                  )}
                </List>
              </Alert>
            )}

            <Group justify="space-between" mt="md">
              <Button
                variant="subtle"
                color="gray"
                leftSection={<ArrowLeft size={15} />}
                onClick={() => setActiveStep(2)}
              >
                Edit Mapping
              </Button>
              <Group>
                <Button
                  variant="outline"
                  color="dark"
                  leftSection={<ClipboardCheck size={16} />}
                  loading={previewing}
                  onClick={handlePreview}
                >
                  {preview ? "Refresh Preview" : "Preview"}
                </Button>
                <Button
                  onClick={handleImport}
                  loading={importing}
                  size="lg"
                  disabled={!preview}
                  leftSection={<Rocket size={18} />}
                  style={{
                    backgroundColor: INK.gold,
                    color: "#131C39",
                    fontWeight: 700,
                  }}
                >
                  {preview
                    ? `Confirm & Import ${previewCount} ${TARGET_LABELS[target].noun}`
                    : "Preview first"}
                </Button>
              </Group>
            </Group>
          </Stack>
        </Stepper.Step>

        {/* ---- STEP 5: RESULT ---- */}
        <Stepper.Completed>
          <Stack mt="md" className="wiz-step-enter">
            {activeJobId ? (
              <Stack align="center" gap="md" py="xl">
                <Loader size={36} color={INK.gold} />
                <Title order={3} ta="center" style={{ color: INK.text }}>
                  Importing {TARGET_LABELS[target].noun}…
                </Title>
                <Text size="sm" c="dimmed" ta="center">
                  Keep this window open — {jobProgress}% complete
                </Text>
                <Progress
                  value={jobProgress}
                  size="lg"
                  radius="xl"
                  color={INK.gold}
                  style={{ width: "100%", maxWidth: 420 }}
                />
              </Stack>
            ) : importResult ? (
              <>
                <Stack align="center" gap={6}>
                  <Box
                    className="wiz-pop-in"
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 999,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "color-mix(in srgb, #1E8E5A 14%, transparent)",
                      color: INK.success,
                    }}
                  >
                    <CheckCircle2 size={30} />
                  </Box>
                  <Title order={3} ta="center" style={{ color: INK.text }}>
                    Import Complete
                  </Title>
                  <Text size="sm" c="dimmed">
                    {importedCount.toLocaleString()} {TARGET_LABELS[target].noun}{" "}
                    processed.
                  </Text>
                </Stack>

                <SimpleGrid cols={3} mt="md">
                  <SummaryStat
                    label={TARGET_LABELS[target].stat}
                    value={importedCount}
                    tone="success"
                  />
                  <SummaryStat
                    label="Skipped (already existed)"
                    value={importResult.rowsSkipped}
                    tone={importResult.rowsSkipped > 0 ? "warning" : "success"}
                  />
                  <SummaryStat
                    label="Errors"
                    value={importResult.rowsWithErrors}
                    tone={
                      importResult.rowsWithErrors > 0 ? "danger" : "success"
                    }
                  />
                </SimpleGrid>

                {target === "products" && importResult.fieldsCreated > 0 && (
                  <Alert color="blue" variant="light" icon={<Info size={16} />}>
                    <Text fw={600} size="sm">
                      {importResult.fieldsCreated} custom field(s) were created.
                    </Text>
                    <Text size="sm" c="dimmed">
                      From now on, when you add or edit products, these fields
                      will appear in the form automatically. The database schema
                      did not change — only metadata was added.
                    </Text>
                  </Alert>
                )}

                {importResult.errors.length > 0 && (
                  <Alert
                    color="red"
                    variant="light"
                    icon={<XCircle size={16} />}
                  >
                    <Text fw={600} mb="xs" size="sm">
                      {importResult.rowsWithErrors} rows had errors:
                    </Text>
                    <ScrollArea h={200}>
                      <List size="sm">
                        {importResult.errors.map((err, i) => (
                          <List.Item key={i}>
                            Row {err.rowNumber}: {err.reason}
                          </List.Item>
                        ))}
                      </List>
                    </ScrollArea>
                  </Alert>
                )}

                {importResult.jobId && (
                  <Alert
                    color={rollbackResult ? "yellow" : "blue"}
                    variant="light"
                    icon={<Info size={16} />}
                  >
                    {rollbackResult ? (
                      <Stack gap={4}>
                        <Text fw={600} size="sm">
                          Import rolled back
                        </Text>
                        <Text size="sm">
                          {rollbackResult.productsDeleted} product(s),{" "}
                          {rollbackResult.customersDeleted} customer(s),{" "}
                          {rollbackResult.suppliersDeleted} supplier(s),{" "}
                          {rollbackResult.invoicesDeleted} invoice(s),{" "}
                          {rollbackResult.purchaseBillsDeleted} purchase bill(s) and{" "}
                          {rollbackResult.movementsDeleted} movement(s) removed
                          {rollbackResult.quantityReverted > 0 &&
                            `; ${rollbackResult.quantityReverted} unit(s) of opening stock reverted`}
                          .
                        </Text>
                      </Stack>
                    ) : (
                      <Stack gap={4}>
                        <Text fw={600} size="sm">
                          Imported too much?
                        </Text>
                        <Text size="sm">
                          This run can be rolled back within 24 hours. Every
                          imported record is removed and opening-stock
                          quantities are reverted.
                        </Text>
                      </Stack>
                    )}
                    <Group mt="xs">
                      {!rollbackResult && (
                        <Button
                          size="xs"
                          variant="outline"
                          color="red"
                          loading={rollingBack}
                          onClick={handleRollback}
                        >
                          Roll back this import
                        </Button>
                      )}
                    </Group>
                  </Alert>
                )}

                {error && (
                  <Alert
                    color="red"
                    variant="light"
                    icon={<AlertTriangle size={16} />}
                  >
                    {error}
                  </Alert>
                )}

                <Group justify="center" mt="xl">
                  <Button
                    size="lg"
                    rightSection={<ArrowRight size={16} />}
                    style={{ backgroundColor: INK.navy }}
                    onClick={() => {
                      reportOnboardingEvent({ type: "import-completed" });
                      onComplete();
                    }}
                  >
                    Go to Inventory
                  </Button>
                </Group>
              </>
            ) : (
              <Text c="dimmed" ta="center">
                No results yet.
              </Text>
            )}
          </Stack>
        </Stepper.Completed>
      </Stepper>

      {/* ---- RECENT IMPORTS (history + rollback) ---- */}
      <Card
        withBorder
        padding="lg"
        radius="md"
        mt="xl"
        style={{ borderColor: INK.border }}
      >
        <Group justify="space-between" mb="md">
          <Group gap={8}>
            <History size={16} color={INK.gold} />
            <Text fw={700} size="sm" style={{ color: INK.text }}>
              Recent Imports
            </Text>
            <Badge color="gray" variant="light" radius="sm" size="sm">
              {importJobs.length}
            </Badge>
          </Group>
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
          <Text size="sm" c="dimmed">
            No imports yet — completed runs appear here and can be rolled back
            within 24 hours.
          </Text>
        ) : (
          <ScrollArea>
            <Table withTableBorder verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>File</Table.Th>
                  <Table.Th>Target</Table.Th>
                  <Table.Th>Imported</Table.Th>
                  <Table.Th>Errors</Table.Th>
                  <Table.Th>When</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {importJobs.map((job) => {
                  const rollbackLoading = historyRollbackId === job.id;
                  const targetLabel =
                    TARGET_LABELS[job.fileType as ImportTarget]?.noun ??
                    job.fileType;
                  const statusColor =
                    job.status === "completed"
                      ? "green"
                      : job.status === "rolled_back"
                        ? "yellow"
                        : "blue";
                  return (
                    <Table.Tr key={job.id}>
                      <Table.Td>
                        <Text
                          size="sm"
                          fw={600}
                          style={{ color: INK.text }}
                          lineClamp={1}
                          maw={220}
                        >
                          {job.fileName ?? "Import file"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge color="brand" variant="light" radius="sm" size="sm">
                          {targetLabel}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" style={LEDGER_NUM}>
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
                        <Badge
                          color={statusColor}
                          variant="light"
                          radius="sm"
                          size="sm"
                        >
                          {job.status.replace("_", " ")}
                        </Badge>
                      </Table.Td>
                      <Table.Td ta="right">
                        {job.rollbackAvailable && (
                          <Button
                            size="compact-xs"
                            variant="outline"
                            color="red"
                            leftSection={<Undo2 size={12} />}
                            loading={rollbackLoading}
                            disabled={jobsLoading}
                            onClick={() => handleHistoryRollback(job.id)}
                          >
                            Roll back
                          </Button>
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
    </Stack>
  );
}

// ---- Small stat card used in Confirm and Result steps ----

function SummaryStat({
  label,
  value,
  accent = false,
  tone,
}: {
  label: string;
  value: number;
  accent?: boolean;
  tone?: "success" | "danger" | "warning";
}) {
  const color =
    tone === "success"
      ? INK.success
      : tone === "danger"
        ? INK.danger
        : tone === "warning"
          ? INK.gold
          : accent
            ? INK.gold
            : INK.text;
  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      style={{ borderColor: INK.border, borderLeft: `3px solid ${color}` }}
    >
      <Text
        size="xs"
        c="dimmed"
        fw={600}
        tt="uppercase"
        style={{ letterSpacing: 0.5 }}
      >
        {label}
      </Text>
      <Title order={3} style={{ ...LEDGER_NUM, color }}>
        {value}
      </Title>
    </Card>
  );
}
