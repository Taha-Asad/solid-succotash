import { Box, Group, Stack, Text, ThemeIcon, Badge } from "@mantine/core";
import {
  Building2,
  ReceiptText,
  ShieldCheck,
  Palette,
  Sliders,
  ChevronRight,
} from "lucide-react";
import type { PublicUser } from "../../types/backend";

export type SettingsSection =
  | "company"
  | "invoicing"
  | "backup"
  | "appearance"
  | "advanced";

interface SettingsHubProps {
  user: PublicUser;
  onSelectSection: (section: SettingsSection) => void;
}

export default function SettingsHub({ user, onSelectSection }: SettingsHubProps) {
  const isOwner = user.role === "owner";

  const categories: {
    key: SettingsSection;
    title: string;
    subtitle: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    badge?: string;
  }[] = [
    {
      key: "company",
      title: "My Business Profile",
      subtitle: "Shop details & contacts",
      description:
        "Manage your shop name, official phone number, address, and legal tax numbers (NTN/STRN).",
      icon: <Building2 size={24} />,
      color: "#4f61ed",
      badge: "Essential",
    },
    {
      key: "invoicing",
      title: "Sales, Receipts & FBR",
      subtitle: "Invoice layout & tax machine",
      description:
        "Customize receipt prefixes, choose invoice designs, and configure official digital FBR POS integration.",
      icon: <ReceiptText size={24} />,
      color: "#0ca678",
      badge: "Invoicing",
    },
    {
      key: "backup",
      title: "Data Safety & Backups",
      subtitle: "Protect your shop records",
      description:
        "Save 1-click database copies to USB or safe folders, view automatic daily backups, or restore previous data.",
      icon: <ShieldCheck size={24} />,
      color: "#f59f00",
      badge: "Safe",
    },
    {
      key: "appearance",
      title: "Appearance & Language",
      subtitle: "Logo, colors & Urdu/English",
      description:
        "Upload your store logo, customize receipt color accents, and switch the entire interface between English and Urdu.",
      icon: <Palette size={24} />,
      color: "#e64980",
    },
    ...(isOwner
      ? [
          {
            key: "advanced" as SettingsSection,
            title: "Tools, Modules & Audit",
            subtitle: "Feature toggles & security logs",
            description:
              "Turn optional modules on or off (Multi-Currency, Expiry Batches) and review the complete staff activity log.",
            icon: <Sliders size={24} />,
            color: "#7048e8",
            badge: "Admin Only",
          },
        ]
      : []),
  ];

  return (
    <Stack gap="xl">
      <Box>
        <Text fw={800} size="xl" style={{ letterSpacing: -0.3 }}>
          Settings & Preferences
        </Text>
        <Text size="sm" c="dimmed">
          Configure your business profile, receipt styles, tax compliance, and data backups.
        </Text>
      </Box>

      <Box
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 20,
        }}
      >
        {categories.map((cat) => (
          <Box
            key={cat.key}
            className="floating-card floating-card-interactive"
            p="xl"
            onClick={() => onSelectSection(cat.key)}
            style={{
              cursor: "pointer",
              borderRadius: 20,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              minHeight: 180,
            }}
          >
            <Box>
              <Group justify="space-between" mb="md" align="flex-start">
                <ThemeIcon
                  size={46}
                  radius={14}
                  style={{
                    background: `${cat.color}15`,
                    color: cat.color,
                  }}
                >
                  {cat.icon}
                </ThemeIcon>
                {cat.badge && (
                  <Badge variant="light" color="gray" size="sm" radius="md">
                    {cat.badge}
                  </Badge>
                )}
              </Group>

              <Text fw={800} size="md" mb={2}>
                {cat.title}
              </Text>
              <Text size="xs" fw={600} c="dimmed" mb="xs">
                {cat.subtitle}
              </Text>
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
                {cat.description}
              </Text>
            </Box>

            <Group justify="flex-end" mt="md" gap="xs">
              <Text size="xs" fw={700} style={{ color: cat.color }}>
                Manage
              </Text>
              <ChevronRight size={14} color={cat.color} />
            </Group>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
