// // // ==========================================
// // // ROLE TYPES
// // // ==========================================

// // // Roles inside one company (tenant-scoped)
// // export type UserRole = "owner" | "admin" | "employee";

// // // ==========================================
// // // RETURN TYPES (what Rust sends back to us)
// // // ==========================================

// // // User profile — no password_hash ever leaves Rust
// // export type PublicUser = {
// //   id: string;
// //   email: string;
// //   fullName: string;
// //   role: UserRole;
// //   companyId: string | null;
// //   isActive: boolean;
// //   createdAt: string;
// // };

// // // Company info
// // export type PublicCompany = {
// //   id: string;
// //   name: string;
// //   email: string | null;
// //   phone: string | null;
// //   address: string | null;
// //   taxNumber: string | null;
// //   currencyCode: string;
// //   isActive: boolean;
// //   createdAt: string;
// //   updatedAt: string;
// // };

// // // What register_company returns (company + owner user)
// // export type RegisterCompanyResult = {
// //   company: PublicCompany;
// //   user: PublicUser;
// // };

// // // ==========================================
// // // INPUT TYPES (what we send TO Rust)
// // // ==========================================
// // // These use "type" (not "interface") so TypeScript
// // // trusts them as safe to pass to invoke().
// // //
// // // interface → TypeScript says "might have extra fields, I don't trust it"
// // // type       → TypeScript says "I know exactly what fields exist, safe to send"

// // // Data for the first-time company setup form
// // export type CompanySetupInput = {
// //   companyName: string;
// //   ownerFullName: string;
// //   email: string;
// //   password: string;
// //   phone: string | null;
// //   address: string | null;
// //   taxNumber: string | null;
// //   currencyCode: string;
// // };

// // // Data for the login form
// // export type LoginInput = {
// //   email: string;
// //   password: string;
// // };

// // // Data for creating a new company user (admin or employee)
// // export type CreateUserInput = {
// //   email: string;
// //   password: string;
// //   fullName: string;
// //   role: "admin" | "employee";
// // };

// // // Data for changing a user's role
// // export type UpdateRoleInput = {
// //   userId: string;
// //   role: "admin" | "employee";
// // };

// // // Data for activating/deactivating a user
// // export type SetActiveInput = {
// //   userId: string;
// //   active: boolean;
// // };

// // ==========================================
// // ROLE TYPES
// // ==========================================

// // Roles inside one company (tenant-scoped)
// export type UserRole = "owner" | "admin" | "employee";

// // ==========================================
// // RETURN TYPES (what Rust sends back to us)
// // ==========================================

// // User profile — no password_hash ever leaves Rust
// export type PublicUser = {
//   id: string;
//   email: string;
//   fullName: string;
//   role: UserRole;
//   companyId: string | null;
//   isActive: boolean;
//   createdAt: string;
// };

// // Company info
// export type PublicCompany = {
//   id: string;
//   name: string;
//   email: string | null;
//   phone: string | null;
//   address: string | null;
//   taxNumber: string | null;
//   currencyCode: string;
//   isActive: boolean;
//   createdAt: string;
//   updatedAt: string;
// };

// // What register_company returns (company + owner user)
// export type RegisterCompanyResult = {
//   company: PublicCompany;
//   user: PublicUser;
// };

// // ==========================================
// // INPUT TYPES (what we send TO Rust)
// // ==========================================
// // These use "type" (not "interface") so TypeScript
// // trusts them as safe to pass to invoke().
// //
// // interface → TypeScript says "might have extra fields, I don't trust it"
// // type       → TypeScript says "I know exactly what fields exist, safe to send"

// // Data for the first-time company setup form
// export type CompanySetupInput = {
//   companyName: string;
//   ownerFullName: string;
//   email: string;
//   password: string;
//   phone: string | null;
//   address: string | null;
//   taxNumber: string | null;
//   currencyCode: string;
// };

// // Data for the login form
// export type LoginInput = {
//   email: string;
//   password: string;
// };

// // Data for creating a new company user (admin or employee)
// export type CreateUserInput = {
//   email: string;
//   password: string;
//   fullName: string;
//   role: "admin" | "employee";
// };

// // Data for changing a user's role
// export type UpdateRoleInput = {
//   userId: string;
//   role: "admin" | "employee";
// };

// // Data for activating/deactivating a user
// export type SetActiveInput = {
//   userId: string;
//   active: boolean;
// };

// // ==========================================
// // INVENTORY TYPES
// // ==========================================

// // Category
// export type PublicCategory = {
//   id: string;
//   companyId: string;
//   name: string;
//   description: string | null;
//   isActive: boolean;
//   createdAt: string;
//   updatedAt: string;
// };

// // Supplier
// export type PublicSupplier = {
//   id: string;
//   companyId: string;
//   name: string;
//   contactPerson: string | null;
//   email: string | null;
//   phone: string | null;
//   address: string | null;
//   taxNumber: string | null;
//   isActive: boolean;
//   createdAt: string;
//   updatedAt: string;
// };

// // Product
// // Prices are in smallest currency unit (paisa/cents).
// // Display: divide by 100. Example: 1500 → "15.00"
// export type PublicProduct = {
//   id: string;
//   companyId: string;
//   sku: string;
//   name: string;
//   categoryId: string | null;
//   supplierId: string | null;
//   costPrice: number;
//   sellPrice: number;
//   taxRate: number;
//   quantityInStock: number;
//   unit: string;
//   isActive: boolean;
//   createdAt: string;
//   updatedAt: string;
// };

// // Stock movement (audit trail entry)
// export type PublicStockMovement = {
//   id: string;
//   companyId: string;
//   productId: string;
//   movementType: string;
//   quantity: number;
//   referenceNote: string | null;
//   performedBy: string | null;
//   createdAt: string;
// };

// // Input for creating/updating a product
// export type ProductInput = {
//   sku: string;
//   name: string;
//   categoryId: string;
//   supplierId: string;
//   costPrice: number;
//   sellPrice: number;
//   taxRate: number;
//   quantityInStock: number;
//   unit: string;
// };

// // Input for updating a product (no quantity change)
// export type UpdateProductInput = {
//   productId: string;
//   sku: string;
//   name: string;
//   categoryId: string;
//   supplierId: string;
//   costPrice: number;
//   sellPrice: number;
//   taxRate: number;
//   unit: string;
// };

// // Input for stock adjustment
// export type StockAdjustmentInput = {
//   productId: string;
//   movementType: string;
//   quantity: number;
//   referenceNote: string;
// };

// // ==========================================
// // IMPORT WIZARD TYPES
// // ==========================================

// // A proposed mapping for one Excel column
// export type FieldMapping = {
//   sourceColumn: string;
//   sourceIndex: number;
//   targetField: string; // "name", "sku", "cost_price", "sell_price", "custom:<name>"
//   fieldCategory: string; // "core" or "custom"
//   confidence: string; // "high", "medium", "low", "unknown"
// };

// // What Rust sends back after analyzing a file
// export type FileAnalysis = {
//   headers: string[];
//   sampleRows: string[][];
//   totalRows: number;
//   fileType: string;
//   proposedMappings: FieldMapping[];
// };

// // What we send back when user confirms the mapping
// export type ImportRequest = {
//   mappings: FieldMapping[];
//   fileBytes: number[];
//   fileType: string;
//   templateName: string;
//   importData: boolean;
// };

// // Result of the import
// export type ImportResult = {
//   fieldsCreated: number;
//   productsImported: number;
//   rowsWithErrors: number;
//   errors: ImportError[];
// };

// export type ImportError = {
//   rowNumber: number;
//   reason: string;
// };

// // Custom field definition (from company_field_settings)
// export type CustomFieldSetting = {
//   id: string;
//   companyId: string;
//   fieldName: string;
//   fieldLabel: string;
//   fieldType: string; // "text", "number", "date", "dropdown"
//   isVisible: boolean;
//   fieldOrder: number;
//   validationRules: string | null;
//   defaultValue: string | null;
//   createdAt: string;
//   updatedAt: string;
// };

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
