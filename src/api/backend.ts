// // ==========================================
// // API LAYER — All Tauri invoke calls live here
// // ==========================================
// //
// // This file is the ONLY place in your React code that calls invoke().
// // Every page/component imports functions from here instead of calling
// // invoke directly. This means if you ever change how commands work,
// // you edit ONE file, not ten.
// //
// // invoke("command_name", data) sends a message to Rust.
// // Rust receives it by matching the command name and parameter names.
// // The data object's KEYS must match Rust's PARAMETER NAMES exactly.

// import { invoke } from "@tauri-apps/api/core";

// import type {
//   CompanySetupInput,
//   CreateUserInput,
//   LoginInput,
//   PublicCompany,
//   PublicUser,
//   RegisterCompanyResult,
//   SetActiveInput,
//   UpdateRoleInput,
// } from "../types/backend";

// // ==========================================
// // COMPANY SETUP
// // ==========================================

// // Check if a company has been registered yet (first launch detection)
// export function isCompanySetup(): Promise<boolean> {
//   return invoke<boolean>("is_company_setup");
// }

// // Register the first company + owner account
// // Sends each field individually to match Rust parameters
// export function registerCompany(
//   input: CompanySetupInput,
// ): Promise<RegisterCompanyResult> {
//   return invoke<RegisterCompanyResult>("register_company", input);
// }

// // ==========================================
// // AUTHENTICATION
// // ==========================================

// export function loginUser(input: LoginInput): Promise<PublicUser> {
//   return invoke<PublicUser>("login_user", input);
// }

// export function logoutUser(): Promise<void> {
//   return invoke<void>("logout_user");
// }

// export function getCurrentUser(): Promise<PublicUser> {
//   return invoke<PublicUser>("current_user");
// }

// export function updateMyProfile(fullName: string): Promise<PublicUser> {
//   return invoke<PublicUser>("update_my_profile", { fullName });
// }

// export function changeMyPassword(
//   currentPassword: string,
//   newPassword: string,
// ): Promise<PublicUser> {
//   return invoke<PublicUser>("change_my_password", {
//     currentPassword,
//     newPassword,
//   });
// }

// // ==========================================
// // COMPANY
// // ==========================================

// export function getCompany(): Promise<PublicCompany> {
//   return invoke<PublicCompany>("get_company");
// }

// export function updateCompany(input: {
//   name: string;
//   email: string | null;
//   phone: string | null;
//   address: string | null;
//   taxNumber: string | null;
//   currencyCode: string;
// }): Promise<PublicCompany> {
//   return invoke<PublicCompany>("update_company", input);
// }

// // ==========================================
// // USER MANAGEMENT (owner/admin only)
// // ==========================================

// export function listCompanyUsers(): Promise<PublicUser[]> {
//   return invoke<PublicUser[]>("list_company_users");
// }

// export function createCompanyUser(input: CreateUserInput): Promise<PublicUser> {
//   return invoke<PublicUser>("create_company_user", input);
// }

// export function updateCompanyUserRole(
//   input: UpdateRoleInput,
// ): Promise<PublicUser> {
//   return invoke<PublicUser>("update_company_user_role", input);
// }

// export function setCompanyUserActive(
//   input: SetActiveInput,
// ): Promise<PublicUser> {
//   return invoke<PublicUser>("set_company_user_active", input);
// }

// // ==========================================
// // ERROR HELPER
// // ==========================================

// // Turns any unknown error into a readable string
// export function getErrorMessage(error: unknown): string {
//   if (typeof error === "string") {
//     return error;
//   }

//   if (error instanceof Error) {
//     return error.message;
//   }

//   try {
//     return JSON.stringify(error);
//   } catch {
//     return "An unknown error occurred";
//   }
// }

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
  CompanySetupInput,
  CreateUserInput,
  FileAnalysis,
  ImportRequest,
  ImportResult,
  LoginInput,
  ProductInput,
  PublicCategory,
  PublicCompany,
  PublicProduct,
  PublicStockMovement,
  PublicSupplier,
  PublicUser,
  RegisterCompanyResult,
  SetActiveInput,
  StockAdjustmentInput,
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
): Promise<PublicUser> {
  return invoke<PublicUser>("change_my_password", {
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
}): Promise<FileAnalysis> {
  return invoke<FileAnalysis>("analyze_import_file", input);
}

// Step 2: Send confirmed mapping + file bytes, Rust imports everything
export function executeImport(input: ImportRequest): Promise<ImportResult> {
  return invoke<ImportResult>("execute_import", { request: input });
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
