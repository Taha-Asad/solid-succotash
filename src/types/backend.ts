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
  role: "admin" | "employee";
};

// Data for changing a user's role
export type UpdateRoleInput = {
  userId: string;
  role: "admin" | "employee";
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
  /** Expiry date of the soonest-expiring live batch (if any). */
  nextExpiryDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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

// Input for creating/updating a product.
// SKU is optional — when left blank the backend auto-generates it
// from the category's SKU prefix (e.g. ELEC-001, ELEC-002, ...).
export type ProductInput = {
  sku?: string;
  name: string;
  categoryId: string;
  supplierId: string;
  costPrice: number;
  sellPrice: number;
  taxRate: number;
  quantityInStock: number;
  unit: string;
};

// Input for updating a product (no quantity change).
// SKU is optional — when left blank the existing value is kept.
export type UpdateProductInput = {
  productId: string;
  sku?: string;
  name: string;
  categoryId: string;
  supplierId: string;
  costPrice: number;
  sellPrice: number;
  taxRate: number;
  unit: string;
};

// Input for stock adjustment.
// expiryDate applies to stock IN only: when provided, the incoming
// stock becomes an expiry batch (the product becomes expiry-tracked
// and stock OUT is then deducted FIFO). Never auto-filled.
export type StockAdjustmentInput = {
  productId: string;
  movementType: string;
  quantity: number;
  referenceNote: string;
  expiryDate?: string | null;
};

// One expiry batch of a product (from stock_batches)
export type PublicStockBatch = {
  id: string;
  companyId: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitCost: number;
  expiryDate: string;
  source: string;
  /** "ok" | "expiring" | "expired" | "depleted" */
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
  confidence: string; // "high", "medium", "low", "unknown"
};

// What Rust sends back after analyzing a file
export type FileAnalysis = {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  fileType: string;
  proposedMappings: FieldMapping[];
};

// What we send back when user confirms the mapping
export type ImportRequest = {
  mappings: FieldMapping[];
  fileBytes: number[];
  fileType: string;
  templateName: string;
  importData: boolean;
};

// Result of the import
export type ImportResult = {
  fieldsCreated: number;
  productsImported: number;
  rowsWithErrors: number;
  errors: ImportError[];
};

export type ImportError = {
  rowNumber: number;
  reason: string;
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
