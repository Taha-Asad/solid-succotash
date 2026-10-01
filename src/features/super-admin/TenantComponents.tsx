import { Badge } from "@mantine/core";
import { useI18n } from "../../i18n/I18nProvider";
import { useSaScheme } from "./saTheme.tsx";

export const SUB_STATUS_COLOR: Record<
  string,
  {
    bgDark: string;
    fgDark: string;
    borderDark: string;
    bgLight: string;
    fgLight: string;
    borderLight: string;
  }
> = {
  active: {
    bgDark: "#064E3B",
    fgDark: "#6EE7B7",
    borderDark: "#059669",
    bgLight: "#ECFDF5",
    fgLight: "#065F46",
    borderLight: "#A7F3D0",
  },
  trial: {
    bgDark: "#0C4A6E",
    fgDark: "#7DD3FC",
    borderDark: "#0284C7",
    bgLight: "#F0F9FF",
    fgLight: "#0369A1",
    borderLight: "#BAE6FD",
  },
  past_due: {
    bgDark: "#78350F",
    fgDark: "#FDE68A",
    borderDark: "#D97706",
    bgLight: "#FFFBEB",
    fgLight: "#92400E",
    borderLight: "#FDE68A",
  },
  suspended: {
    bgDark: "#7F1D1D",
    fgDark: "#FECACA",
    borderDark: "#DC2626",
    bgLight: "#FEF2F2",
    fgLight: "#991B1B",
    borderLight: "#FECACA",
  },
  cancelled: {
    bgDark: "#1E293B",
    fgDark: "#94A3B8",
    borderDark: "#475569",
    bgLight: "#F1F5F9",
    fgLight: "#475569",
    borderLight: "#CBD5E1",
  },
  ended: {
    bgDark: "#1E293B",
    fgDark: "#94A3B8",
    borderDark: "#475569",
    bgLight: "#F1F5F9",
    fgLight: "#475569",
    borderLight: "#CBD5E1",
  },
};

export function SubBadge({ status }: { status: string | null }) {
  const { t } = useI18n();
  const { scheme } = useSaScheme();
  if (!status) return null;
  const c = SUB_STATUS_COLOR[status] ?? SUB_STATUS_COLOR.cancelled;
  const isDark = scheme === "dark";

  return (
    <Badge
      size="sm"
      variant="filled"
      styles={{
        root: {
          background: isDark ? c.bgDark : c.bgLight,
          color: isDark ? c.fgDark : c.fgLight,
          border: `1px solid ${isDark ? c.borderDark : c.borderLight}`,
          fontWeight: 700,
          letterSpacing: 0.3,
        },
        label: { textTransform: "capitalize" },
      }}
    >
      {t(`sa.sub.${status}`)}
    </Badge>
  );
}

export interface ModuleMetadata {
  title: string;
  description: string;
}

export const MODULE_CATALOG: Record<string, ModuleMetadata> = {
  dashboard: {
    title: "Executive Dashboard",
    description: "Real-time revenue, margins, and key performance indicators",
  },
  inventory: {
    title: "Inventory & Warehousing",
    description: "Stock levels, multi-batch expiry dates, units, and barcode tracking",
  },
  invoices: {
    title: "Invoicing & Sales",
    description: "Tax-compliant invoices, customer accounts, and payment collection",
  },
  customers: {
    title: "Customer CRM",
    description: "Client directory, credit limits, and running balances",
  },
  purchase_orders: {
    title: "Purchases & Suppliers",
    description: "Supplier vendor management and procurement order tracking",
  },
  pos: {
    title: "POS Quick Terminal",
    description: "Rapid counter checkout with receipt printing & barcode scanning",
  },
  ledger: {
    title: "Accounting Ledger",
    description: "Double-entry journal, chart of accounts, and P&L balances",
  },
  reports: {
    title: "Advanced Analytics",
    description: "Detailed stock movement, top products, and profitability exports",
  },
  settings: {
    title: "Workspace Settings",
    description: "Brand tokens, tax configuration, multi-currency, and backups",
  },
  import: {
    title: "Data Import Wizard",
    description: "CSV/Excel bulk import with automated column mapping",
  },
  users: {
    title: "Employee Access & RBAC",
    description: "Staff management, custom role assignments, and permission matrices",
  },
  fbr: {
    title: "FBR Digital Fiscalization",
    description: "Real-time automated PRAL transmission & electronic verification",
  },
};

export const MODULE_LABELS: Record<string, string> = {
  dashboard: "sa.module.dashboard",
  inventory: "sa.module.inventory",
  sales: "sa.module.sales",
  purchases: "sa.module.purchases",
  reports: "sa.module.reports",
  employees: "sa.module.employees",
  branches: "sa.module.branches",
  invoices: "sa.module.invoices",
  import: "sa.module.import",
  data_import: "sa.module.dataImport",
  pos: "POS Terminal",
  ledger: "Accounting Ledger",
  users: "Staff Management",
  fbr: "FBR / PRAL",
  customers: "Customers",
  purchase_orders: "Purchase Orders",
};
