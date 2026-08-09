// ==========================================
// API LAYER — All Tauri invoke calls live here
// ==========================================
//
// This file is the ONLY place in your React code that calls invoke().
// Every page/component imports functions from here instead of calling
// invoke directly. This means if you ever change how commands work,
// you edit ONE file, not ten.
//
// invoke("command_name", data) sends a message to Rust.
// Rust receives it by matching the command name and parameter names.
// The data object's KEYS must match Rust's PARAMETER NAMES exactly.

import { invoke } from "@tauri-apps/api/core";

import type {
  AccountStatementRow,
  CompanySetupInput,
  CreateUserInput,
  CustomerLedgerEntry,
  FileAnalysis,
  ImportJob,
  ImportRequest,
  ImportResult,
  ImportTarget,
  InvoiceSettings,
  InvoiceWithDetails,
  JournalEntryWithLines,
  LedgerAccount,
  LedgerSummary,
  LoginInput,
  ManualLineInput,
  ProductInput,
  ProductMovement,
  ProfitLossSummary,
  PublicCategory,
  PublicCompany,
  PublicCustomer,
  PublicInvoice,
  PublicInvoiceItem,
  PublicPOItem,
  PublicProduct,
  PublicPurchaseOrder,
  PublicStockBatch,
  PublicStockMovement,
  PublicSupplier,
  PublicUser,
  PurchaseOrderWithItems,
  RegisterCompanyResult,
  RoleInfo,
  RollbackResult,
  SalesByPeriod,
  SalesSummary,
  SetActiveInput,
  StockAdjustmentInput,
  StockSummary,
  TopCustomer,
  TopProduct,
  UpdatePermissionInput,
  UpdateProductInput,
  UpdateRoleInput,
} from "../types/backend";

// ==========================================
// COMPANY SETUP
// ==========================================

// Check if a company has been registered yet (first launch detection)
export function isCompanySetup(): Promise<boolean> {
  return invoke<boolean>("is_company_setup");
}

// Register the first company + owner account
// Sends each field individually to match Rust parameters
export function registerCompany(
  input: CompanySetupInput,
): Promise<RegisterCompanyResult> {
  return invoke<RegisterCompanyResult>("register_company", input);
}

// ==========================================
// AUTHENTICATION
// ==========================================

export function loginUser(input: LoginInput): Promise<PublicUser> {
  return invoke<PublicUser>("login_user", input);
}

export function logoutUser(): Promise<void> {
  return invoke<void>("logout_user");
}

export function getCurrentUser(): Promise<PublicUser> {
  return invoke<PublicUser>("current_user");
}

export function updateMyProfile(fullName: string): Promise<PublicUser> {
  return invoke<PublicUser>("update_my_profile", { fullName });
}

export function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return invoke<void>("change_my_password", {
    currentPassword,
    newPassword,
  });
}

// ==========================================
// COMPANY
// ==========================================

export function getCompany(): Promise<PublicCompany> {
  return invoke<PublicCompany>("get_company");
}

export function updateCompany(input: {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  currencyCode: string;
}): Promise<PublicCompany> {
  return invoke<PublicCompany>("update_company", input);
}

// ==========================================
// USER MANAGEMENT (owner/admin only)
// ==========================================

export function listCompanyUsers(): Promise<PublicUser[]> {
  return invoke<PublicUser[]>("list_company_users");
}

export function createCompanyUser(input: CreateUserInput): Promise<PublicUser> {
  return invoke<PublicUser>("create_company_user", input);
}

export function updateCompanyUserRole(
  input: UpdateRoleInput,
): Promise<PublicUser> {
  return invoke<PublicUser>("update_company_user_role", input);
}

export function setCompanyUserActive(
  input: SetActiveInput,
): Promise<PublicUser> {
  return invoke<PublicUser>("set_company_user_active", input);
}

// ==========================================
// INVENTORY: CATEGORIES
// ==========================================

export function listCategories(): Promise<PublicCategory[]> {
  return invoke<PublicCategory[]>("list_categories");
}

export function createCategory(input: {
  name: string;
  description: string;
}): Promise<PublicCategory> {
  return invoke<PublicCategory>("create_category", input);
}

export function updateCategory(input: {
  categoryId: string;
  expectedVersion: number;
  name: string;
  description: string;
}): Promise<PublicCategory> {
  return invoke<PublicCategory>("update_category", input);
}

export function setCategoryActive(input: {
  categoryId: string;
  active: boolean;
}): Promise<PublicCategory> {
  return invoke<PublicCategory>("set_category_active", input);
}

export function deleteCategory(categoryId: string): Promise<void> {
  return invoke<void>("delete_category", { categoryId });
}

// ==========================================
// INVENTORY: SUPPLIERS
// ==========================================

export function listSuppliers(): Promise<PublicSupplier[]> {
  return invoke<PublicSupplier[]>("list_suppliers");
}

export function createSupplier(input: {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  taxNumber: string;
}): Promise<PublicSupplier> {
  return invoke<PublicSupplier>("create_supplier", input);
}

export function updateSupplier(input: {
  supplierId: string;
  expectedVersion: number;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  taxNumber: string;
}): Promise<PublicSupplier> {
  return invoke<PublicSupplier>("update_supplier", input);
}

export function setSupplierActive(input: {
  supplierId: string;
  active: boolean;
}): Promise<PublicSupplier> {
  return invoke<PublicSupplier>("set_supplier_active", input);
}

export function deleteSupplier(supplierId: string): Promise<void> {
  return invoke<void>("delete_supplier", { supplierId });
}

// ==========================================
// INVENTORY: PRODUCTS
// ==========================================

export function listProducts(): Promise<PublicProduct[]> {
  return invoke<PublicProduct[]>("list_products");
}

export function createProduct(input: ProductInput): Promise<PublicProduct> {
  return invoke<PublicProduct>("create_product", input);
}

export function updateProduct(
  input: UpdateProductInput,
): Promise<PublicProduct> {
  return invoke<PublicProduct>("update_product", input);
}

export function deleteProduct(productId: string): Promise<void> {
  return invoke<void>("delete_product", { productId });
}

export function adjustStock(
  input: StockAdjustmentInput,
): Promise<PublicProduct> {
  return invoke<PublicProduct>("adjust_stock", input);
}

export function listStockMovements(
  productId: string,
): Promise<PublicStockMovement[]> {
  return invoke<PublicStockMovement[]>("list_stock_movements", { productId });
}

// List the expiry batches for a single product
export function listProductBatches(
  productId: string,
): Promise<PublicStockBatch[]> {
  return invoke<PublicStockBatch[]>("list_product_batches", { productId });
}

// List batches that have expired or expire within `warnDays`
export function listExpiringBatches(
  warnDays: number,
): Promise<PublicStockBatch[]> {
  return invoke<PublicStockBatch[]>("list_expiring_batches", { warnDays });
}

// Write off stock from an expired batch
export function writeOffBatch(input: {
  batchId: string;
  quantity: number;
  reason: string;
}): Promise<PublicStockBatch> {
  return invoke<PublicStockBatch>("write_off_batch", input);
}

// List the company's custom field definitions
export function listCustomFields(): Promise<
  {
    id: string;
    fieldName: string;
    fieldLabel: string;
    fieldType: string;
    isVisible: boolean;
    fieldOrder: number;
    validationRules: string | null;
    defaultValue: string | null;
  }[]
> {
  return invoke("list_custom_fields");
}

// ==========================================
// IMPORT WIZARD
// ==========================================

// Step 1: Send file bytes to Rust, get back analysis + proposed mappings
export function analyzeImportFile(input: {
  fileBytes: number[];
  fileType: string;
  target?: ImportTarget;
}): Promise<FileAnalysis> {
  return invoke<FileAnalysis>("analyze_import_file", input);
}

// Step 2: Send confirmed mapping + file bytes, Rust imports everything
export function executeImport(input: ImportRequest): Promise<ImportResult> {
  return invoke<ImportResult>("execute_import", { request: input });
}

// Step 3: List recent import jobs for the current company (rollback UI)
export function listImportJobs(): Promise<ImportJob[]> {
  return invoke<ImportJob[]>("list_import_jobs");
}

// Step 4: Roll back a completed import within its 24h window
export function rollbackImport(jobId: string): Promise<RollbackResult> {
  return invoke<RollbackResult>("rollback_import", { jobId });
}

// ==========================================
// CUSTOMERS
// ==========================================

export function listCustomers(): Promise<PublicCustomer[]> {
  return invoke<PublicCustomer[]>("list_customers");
}

export function createCustomer(input: {
  name: string;
  email: string;
  phone: string;
  address: string;
  cnic: string;
  ntn: string;
  strn: string;
  buyerType: string;
}): Promise<PublicCustomer> {
  return invoke<PublicCustomer>("create_customer", input);
}

export function deleteCustomer(customerId: string): Promise<void> {
  return invoke<void>("delete_customer", { customerId });
}

// ==========================================
// INVOICES
// ==========================================

export function listInvoices(): Promise<PublicInvoice[]> {
  return invoke<PublicInvoice[]>("list_invoices");
}

export function getInvoice(invoiceId: string): Promise<InvoiceWithDetails> {
  return invoke<InvoiceWithDetails>("get_invoice", { invoiceId });
}

export function createInvoice(input: {
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  poNumber: string;
  referenceNote: string;
}): Promise<PublicInvoice> {
  return invoke<PublicInvoice>("create_invoice", input);
}

export function addInvoiceItem(input: {
  invoiceId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountType: string;
  discountValue: number;
}): Promise<PublicInvoiceItem[]> {
  return invoke<PublicInvoiceItem[]>("add_invoice_item", input);
}

export function removeInvoiceItem(input: {
  invoiceId: string;
  itemId: string;
}): Promise<PublicInvoiceItem[]> {
  return invoke<PublicInvoiceItem[]>("remove_invoice_item", input);
}

export function updateInvoiceItem(input: {
  invoiceId: string;
  itemId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountType: string;
  discountValue: number;
}): Promise<PublicInvoiceItem[]> {
  return invoke<PublicInvoiceItem[]>("update_invoice_item", input);
}

export function finalizeInvoice(invoiceId: string): Promise<PublicInvoice> {
  return invoke<PublicInvoice>("finalize_invoice", { invoiceId });
}

export function recordPayment(input: {
  invoiceId: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  reference: string;
  notes: string;
}): Promise<PublicInvoice> {
  return invoke<PublicInvoice>("record_payment", input);
}

// ==========================================
// INVOICE SETTINGS
// ==========================================

export function getInvoiceSettings(): Promise<InvoiceSettings> {
  return invoke<InvoiceSettings>("get_invoice_settings");
}

export function updateInvoiceSettings(input: {
  companyNtn: string;
  companyStrn: string;
  companyCnic: string;
  invoicePrefix: string;
  defaultDueDays: number;
  invoiceFooter: string;
  termsConditions: string;
  invoiceDesign: string;
  designAccentColor: string;
  showQr: boolean;
  disclaimer: string;
  copyright: string;
  bankDetails: string;
}): Promise<InvoiceSettings> {
  return invoke<InvoiceSettings>("update_invoice_settings", input);
}

// ==========================================
// SESSION PERSISTENCE
// ==========================================

export function saveSession(): Promise<void> {
  return invoke<void>("save_session");
}

export function loadSavedSession(): Promise<PublicUser> {
  return invoke<PublicUser>("load_saved_session");
}

export function clearSavedSession(): Promise<void> {
  return invoke<void>("clear_saved_session");
}

// ==========================================
// PDF GENERATION
// ==========================================

export function generateInvoiceHtml(invoiceId: string): Promise<string> {
  return invoke<string>("generate_invoice_html", { invoiceId });
}

export function generateInvoicePdf(invoiceId: string, savePath?: string): Promise<string> {
  return invoke<string>("generate_invoice_pdf", { invoiceId, savePath });
}

export function generateInvoiceExcel(invoiceId: string, savePath?: string): Promise<string> {
  return invoke<string>("generate_invoice_excel", { invoiceId, savePath });
}

export function saveInvoiceExcelTemplate(templateBase64: string): Promise<InvoiceSettings> {
  return invoke<InvoiceSettings>("save_invoice_excel_template", { templateBase64 });
}

export function analyzeInvoiceExcelTemplate(): Promise<ExcelTemplateAnalysis> {
  return invoke<ExcelTemplateAnalysis>("analyze_invoice_excel_template");
}

export function downloadSampleInvoiceTemplate(savePath: string): Promise<string> {
  return invoke<string>("download_sample_invoice_template", { savePath });
}

// ==========================================
// PURCHASE ORDERS
// ==========================================

export function listPurchaseOrders(): Promise<PublicPurchaseOrder[]> {
  return invoke<PublicPurchaseOrder[]>("list_purchase_orders");
}

export function getPurchaseOrder(
  poId: string,
): Promise<PurchaseOrderWithItems> {
  return invoke<PurchaseOrderWithItems>("get_purchase_order", { poId });
}

export function createPurchaseOrder(input: {
  supplierId: string;
  poDate: string;
  expectedDate: string;
  referenceNote: string;
}): Promise<PublicPurchaseOrder> {
  return invoke<PublicPurchaseOrder>("create_purchase_order", input);
}

export function addPOItem(input: {
  poId: string;
  productId: string;
  quantity: number;
  unitCost: number;
  taxRate: number;
  expiryDate?: string;
}): Promise<PublicPOItem[]> {
  return invoke<PublicPOItem[]>("add_po_item", input);
}

export function removePOItem(input: {
  poId: string;
  itemId: string;
}): Promise<PublicPOItem[]> {
  return invoke<PublicPOItem[]>("remove_po_item", input);
}

export function submitPurchaseOrder(
  poId: string,
): Promise<PublicPurchaseOrder> {
  return invoke<PublicPurchaseOrder>("submit_purchase_order", { poId });
}

// Expiry dates are entered at RECEIVE time (from the supplier's delivery
// note), not when the PO item is added — the expiry isn't known until the
// physical goods arrive.
export function receivePOItems(
  poId: string,
  expiries: { itemId: string; expiryDate: string }[],
): Promise<PublicPurchaseOrder> {
  return invoke<PublicPurchaseOrder>("receive_po_items", { poId, expiries });
}

export function recordPOPayment(input: {
  poId: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  reference: string;
  notes: string;
}): Promise<PublicPurchaseOrder> {
  return invoke<PublicPurchaseOrder>("record_po_payment", input);
}

// ==========================================
// REPORTS
// ==========================================

export function reportSalesSummary(): Promise<SalesSummary> {
  return invoke<SalesSummary>("report_sales_summary");
}

export function reportSalesByMonth(): Promise<SalesByPeriod[]> {
  return invoke<SalesByPeriod[]>("report_sales_by_month");
}

export function reportTopProducts(): Promise<TopProduct[]> {
  return invoke<TopProduct[]>("report_top_products");
}

export function reportTopCustomers(): Promise<TopCustomer[]> {
  return invoke<TopCustomer[]>("report_top_customers");
}

export function reportStock(lowStockThreshold: number): Promise<StockSummary> {
  return invoke<StockSummary>("report_stock", { lowStockThreshold });
}

export function reportProfitLoss(): Promise<ProfitLossSummary> {
  return invoke<ProfitLossSummary>("report_profit_loss");
}

export function reportCustomerLedger(): Promise<CustomerLedgerEntry[]> {
  return invoke<CustomerLedgerEntry[]>("report_customer_ledger");
}

export function reportProductMovements(): Promise<ProductMovement[]> {
  return invoke<ProductMovement[]>("report_product_movements");
}

// ==========================================
// REPORT EXPORT (CSV)
// ==========================================

export function exportStockCsv(savePath: string): Promise<string> {
  return invoke<string>("export_stock_csv", { savePath });
}

export function exportCustomerLedgerCsv(savePath: string): Promise<string> {
  return invoke<string>("export_customer_ledger_csv", { savePath });
}

export function exportSalesCsv(savePath: string): Promise<string> {
  return invoke<string>("export_sales_csv", { savePath });
}

export function exportReportPdf(
  report: "sales" | "stock" | "ledger",
  savePath: string,
): Promise<string> {
  return invoke<string>("export_report_pdf", { report, savePath });
}

// ==========================================
// ACCOUNTING LEDGER
// ==========================================

export function getChartOfAccounts(): Promise<LedgerAccount[]> {
  return invoke<LedgerAccount[]>("get_chart_of_accounts");
}

export function getLedgerSummary(): Promise<LedgerSummary> {
  return invoke<LedgerSummary>("get_ledger_summary");
}

export function getJournalEntries(limit?: number): Promise<JournalEntryWithLines[]> {
  return invoke<JournalEntryWithLines[]>("get_journal_entries", { limit });
}

export function getAccountStatement(accountId: string): Promise<AccountStatementRow[]> {
  return invoke<AccountStatementRow[]>("get_account_statement", { accountId });
}

export function postManualEntry(input: {
  entryDate: string;
  description: string;
  lines: ManualLineInput[];
}): Promise<null> {
  return invoke<null>("post_manual_entry", input);
}

// ==========================================
// ROLES & PERMISSIONS
// ==========================================

export function listRoles(): Promise<RoleInfo[]> {
  return invoke<RoleInfo[]>("list_roles");
}

export function createCustomRole(name: string, description?: string): Promise<RoleInfo> {
  return invoke<RoleInfo>("create_custom_role", { name, description });
}

export function updateRolePermissions(
  role: string,
  permissions: UpdatePermissionInput[],
): Promise<RoleInfo> {
  return invoke<RoleInfo>("update_role_permissions", { role, permissions });
}

export function deleteCustomRole(name: string): Promise<void> {
  return invoke<void>("delete_custom_role", { name });
}

export function getMyPermissions(): Promise<RoleInfo> {
  return invoke<RoleInfo>("get_my_permissions");
}


// ==========================================
// SEARCH (FTS5)
// ==========================================

export type SearchResult = {
  resultType: string; // "product" or "customer"
  id: string;
  name: string;
  subtitle: string;
  detail: string;
};

export function searchAll(query: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_all", { query });
}

// ==========================================
// THEME & BRANDING
// ==========================================

export type CompanyTheme = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  colorScheme: string; // "light" | "dark" | "auto"
  logoBase64: string | null;
  companyTagline: string | null;
  erpWatermark: string;
};

// Tenant-editable theme fields. The ERP watermark is platform-owned
// (super admin) and is intentionally NOT part of this type.
export type UpdateThemeInput = Omit<CompanyTheme, "erpWatermark">;

export function getTheme(): Promise<CompanyTheme> {
  return invoke<CompanyTheme>("get_theme");
}

export function updateTheme(theme: UpdateThemeInput): Promise<CompanyTheme> {
  return invoke<CompanyTheme>("update_theme", { input: theme });
}

// Reads an image file into a base64 data URI (for logo upload)
export function readFileBase64(path: string): Promise<string> {
  return invoke<string>("read_file_base64", { path });
}

// ==========================================
// NOTIFICATIONS
// ==========================================

export type AppNotification = {
  id: string;
  notificationType: string; // "low_stock" | "expiring" | "overdue" | "activity"
  severity: string; // "info" | "warning" | "critical"
  title: string;
  message: string;
  resourceType: string; // "product" | "invoice" | "batch"
  resourceId: string | null;
  createdAt: string;
};

export function getNotifications(): Promise<AppNotification[]> {
  return invoke<AppNotification[]>("get_notifications");
}

// ==========================================
// DATA RETENTION
// ==========================================

export type RetentionSummary = {
  invoicesArchivable: number;
  poArchivable: number;
  movementsArchivable: number;
  oldestInvoiceDate: string | null;
  oldestMovementDate: string | null;
};

export function getRetentionSummary(
  retentionYears: number,
): Promise<RetentionSummary> {
  return invoke<RetentionSummary>("get_retention_summary", {
    retentionYears,
  });
}

export function archiveOldRecords(retentionYears: number): Promise<string> {
  return invoke<string>("archive_old_records", { retentionYears });
}

// ==========================================
// BACKUP & RESTORE
// ==========================================

export type BackupInfo = {
  path: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
};

// Saves a backup to the user-chosen path (frontend opens the Save dialog)
export function createBackup(savePath: string): Promise<string> {
  return invoke<string>("create_backup", { savePath });
}

// Replaces the database from the user-chosen backup file. App must restart.
export function restoreBackup(backupPath: string): Promise<string> {
  return invoke<string>("restore_backup", { backupPath });
}

// Lists existing backup files in the given directory
export function listBackups(directory: string): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>("list_backups", { directory });
}

// ==========================================
// FILE DIALOGS
// ==========================================

export type DialogFilters = {
  name: string;
  extensions: string[];
};

export async function openFileDialog(options?: {
  multiple?: boolean;
  directory?: boolean;
  title?: string;
  filters?: DialogFilters[];
}): Promise<string | string[] | null> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return await open(options);
  } catch {
    return null;
  }
}

export async function saveFileDialog(options?: {
  defaultPath?: string;
  title?: string;
  filters?: DialogFilters[];
}): Promise<string | null> {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return await save(options);
  } catch {
    return null;
  }
}

// ==========================================
// AUDIT LOG
// ==========================================

export type AuditEntry = {
  id: string;
  companyId: string;
  userId: string;
  userEmail: string;
  userRole: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: string | null;
  createdAt: string;
};

export function listAuditEntries(
  limit: number,
  offset: number,
): Promise<AuditEntry[]> {
  return invoke<AuditEntry[]>("list_audit_logs", { limit, offset });
}

// ==========================================
// UPDATER
// ==========================================

export type UpdateResult = {
  available: boolean;
  currentVersion: string;
  update: {
    version: string;
    date: string | null;
    body: string | null;
  } | null;
};

export type ExcelTemplateAnalysis = {
  hasTemplate: boolean;
  knownTokens: string[];
  unknownTokens: string[];
  missingCommonTokens: string[];
};

export function checkForUpdates(): Promise<UpdateResult> {
  return invoke<UpdateResult>("check_for_updates");
}

export function installUpdate(): Promise<void> {
  return invoke<void>("install_update");
}

// ==========================================
// ERROR HELPER
// ==========================================

// Turns any unknown error into a readable string
export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "An unknown error occurred";
  }
}
