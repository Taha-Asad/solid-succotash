// ==========================================
// PERMISSIONS PROVIDER — the real UI gate
// ==========================================
//
// Backs every "can I do this?" check in the workspace with the permission
// matrix returned by `get_my_permissions` (roles.rs). Owner always passes;
// everyone else is matched against their role's `role_permissions` rows —
// including custom roles granted module permissions by the owner.
//
// Also fetches enabled modules from `get_my_modules` (company_modules table)
// so the sidebar can hide disabled modules.
//
// Pages used to hard-code `role === "owner" || role === "admin"` (canManage),
// which made the Roles & Permissions matrix cosmetic: granting an employee
// `invoices:create` did nothing because the button was hidden by the role
// check. This provider is the single source of truth the pages read instead.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getMyPermissions, getMyModules } from "../../api/backend";
import type { RolePermission } from "../../types/backend";

interface PermissionsContextValue {
  /** True until the permission matrix has loaded. */
  loading: boolean;
  role: string | null;
  isOwner: boolean;
  /** Coarse owner/admin gate kept for surfaces without a matrix module
   *  (customers CRUD, the Import bulk tool). */
  canManage: boolean;
  /** True when the current role allows `module:permission`. */
  can: (module: string, permission: string) => boolean;
  permissions: RolePermission[];
  /** Enabled module keys from company_modules table. */
  enabledModules: string[];
  /** True if the given module key is enabled. Core modules (inventory, invoices, settings) are always enabled. */
  isModuleEnabled: (moduleKey: string) => boolean;
  /** Re-fetch enabled modules from the backend. */
  refreshModules: () => Promise<void>;
}

const PermissionsCtx = createContext<PermissionsContextValue | null>(null);

const CORE_UNINACTIVATABLE_MODULES = ["inventory", "invoices", "settings"];

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [enabledModules, setEnabledModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchModules = useCallback(async () => {
    try {
      const modules = await getMyModules();
      setEnabledModules(modules);
    } catch {
      // keep existing
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMyPermissions(), getMyModules().catch(() => [])])
      .then(([permResult, modules]) => {
        if (cancelled) return;
        setRole(permResult.role);
        setPermissions(permResult.permissions);
        setEnabledModules(modules);
      })
      .catch(() => {
        // Fall back to a safe empty matrix; navigation collapses to the
        // always-visible shell items. The backend still enforces access.
        if (cancelled) return;
        setRole(null);
        setPermissions([]);
        setEnabledModules([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const can = useCallback(
    (module: string, permission: string) => {
      if (role === "owner") return true;
      const entry = permissions.find(
        (p) => p.module === module && p.permission === permission,
      );
      return entry ? entry.allowed : false;
    },
    [role, permissions],
  );

  const isModuleEnabled = useCallback(
    (moduleKey: string) => {
      const key = moduleKey === "app" ? "dashboard" : moduleKey;
      // Inventory, Invoices, and Settings can NEVER be deactivated
      if (CORE_UNINACTIVATABLE_MODULES.includes(key)) {
        return true;
      }
      if (loading && enabledModules.length === 0) return true;
      return enabledModules.includes(key);
    },
    [enabledModules, loading],
  );

  const value = useMemo<PermissionsContextValue>(
    () => ({
      loading,
      role,
      isOwner: role === "owner",
      canManage: role === "owner" || role === "admin",
      can,
      permissions,
      enabledModules,
      isModuleEnabled,
      refreshModules: fetchModules,
    }),
    [loading, role, can, permissions, enabledModules, isModuleEnabled, fetchModules],
  );

  return (
    <PermissionsCtx.Provider value={value}>
      {children}
    </PermissionsCtx.Provider>
  );
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsCtx);
  if (!ctx) throw new Error("usePermissions must be used inside PermissionsProvider");
  return ctx;
}
