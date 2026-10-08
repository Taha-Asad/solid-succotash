import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Card,
  Group,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { Lock, Zap } from "lucide-react";
import {
  getCurrentSubscription,
  getErrorMessage,
  listCompanyModules,
  listPackages,
  setCompanyModule,
} from "../../../api/backend";
import type { PublicCompanyModule, PublicPackage, PublicSubscription } from "../../../types/backend";
import { usePermissions } from "../../permissions/PermissionsProvider";

const CORE_UNINACTIVATABLE_MODULES = [
  "dashboard",
  "inventory",
  "invoices",
  "settings",
  "users",
];

const MODULE_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  dashboard: { label: "App Dashboard", description: "Home overview, sales analytics & performance metrics (Core)" },
  inventory: { label: "Inventory", description: "Products, stock management & suppliers (Core)" },
  invoices: { label: "Invoices", description: "Create, finalize & manage customer sales invoices (Core)" },
  customers: { label: "Customers", description: "Customer directory, contact profiles & khata balance" },
  purchase_orders: { label: "Purchasing", description: "Purchase orders & supplier receiving" },
  pos: { label: "Point of Sale", description: "Fast barcode cashier counter" },
  fbr: { label: "FBR Fiscal Invoicing", description: "Real-time FBR digital invoicing integration (Standard/Premium)" },
  reports: { label: "Reports", description: "Sales, stock & profit analytics" },
  ledger: { label: "Accounts", description: "Chart of accounts & double-entry journal" },
  users: { label: "Team", description: "Manage company users & permissions (Core)" },
  settings: { label: "Settings", description: "Company profile, invoice design & backup (Core)" },
  import: { label: "Import", description: "Import products, customers & invoices from files" },
  data_import: { label: "Import", description: "Import products, customers & invoices from files" },
};

interface ModulesTabProps {
  companyId: string;
}

export function ModulesTab({ companyId }: ModulesTabProps) {
  const [modules, setModules] = useState<PublicCompanyModule[]>([]);
  const [, setSub] = useState<PublicSubscription | null>(null);
  const [currentPackage, setCurrentPackage] = useState<PublicPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { refreshModules } = usePermissions();

  const loadModules = useCallback(async () => {
    try {
      const [list, subData, packages] = await Promise.all([
        listCompanyModules(companyId),
        getCurrentSubscription().catch(() => null),
        listPackages().catch(() => []),
      ]);
      setModules(list);
      setSub(subData);
      if (subData) {
        const pkg = packages.find((p) => p.id === subData.packageId);
        if (pkg) setCurrentPackage(pkg);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const isModuleEntitled = (moduleKey: string): boolean => {
    if (CORE_UNINACTIVATABLE_MODULES.includes(moduleKey)) return true;
    if (!currentPackage) return true;

    const limits = (currentPackage.moduleLimits ?? {}) as Record<string, unknown>;
    const features = (currentPackage.features ?? {}) as Record<string, unknown>;

    if (moduleKey === "fbr") {
      return features.fbr === true || limits.fbr === 1;
    }
    if (moduleKey === "import" || moduleKey === "data_import") {
      return features.data_import === true || limits.import === 1 || limits.data_import === 1;
    }
    if (limits[moduleKey] !== undefined) {
      const val = limits[moduleKey];
      return typeof val === "number" ? val > 0 : Boolean(val);
    }
    if (features[moduleKey] !== undefined) {
      return Boolean(features[moduleKey]);
    }
    return true;
  };

  const handleToggle = async (moduleKey: string, currentValue: boolean) => {
    if (CORE_UNINACTIVATABLE_MODULES.includes(moduleKey)) {
      return;
    }
    if (!isModuleEntitled(moduleKey) && !currentValue) {
      setError(`Module is not included in your active ${currentPackage?.name ?? "subscription"} plan. Upgrade your plan to enable it.`);
      return;
    }

    setSaving(moduleKey);
    setError(null);
    setSuccess(null);
    try {
      await setCompanyModule({ companyId, moduleKey, isEnabled: !currentValue });
      setModules((prev) =>
        prev.map((m) =>
          m.moduleKey === moduleKey ? { ...m, isEnabled: !currentValue } : m
        )
      );
      // Immediately notify permissions system and sidebar
      await refreshModules();
      setSuccess(
        `${MODULE_DESCRIPTIONS[moduleKey]?.label ?? moduleKey} ${!currentValue ? "enabled" : "disabled"}.`
      );
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <Text c="dimmed">Loading modules...</Text>;
  }

  return (
    <Stack gap="lg">
      <Card withBorder padding="lg" maw={700}>
        <Group justify="space-between" mb="sm">
          <Group gap="sm">
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 12,
                background: "var(--app-accent-gradient)",
                color: "var(--app-on-accent, #0A0A0C)",
              }}
            >
              <Zap size={18} />
            </span>
            <Title order={5}>Feature Modules</Title>
          </Group>
          {currentPackage && (
            <Badge variant="light" color="blue" size="md">
              Plan: {currentPackage.name}
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed" mb="lg">
          Configure active modules for your company. Disabled modules are immediately hidden
          from the application sidebar. Core operational modules remain permanently active.
        </Text>

        {error && (
          <Alert color="red" title="Error" variant="light" mb="md">
            {error}
          </Alert>
        )}
        {success && (
          <Alert color="green" title="Updated" variant="light" mb="md">
            {success}
          </Alert>
        )}

        <Stack gap="md">
          {modules.map((mod) => {
            const meta = MODULE_DESCRIPTIONS[mod.moduleKey];
            const isCore = CORE_UNINACTIVATABLE_MODULES.includes(mod.moduleKey);
            const entitled = isModuleEntitled(mod.moduleKey);

            return (
              <Group
                key={mod.id}
                justify="space-between"
                p="md"
                style={{
                  borderRadius: 8,
                  border: isCore
                    ? "1px solid rgba(201, 149, 42, 0.3)"
                    : !entitled
                    ? "1px dashed var(--app-border)"
                    : "1px solid var(--app-border)",
                  background: isCore
                    ? "rgba(201, 149, 42, 0.03)"
                    : !entitled
                    ? "rgba(0, 0, 0, 0.03)"
                    : "var(--app-surface)",
                  opacity: !entitled ? 0.75 : 1,
                }}
              >
                <Stack gap={2}>
                  <Group gap="xs">
                    <Text fw={500} size="sm">
                      {meta?.label ?? mod.moduleKey}
                    </Text>
                    {isCore && (
                      <Badge size="xs" color="yellow" variant="light">
                        Core (Mandatory)
                      </Badge>
                    )}
                    {!entitled && (
                      <Tooltip label={`Requires upgrading to a higher tier plan`}>
                        <Badge size="xs" color="orange" variant="light" leftSection={<Lock size={10} />}>
                          Requires Plan Upgrade
                        </Badge>
                      </Tooltip>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {meta?.description ?? mod.moduleKey}
                  </Text>
                </Stack>
                <Switch
                  checked={isCore ? true : (entitled && mod.isEnabled)}
                  onChange={() => void handleToggle(mod.moduleKey, mod.isEnabled)}
                  disabled={saving !== null || isCore || !entitled}
                  color="teal"
                />
              </Group>
            );
          })}
          {modules.length === 0 && (
            <Text c="dimmed" ta="center" py="md">
              No modules found.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}


