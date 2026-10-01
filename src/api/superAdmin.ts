import { invoke } from "@tauri-apps/api/core";
import type { PublicUser, PublicCompany } from "../types/backend";

export interface AdminCompanySummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
  currencyCode: string;
  isActive: boolean;
  createdAt: string;
  packageId: string | null;
  packageName: string | null;
  subscriptionStatus: string | null;
  userCount: number;
  invoiceCount: number;
  totalRevenue: number;
}

export interface CompanySubscriptionRecord {
  id: string;
  companyId: string;
  packageId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  metadata: string;
}

export interface PackageRecord {
  id: string;
  name: string;
  description: string | null;
  price: number;
  billingCycle: string;
  moduleLimits: string;
  maxUsers: number;
  maxBranches: number;
  maxStorageMb: number;
  features: string;
  isActive: boolean;
  sortOrder: number;
}

export interface CompanyModuleRecord {
  id: string;
  companyId: string;
  moduleKey: string;
  isEnabled: boolean;
  settings: string;
}

export interface TenantFeatureFlagRecord {
  id: string;
  companyId: string;
  featureKey: string;
  isEnabled: boolean;
  enabledBy: string | null;
  reason: string | null;
}

export interface AdminCompanyDetail {
  company: PublicCompany;
  subscription: CompanySubscriptionRecord | null;
  package: PackageRecord | null;
  modules: CompanyModuleRecord[];
  featureFlags: TenantFeatureFlagRecord[];
  users: PublicUser[];
  userCount: number;
  invoiceCount: number;
  totalRevenue: number;
}

export interface PackageStat {
  packageId: string;
  packageName: string;
  tenantCount: number;
}

export interface AdminAuditRecord {
  id: string;
  companyId: string;
  userId: string;
  action: string;
  entityType: string;
  details: string | null;
  createdAt: string;
}

export interface SystemAnalytics {
  totalCompanies: number;
  activeCompanies: number;
  totalUsers: number;
  totalInvoices: number;
  totalVolumePaisas: number;
  packageDistribution: PackageStat[];
  recentActivities: AdminAuditRecord[];
}

export interface CreateTenantPayload {
  companyName: string;
  email?: string;
  phone?: string;
  address?: string;
  currencyCode?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  packageId?: string;
}

export async function adminGetSystemAnalytics(): Promise<SystemAnalytics> {
  return invoke<SystemAnalytics>("admin_get_system_analytics");
}

export async function adminListCompanies(): Promise<AdminCompanySummary[]> {
  return invoke<AdminCompanySummary[]>("admin_list_companies");
}

export async function adminGetCompanyDetails(companyId: string): Promise<AdminCompanyDetail> {
  return invoke<AdminCompanyDetail>("admin_get_company_details", { companyId });
}

export async function adminCreateCompany(payload: CreateTenantPayload): Promise<AdminCompanySummary> {
  return invoke<AdminCompanySummary>("admin_create_company", { payload });
}

export async function adminUpdateCompanyStatus(companyId: string, isActive: boolean): Promise<void> {
  return invoke<void>("admin_update_company_status", { companyId, isActive });
}

export async function adminUpdateCompanyPackage(companyId: string, packageId: string): Promise<void> {
  return invoke<void>("admin_update_company_package", { companyId, packageId });
}

export async function adminListPackages(): Promise<PackageRecord[]> {
  return invoke<PackageRecord[]>("admin_list_packages");
}

export async function adminToggleFeatureFlag(companyId: string, featureKey: string, isEnabled: boolean): Promise<void> {
  return invoke<void>("admin_toggle_feature_flag", { companyId, featureKey, isEnabled });
}

export async function adminBootstrapSuperAdmin(
  email: string,
  password: string,
  fullName: string
): Promise<PublicUser> {
  return invoke<PublicUser>("admin_bootstrap_super_admin", { email, password, fullName });
}
