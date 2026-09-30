import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Card,
  Group,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { Zap } from "lucide-react";
import {
  getErrorMessage,
  listCompanyModules,
  setCompanyModule,
} from "../../../api/backend";
import type { PublicCompanyModule } from "../../../types/backend";

const MODULE_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  inventory: { label: "Inventory", description: "Products, stock management & suppliers" },
  invoices: { label: "Invoices", description: "Create, finalize & manage customer invoices" },
  purchase_orders: { label: "Purchasing", description: "Purchase orders from suppliers" },
  pos: { label: "Point of Sale", description: "Fast barcode cashier counter" },
  fbr: { label: "FBR Fiscal Invoicing", description: "Real-time FBR digital invoicing integration" },
  reports: { label: "Reports", description: "Sales, stock & profit analytics" },
  ledger: { label: "Accounts", description: "Chart of accounts & journal entries" },
  users: { label: "Team", description: "Manage company users & roles" },
  settings: { label: "Settings", description: "Company profile, invoice design & backup" },
  import: { label: "Import", description: "Import products, customers & invoices from files" },
  data_import: { label: "Import", description: "Import products, customers & invoices from files" },
};

interface ModulesTabProps {
  companyId: string;
}

export function ModulesTab({ companyId }: ModulesTabProps) {
  const [modules, setModules] = useState<PublicCompanyModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadModules = useCallback(async () => {
    try {
      const list = await listCompanyModules(companyId);
      setModules(list);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  const handleToggle = async (moduleKey: string, currentValue: boolean) => {
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
        <Group gap="sm" mb="sm">
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 38,
              height: 38,
              borderRadius: 12,
              background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
              color: "#131C39",
            }}
          >
            <Zap size={18} />
          </span>
          <Title order={5}>Modules</Title>
        </Group>
        <Text size="sm" c="dimmed" mb="lg">
          Enable or disable modules for your company. Disabled modules are hidden
          from the sidebar and their data is not accessible.
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
            return (
              <Group
                key={mod.id}
                justify="space-between"
                p="md"
                style={{
                  borderRadius: 8,
                  border: "1px solid var(--app-border)",
                  background: "var(--app-surface)",
                }}
              >
                <Stack gap={2}>
                  <Text fw={500} size="sm">
                    {meta?.label ?? mod.moduleKey}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {meta?.description ?? mod.moduleKey}
                  </Text>
                </Stack>
                <Switch
                  checked={mod.isEnabled}
                  onChange={() => void handleToggle(mod.moduleKey, mod.isEnabled)}
                  disabled={
                    saving !== null ||
                    mod.moduleKey === "settings" ||
                    mod.moduleKey === "ledger"
                  }
                />
              </Group>
            );
          })}
          {modules.length === 0 && (
            <Text c="dimmed" ta="center" py="md">
              No modules found. Run a database migration to seed default modules.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
