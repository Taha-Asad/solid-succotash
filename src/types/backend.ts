// ==========================================
// ROLE TYPES
// ==========================================

// Roles inside one company (tenant-scoped)
export type UserRole = "owner" | "admin" | "employee";

// ==========================================
// RETURN TYPES (what Rust sends back to us)
// ==========================================

// User profile — no password_hash ever leaves Rust
export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  companyId: string | null;
  isActive: boolean;
  createdAt: string;
};

// Company info
export type PublicCompany = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  currencyCode: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// What register_company returns (company + owner user)
export type RegisterCompanyResult = {
  company: PublicCompany;
  user: PublicUser;
};

// ==========================================
// INPUT TYPES (what we send TO Rust)
// ==========================================
// These use "type" (not "interface") so TypeScript
// trusts them as safe to pass to invoke().
//
// interface → TypeScript says "might have extra fields, I don't trust it"
// type       → TypeScript says "I know exactly what fields exist, safe to send"

// Data for the first-time company setup form
export type CompanySetupInput = {
  companyName: string;
  ownerFullName: string;
  email: string;
  password: string;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  currencyCode: string;
};

// Data for the login form
export type LoginInput = {
  email: string;
  password: string;
};

// Data for creating a new company user (admin or employee)
export type CreateUserInput = {
  email: string;
  password: string;
  fullName: string;
  role: string;
};

// Data for changing a user's role
export type UpdateRoleInput = {
  userId: string;
  role: string;
};

// Data for activating/deactivating a user
export type SetActiveInput = {
  userId: string;
  active: boolean;
};

// ==========================================
// INVENTORY TYPES
// ==========================================

// Category
export type PublicCategory = {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  skuPrefix: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

// Supplier
export type PublicSupplier = {
  id: string;
  companyId: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxNumber: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

// Product
// Prices are in smallest currency unit (paisa/cents).
// Display: divide by 100. Example: 1500 → "15.00"
export type PublicProduct = {
  id: string;
  companyId: string;
  sku: string;
  name: string;
  categoryId: string | null;
  supplierId: string | null;
  costPrice: number;
  sellPrice: number;
  taxRate: number;
  quantityInStock: number;
  unit: string;
  customFields: string | null; // JSON blob for company-specific fields
  nextExpiryDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

// Stock movement (audit trail entry)
export type PublicStockMovement = {
  id: string;
  companyId: string;
  productId: string;
  movementType: string;
  quantity: number;
  referenceNote: string | null;
  performedBy: string | null;
  createdAt: string;
};

// Input for creating/updating a product
export type ProductInput = {
  sku: string;
  name: string;
  categoryId: string;
  supplierId: string;
  costPrice: number;
  sellPrice: number;
  taxRate: number;
  quantityInStock: number;
  unit: string;
};

// Input for updating a product (no quantity change)
export type UpdateProductInput = {
  productId: string;
  expectedVersion: number;
  sku: string;
  name: string;
  categoryId: string;
  supplierId: string;
  costPrice: number;
  sellPrice: number;
  taxRate: number;
  unit: string;
};

// Input for stock adjustment
export type StockAdjustmentInput = {
  productId: string;
  movementType: string;
  quantity: number;
  referenceNote: string;
  expiryDate?: string | null;
  batchNumber?: string | null;
};

// A stock batch (expiry-tracked stock).
// status: "ok" | "expiring" | "expired" | "depleted"
export type PublicStockBatch = {
  id: string;
  companyId: string;
  productId: string;
  productName: string;
  productSku: string;
  batchNumber: string | null;
  quantity: number;
  unitCost: number;
  expiryDate: string;
  source: string;
  status: string;
  createdAt: string;
};

// ==========================================
// IMPORT WIZARD TYPES
// ==========================================

// A proposed mapping for one Excel column
export type FieldMapping = {
  sourceColumn: string;
  sourceIndex: number;
  targetField: string; // "name", "sku", "cost_price", "sell_price", "custom:<name>"
  fieldCategory: string; // "core" or "custom"
  confidence: string; // "high", "medium", "low", "unknown", "manual"
  // When set, the same constant value is applied to every row instead of
  // reading from the file column (manually added fields in the Map step).
  manualValue?: string | null;
};

// What Rust sends back after analyzing a file
export type FileAnalysis = {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  fileType: string;
  proposedMappings: FieldMapping[];
};

export type ImportTarget = "products" | "customers" | "opening_stock" | "suppliers";

export type ConflictStrategy = "skip" | "overwrite" | "suffix";

// What we send back when user confirms the mapping
export type ImportRequest = {
  target: ImportTarget;
  mappings: FieldMapping[];
  fileBytes: number[];
  fileType: string;
  templateName: string;
  importData: boolean;
  conflictStrategy: ConflictStrategy;
  dryRun: boolean;
  fileName?: string | null;
};

// Result of the import
export type ImportResult = {
  fieldsCreated: number;
  productsImported: number;
  customersImported: number;
  itemsImported: number;
  rowsWithErrors: number;
  rowsSkipped: number;
  jobId?: string | null;
  errors: ImportError[];
};

export type ImportError = {
  rowNumber: number;
  reason: string;
};

// A completed import run, listed for rollback
export type ImportJob = {
  id: string;
  fileType: string;
  fileName: string | null;
  status: string; // "processing" | "completed" | "rolled_back"
  totalRows: number;
  processedRows: number;
  errorRows: number;
  errorDetails: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  rollbackAvailable: boolean;
  importedRecords: number;
};

export type RollbackResult = {
  productsDeleted: number;
  customersDeleted: number;
  suppliersDeleted: number;
  movementsDeleted: number;
  batchesDeleted: number;
  quantityReverted: number;
};

// Custom field definition (from company_field_settings)
export type CustomFieldSetting = {
  id: string;
  companyId: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string; // "text", "number", "date", "dropdown"
  isVisible: boolean;
  fieldOrder: number;
  validationRules: string | null;
  defaultValue: string | null;
  createdAt: string;
  updatedAt: string;
};

// ==========================================
// INVOICE & BILLING TYPES
// ==========================================

export type PublicCustomer = {
  id: string;
  companyId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  cnic: string | null;
  ntn: string | null;
  strn: string | null;
  buyerType: string; // "registered" | "unregistered"
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type PublicInvoice = {
  id: string;
  companyId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  customerId: string;
  status: string; // "draft" | "finalized" | "paid" | "cancelled"
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  fbrInvoiceNumber: string | null;
  poNumber: string | null;
  referenceNote: string | null;
  amountPaid: number;
  balanceDue: number;
  createdBy: string;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicInvoiceItem = {
  id: string;
  invoiceId: string;
  companyId: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxAmount: number;
  discountRate: number;
  discountAmount: number;
  discountType: string;
  lineTotal: number;
  createdAt: string;
};

export type PublicPayment = {
  id: string;
  invoiceId: string;
  companyId: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  reference: string | null;
  notes: string | null;
  receivedBy: string;
  createdAt: string;
};

export type InvoiceWithDetails = {
  invoice: PublicInvoice;
  customer: PublicCustomer;
  items: PublicInvoiceItem[];
  payments: PublicPayment[];
};

export type InvoiceSettings = {
  companyNtn: string | null;
  companyStrn: string | null;
  companyCnic: string | null;
  invoicePrefix: string;
  nextNumber: number;
  defaultDueDays: number;
  invoiceFooter: string | null;
  termsConditions: string | null;
};

// ==========================================
// REPORT TYPES
// ==========================================

export type SalesSummary = {
  totalInvoices: number;
  totalRevenue: number;
  totalTax: number;
  totalDiscount: number;
  totalPaid: number;
  totalOutstanding: number;
  draftCount: number;
  finalizedCount: number;
  paidCount: number;
  cancelledCount: number;
};

export type SalesByPeriod = {
  period: string;
  invoiceCount: number;
  revenue: number;
  tax: number;
  paid: number;
};

export type TopProduct = {
  productId: string;
  productName: string;
  productSku: string;
  totalQuantitySold: number;
  totalRevenue: number;
};

export type TopCustomer = {
  customerId: string;
  customerName: string;
  totalInvoices: number;
  totalRevenue: number;
  totalPaid: number;
  balanceDue: number;
};

export type StockReportItem = {
  productId: string;
  productName: string;
  productSku: string;
  categoryName: string | null;
  quantityInStock: number;
  costPrice: number;
  sellPrice: number;
  stockValueAtCost: number;
  stockValueAtSell: number;
  isLowStock: boolean;
};

export type StockSummary = {
  totalProducts: number;
  totalStockUnits: number;
  totalValueAtCost: number;
  totalValueAtSell: number;
  lowStockCount: number;
  outOfStockCount: number;
  items: StockReportItem[];
};

export type ProfitLossSummary = {
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  profitMarginPct: number;
  totalTaxCollected: number;
  totalDiscountsGiven: number;
};

export type CustomerLedgerEntry = {
  customerId: string;
  customerName: string;
  totalInvoiced: number;
  totalPaid: number;
  balanceDue: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
  lastPaymentDate: string | null;
};

export type ProductMovement = {
  productId: string;
  productName: string;
  productSku: string;
  totalPurchased: number;
  totalSold: number;
  totalAdjusted: number;
  totalReturned: number;
  totalDamaged: number;
  currentStock: number;
};

// ==========================================
// PURCHASE ORDER TYPES
// ==========================================

export type PublicPurchaseOrder = {
  id: string;
  companyId: string;
  supplierId: string;
  supplierName: string;
  poNumber: string;
  poDate: string;
  expectedDate: string | null;
  status: string; // "draft" | "ordered" | "received" | "paid" | "cancelled"
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  referenceNote: string | null;
  createdBy: string;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicPOItem = {
  id: string;
  poId: string;
  productId: string;
  productName: string;
  productSku: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
  expiryDate: string | null;
};

export type PurchaseOrderWithItems = {
  order: PublicPurchaseOrder;
  items: PublicPOItem[];
};

// ==========================================
// ACCOUNTING LEDGER TYPES
// ==========================================

export type LedgerAccount = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense";
  isSystem: boolean;
  isActive: boolean;
};

export type AccountBalance = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  debitTotal: number;
  creditTotal: number;
  net: number;
};

export type LedgerSummary = {
  accounts: AccountBalance[];
  totalDebit: number;
  totalCredit: number;
};

export type JournalEntry = {
  id: string;
  companyId: string;
  entryDate: string;
  referenceType: string;
  referenceId: string | null;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type JournalLine = {
  id: string;
  journalEntryId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string | null;
};

export type JournalEntryWithLines = {
  entry: JournalEntry;
  lines: JournalLine[];
};

export type AccountStatementRow = {
  entryId: string;
  entryDate: string;
  referenceType: string;
  referenceId: string | null;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type ManualLineInput = {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string | null;
};

// ==========================================
// ROLE & PERMISSION TYPES
// ==========================================

export type RolePermission = {
  module: string;
  permission: string;
  allowed: boolean;
};

export type RoleInfo = {
  role: string;
  description: string;
  isCustom: boolean;
  permissions: RolePermission[];
};

export type UpdatePermissionInput = {
  module: string;
  permission: string;
  allowed: boolean;
};
