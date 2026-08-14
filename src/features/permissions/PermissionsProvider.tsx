// ==========================================
// PERMISSIONS PROVIDER — the real UI gate
// ==========================================
//
// Backs every "can I do this?" check in the workspace with the permission
// matrix returned by `get_my_permissions` (roles.rs). Owner always passes;
// everyone else is matched against their role's `role_permissions` rows —
// including custom roles granted module permissions by the owner.
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

import { getMyPermissions } from "../../api/backend";
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
}

const PermissionsCtx = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [permissions, setPermissions] = useState<RolePermission[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getMyPermissions()
      .then((r) => {
        if (cancelled) return;
        setRole(r.role);
        setPermissions(r.permissions);
      })
      .catch(() => {
        // Fall back to a safe empty matrix; navigation collapses to the
        // always-visible shell items. The backend still enforces access.
        if (cancelled) return;
        setRole(null);
        setPermissions([]);
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

  const value = useMemo<PermissionsContextValue>(
    () => ({
      loading,
      role,
      isOwner: role === "owner",
      canManage: role === "owner" || role === "admin",
      can,
      permissions,
    }),
    [loading, role, can, permissions],
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
