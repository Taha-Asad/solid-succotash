import { useState } from "react";
import {
  Box,
  Button,
  Group,
  RingProgress,
  Stack,
  Text,
  ThemeIcon,
  ActionIcon,
  Tooltip,
  Collapse,
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
  const storageKey = `ijaz_onboarding_dismissed_${user.id}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Backup check from local storage or default
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
      title: "Shop Details & Branding",
      description: "Set your business name, contact, and receipt header",
      completed: hasCompanyDetails,
      actionLabel: "Edit Profile",
      module: "settings",
      icon: <Building2 size={18} />,
    },
    {
      id: "products",
      title: "Add Your First Product",
      description: "Enter a product name, price, and stock or import from Excel",
      completed: hasProducts,
      actionLabel: "Add Item",
      module: "inventory",
      icon: <PackagePlus size={18} />,
    },
    {
      id: "invoices",
      title: "Create a Customer Bill",
      description: "Generate your first sale and preview the receipt layout",
      completed: hasInvoices,
      actionLabel: "New Bill",
      module: "invoices",
      icon: <ReceiptText size={18} />,
    },
    {
      id: "backup",
      title: "Protect Your Records",
      description: "Save a 1-click database copy to your computer or USB",
      completed: hasBackup,
      actionLabel: "View Backups",
      module: "settings",
      icon: <ShieldCheck size={18} />,
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, "true");
    } catch {
      // ignore
    }
  }

  if (dismissed && completedCount === steps.length) {
    return null;
  }

  if (dismissed) {
    return (
      <Box
        className="floating-card"
        px="lg"
        py="xs"
        mb="lg"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderRadius: 14,
        }}
      >
        <Group gap="xs">
          <Sparkles size={16} color="var(--app-accent)" />
          <Text size="sm" fw={600}>
            Setup Guide: {completedCount} of {steps.length} steps completed
          </Text>
        </Group>
        <Button
          variant="subtle"
          size="xs"
          onClick={() => {
            setDismissed(false);
            localStorage.removeItem(storageKey);
          }}
        >
          Resume Guide
        </Button>
      </Box>
    );
  }

  return (
    <Box className="hero-welcome-card" p={{ base: "md", md: "xl" }} mb="xl">
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="sm">
        <Group gap="md" align="center">
          <ThemeIcon
            size={48}
            radius={16}
            style={{
              background: "linear-gradient(135deg, #4f61ed 0%, #7687f9 100%)",
              color: "#ffffff",
              boxShadow: "0 6px 16px -4px rgba(79, 97, 237, 0.4)",
            }}
          >
            <Sparkles size={24} />
          </ThemeIcon>
          <Stack gap={2}>
            <Group gap="xs">
              <Text fw={800} size="xl" style={{ letterSpacing: -0.3 }}>
                Welcome, {user.fullName || "Business Owner"}!
              </Text>
            </Group>
            <Text size="sm" c="dimmed">
              Follow these simple steps to get your store up and running smoothly.
            </Text>
          </Stack>
        </Group>

        <Group gap="xs">
          <Tooltip label={collapsed ? "Expand guide" : "Collapse guide"}>
            <ActionIcon
              variant="subtle"
              color="gray"
              radius="xl"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Dismiss guide">
            <ActionIcon
              variant="subtle"
              color="gray"
              radius="xl"
              onClick={handleDismiss}
            >
              <X size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Progress & Quick stats */}
      <Group justify="space-between" align="center" mt="md" mb={collapsed ? 0 : "md"}>
        <Group gap="sm">
          <RingProgress
            size={52}
            thickness={5}
            roundCaps
            sections={[{ value: progressPercent, color: "#4f61ed" }]}
            label={
              <Text c="var(--app-accent)" fw={800} ta="center" size="xs">
                {progressPercent}%
              </Text>
            }
          />
          <Stack gap={0}>
            <Text size="xs" fw={700} c="dimmed" style={{ letterSpacing: 0.8, textTransform: "uppercase" }}>
              Launch Progress
            </Text>
            <Text fw={700} size="sm">
              {completedCount} of {steps.length} Steps Completed
            </Text>
          </Stack>
        </Group>
      </Group>

      <Collapse expanded={!collapsed}>
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
            marginTop: 16,
          }}
        >
          {steps.map((step) => (
            <Box
              key={step.id}
              className="floating-card"
              p="md"
              style={{
                borderRadius: 16,
                background: step.completed ? "var(--app-soft)" : "var(--app-surface)",
                border: step.completed
                  ? "1px solid var(--app-border)"
                  : "1px solid rgba(79, 97, 237, 0.2)",
                opacity: step.completed ? 0.85 : 1,
              }}
            >
              <Group justify="space-between" mb="xs">
                <ThemeIcon
                  size={34}
                  radius={10}
                  variant="light"
                  color={step.completed ? "green" : "blue"}
                >
                  {step.icon}
                </ThemeIcon>
                {step.completed ? (
                  <Group gap={4}>
                    <CheckCircle2 size={16} color="var(--mantine-color-green-6)" />
                    <Text size="xs" fw={700} c="green">
                      Done
                    </Text>
                  </Group>
                ) : (
                  <Group gap={4}>
                    <Circle size={14} color="var(--app-muted)" />
                    <Text size="xs" c="dimmed">
                      Pending
                    </Text>
                  </Group>
                )}
              </Group>

              <Text fw={700} size="sm" mb={2}>
                {step.title}
              </Text>
              <Text size="xs" c="dimmed" mb="md" style={{ minHeight: 34 }}>
                {step.description}
              </Text>

              <Button
                variant={step.completed ? "default" : "filled"}
                size="xs"
                fullWidth
                radius="md"
                rightSection={<ArrowRight size={13} />}
                onClick={() => onNavigate(step.module)}
                style={{
                  background: step.completed
                    ? undefined
                    : "linear-gradient(135deg, #4f61ed 0%, #687bf7 100%)",
                }}
              >
                {step.actionLabel}
              </Button>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
