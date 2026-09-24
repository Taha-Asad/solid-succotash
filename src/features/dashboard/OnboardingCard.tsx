// ============================================================================
// STORE SETUP CHECKLIST (Non-blocking, Anti-slop Onboarding)
// Clean, token-driven launchpad for Pakistani retail merchants.
// Designed under Crow Parliament ethos (Julian Mercer MERCER-UX & Marcus Sterling)
// ============================================================================

import { useState } from "react";
import {
  Box,
  Button,
  Group,
  RingProgress,
  Text,
  ActionIcon,
  Tooltip,
  Collapse,
  Badge,
} from "@mantine/core";
import {
  Building2,
  PackagePlus,
  ReceiptText,
  ShieldCheck,
  CheckCircle2,
  Circle,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import type { PublicUser } from "../../types/backend";

const LEDGER_NUM: React.CSSProperties = {
  fontFamily:
    'ui-monospace, "SF Mono", "Roboto Mono", "JetBrains Mono", Menlo, monospace',
  fontVariantNumeric: "tabular-nums",
};

interface OnboardingCardProps {
  user: PublicUser;
  hasCompanyDetails: boolean;
  hasProducts: boolean;
  hasInvoices: boolean;
  onNavigate: (module: string) => void;
}

export default function OnboardingCard({
  user,
  hasCompanyDetails,
  hasProducts,
  hasInvoices,
  onNavigate,
}: OnboardingCardProps) {
  const dismissKey = `ijaz_onboarding_dismissed_${user.id}`;
  const collapseKey = `ijaz_onboarding_collapsed_${user.id}`;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(dismissKey) === "true";
    } catch {
      return false;
    }
  });

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(collapseKey) === "true";
    } catch {
      return false;
    }
  });

  const [hasBackup] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`ijaz_backup_performed_${user.id}`) === "true";
    } catch {
      return false;
    }
  });

  const steps = [
    {
      id: "company",
      title: "Store Profile & Bill Header",
      description: "Set your store name, NTN, phone and address for invoices",
      completed: hasCompanyDetails,
      actionLabel: "Configure",
      module: "settings",
      icon: <Building2 size={16} />,
    },
    {
      id: "products",
      title: "Add Products & Pricing",
      description: "Enter retail inventory or import directly from Excel/CSV",
      completed: hasProducts,
      actionLabel: "Add Item",
      module: "inventory",
      icon: <PackagePlus size={16} />,
    },
    {
      id: "invoices",
      title: "Record First Customer Sale",
      description: "Issue a sales invoice and verify the printed receipt",
      completed: hasInvoices,
      actionLabel: "New Bill",
      module: "invoices",
      icon: <ReceiptText size={16} />,
    },
    {
      id: "backup",
      title: "Create Database Backup",
      description: "Download a local backup to keep your accounts safe",
      completed: hasBackup,
      actionLabel: "Backup",
      module: "settings",
      icon: <ShieldCheck size={16} />,
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey, "true");
    } catch {
      // ignore
    }
  }

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(collapseKey, String(next));
    } catch {
      // ignore
    }
  }

  // Once all steps are completed, cleanly retire from the dashboard
  if (completedCount === steps.length) {
    return null;
  }

  // When dismissed by user, offer an unobtrusive mini-pill
  if (dismissed) {
    return (
      <Box
        px="md"
        py={6}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderRadius: 10,
          background: "var(--app-surface)",
          border: "1px solid var(--app-border)",
        }}
      >
        <Group gap="xs">
          <Sparkles size={14} color="var(--app-accent)" />
          <Text size="xs" fw={600} style={{ color: "var(--app-text)" }}>
            Setup Checklist: <span style={LEDGER_NUM}>{completedCount} of {steps.length}</span> completed ({progressPercent}%)
          </Text>
        </Group>
        <Button
          variant="subtle"
          size="compact-xs"
          onClick={() => {
            setDismissed(false);
            try {
              localStorage.removeItem(dismissKey);
            } catch {
              // ignore
            }
          }}
        >
          Resume Setup
        </Button>
      </Box>
    );
  }

  return (
    <Box
      p="md"
      style={{
        background: "var(--app-surface)",
        border: "1px solid var(--app-border)",
        borderRadius: 16,
        boxShadow: "0 2px 8px -2px rgba(0,0,0,0.04)",
      }}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap="sm" align="center">
          <RingProgress
            size={42}
            thickness={4}
            roundCaps
            sections={[{ value: progressPercent, color: "var(--app-accent)" }]}
            label={
              <Text c="var(--app-accent)" fw={700} ta="center" size="10px" style={LEDGER_NUM}>
                {progressPercent}%
              </Text>
            }
          />
          <div>
            <Group gap={6} align="center">
              <Text fw={700} size="sm" style={{ color: "var(--app-text)" }}>
                Store Setup Checklist
              </Text>
              <Badge size="xs" variant="light" color={progressPercent === 100 ? "green" : "blue"} style={LEDGER_NUM}>
                {completedCount} / {steps.length} Done
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Complete these setup tasks to get your store fully operational.
            </Text>
          </div>
        </Group>

        <Group gap={4}>
          <Tooltip label={collapsed ? "Expand checklist" : "Minimize checklist"}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              radius="md"
              onClick={toggleCollapse}
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Dismiss setup guide">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              radius="md"
              onClick={handleDismiss}
            >
              <X size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Collapse expanded={!collapsed}>
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginTop: 14,
          }}
        >
          {steps.map((step) => (
            <Box
              key={step.id}
              p="sm"
              style={{
                borderRadius: 12,
                background: step.completed ? "var(--app-soft)" : "var(--app-surface)",
                border: "1px solid var(--app-border)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div>
                <Group justify="space-between" align="center" mb={6}>
                  <Box
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      background: step.completed
                        ? "color-mix(in srgb, #1E8E5A 15%, transparent)"
                        : "color-mix(in srgb, var(--app-accent) 15%, transparent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: step.completed ? "#1E8E5A" : "var(--app-accent)",
                    }}
                  >
                    {step.icon}
                  </Box>
                  {step.completed ? (
                    <Group gap={4}>
                      <CheckCircle2 size={14} color="#1E8E5A" />
                      <Text size="11px" fw={700} c="green">
                        Completed
                      </Text>
                    </Group>
                  ) : (
                    <Group gap={4}>
                      <Circle size={12} color="var(--app-muted)" />
                      <Text size="11px" c="dimmed">
                        Pending
                      </Text>
                    </Group>
                  )}
                </Group>

                <Text fw={600} size="xs" style={{ color: "var(--app-text)" }} lineClamp={1}>
                  {step.title}
                </Text>
                <Text size="11px" c="dimmed" mt={2} lineClamp={2} style={{ minHeight: 28 }}>
                  {step.description}
                </Text>
              </div>

              <Button
                variant={step.completed ? "default" : "filled"}
                size="compact-xs"
                radius="sm"
                fullWidth
                rightSection={<ArrowRight size={11} />}
                onClick={() => onNavigate(step.module)}
                style={{
                  backgroundColor: step.completed ? undefined : "var(--app-accent)",
                  color: step.completed ? "var(--app-text)" : "#ffffff",
                  fontWeight: 600,
                  fontSize: 11,
                }}
              >
                {step.completed ? "Review" : step.actionLabel}
              </Button>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
