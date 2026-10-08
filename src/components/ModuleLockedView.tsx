// ==========================================
// MODULE LOCKED VIEW — PLAN GATING FALLBACK
// ==========================================
// Renders when a client user attempts to navigate to a module
// that is excluded by their active subscription plan or has been
// toggled OFF by enterprise administration.

import { Box, Button, Card, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { ArrowLeft, Lock, ShieldAlert } from "lucide-react";

interface ModuleLockedViewProps {
  moduleKey: string;
  moduleTitle?: string;
  onBack: () => void;
}

const MODULE_TITLES: Record<string, string> = {
  home: "Dashboard",
  inventory: "Inventory Management",
  invoices: "Invoicing & Accounts Receivable",
  customers: "Customer Ledgers & Directory",
  purchasing: "Procurement & Purchase Orders",
  import: "Data Import Engine",
  reports: "Financial & Operational Reports",
  accounts: "General Ledger & Accounting",
  users: "Team & Role Access",
  settings: "Workspace Settings",
};

export default function ModuleLockedView({
  moduleKey,
  moduleTitle,
  onBack,
}: ModuleLockedViewProps) {
  const displayTitle = moduleTitle || MODULE_TITLES[moduleKey] || moduleKey;

  return (
    <Box
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "70vh",
        padding: 24,
      }}
    >
      <Card
        withBorder
        padding="xl"
        radius="lg"
        maw={520}
        style={{
          textAlign: "center",
          background: "var(--app-surface)",
          borderColor: "var(--app-border)",
          boxShadow: "var(--app-shadow)",
        }}
      >
        <Stack align="center" gap="md">
          <ThemeIcon
            size={64}
            radius="xl"
            style={{
              background: "rgba(239, 68, 68, 0.12)",
              color: "#EF4444",
              border: "1px solid rgba(239, 68, 68, 0.25)",
            }}
          >
            <ShieldAlert size={32} />
          </ThemeIcon>

          <Box>
            <Title order={3} style={{ color: "var(--app-text)", fontWeight: 750 }}>
              Module Restricted
            </Title>
            <Text size="sm" c="dimmed" mt={4}>
              {displayTitle} is unavailable on your current workspace configuration.
            </Text>
          </Box>

          <Box
            p="md"
            style={{
              width: "100%",
              borderRadius: 12,
              background: "var(--app-soft)",
              border: "1px solid var(--app-border)",
              textAlign: "left",
            }}
          >
            <Group gap="xs" mb={4}>
              <Lock size={14} color="var(--app-muted)" />
              <Text size="xs" fw={700} style={{ color: "var(--app-text)" }}>
                Subscription Plan Restriction
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              This feature is not part of your active plan or has been disabled by platform
              administration. Contact your enterprise Super Administrator to upgrade your
              subscription tier and unlock this capability.
            </Text>
          </Box>

          <Button
            leftSection={<ArrowLeft size={16} />}
            onClick={onBack}
            style={{
              background: "var(--app-accent, #3B82F6)",
              color: "#FFFFFF",
              fontWeight: 600,
              borderRadius: 10,
              marginTop: 8,
            }}
          >
            Return to Dashboard
          </Button>
        </Stack>
      </Card>
    </Box>
  );
}
