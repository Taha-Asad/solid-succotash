import {
  Badge,
  Box,
  Card,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  Building2,
  ReceiptText,
  Palette,
  Sliders,
  ChevronRight,
  User,
  Printer,
  Sparkles,
  Database,
} from "lucide-react";
import type { PublicUser } from "../../types/backend";

export type SettingsSection =
  | "profile"
  | "personal-theme"
  | "pos"
  | "company"
  | "invoicing"
  | "branding"
  | "backup"
  | "advanced";

interface SettingsHubProps {
  user: PublicUser;
  onSelectSection: (section: SettingsSection) => void;
}

export default function SettingsHub({ user, onSelectSection }: SettingsHubProps) {
  const isOwner = user.role === "owner";
  const isAdmin = user.role === "admin" || isOwner;

  return (
    <Stack gap="xl" style={{ maxWidth: 1200, margin: "0 auto", paddingBottom: 50 }}>
      {/* Page Title & Subtitle */}
      <Box>
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Box>
            <Title order={2} style={{ letterSpacing: -0.4 }}>
              Settings & Preferences
            </Title>
            <Text size="sm" c="dimmed" mt={4}>
              Role-divided configuration: personal user workspace, sales counter ergonomics, and business governance.
            </Text>
          </Box>
          <Badge size="lg" variant="light" color={isOwner ? "gold" : isAdmin ? "blue" : "teal"}>
            Signed in as: {user.fullName} ({user.role.toUpperCase()})
          </Badge>
        </Group>
      </Box>

      {/* ============================================================ */}
      {/* SECTION 1: PERSONAL WORKSPACE (Available to ALL Users)       */}
      {/* ============================================================ */}
      <Box>
        <Group gap="xs" mb="sm">
          <ThemeIcon size={28} radius="md" color="blue" variant="light">
            <User size={16} />
          </ThemeIcon>
          <Text fw={700} size="md">
            1. Personal Workspace & Credentials
          </Text>
          <Badge size="xs" variant="outline" color="blue">
            All Roles
          </Badge>
        </Group>
        <Text size="xs" c="dimmed" mb="md">
          Settings that belong strictly to your personal login. Changes here never alter other staff members' displays or official invoice records.
        </Text>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {/* Card: My Profile & Password */}
          <Card
            withBorder
            padding="lg"
            radius="md"
            className="floating-card floating-card-interactive"
            onClick={() => onSelectSection("profile")}
            style={{
              cursor: "pointer",
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group justify="space-between" mb="xs">
              <ThemeIcon size={40} radius="md" color="blue" variant="light">
                <User size={20} />
              </ThemeIcon>
              <Badge variant="light" color="blue" size="sm">
                Personal
              </Badge>
            </Group>
            <Text fw={700} size="md" mb={2}>
              My Profile & Password
            </Text>
            <Text size="xs" fw={600} c="dimmed" mb="xs">
              Name, email & terminal security
            </Text>
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.45, flex: 1 }}>
              Update your staff display name, verify your email, and change your login password with strength validation.
            </Text>
            <Group justify="flex-end" mt="md" gap={4}>
              <Text size="xs" fw={700} c="blue">
                Open Profile
              </Text>
              <ChevronRight size={14} color="var(--mantine-color-blue-6)" />
            </Group>
          </Card>

          {/* Card: Personal Appearance & Scheme */}
          <Card
            withBorder
            padding="lg"
            radius="md"
            className="floating-card floating-card-interactive"
            onClick={() => onSelectSection("personal-theme")}
            style={{
              cursor: "pointer",
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group justify="space-between" mb="xs">
              <ThemeIcon size={40} radius="md" color="violet" variant="light">
                <Palette size={20} />
              </ThemeIcon>
              <Badge variant="light" color="violet" size="sm">
                This Device
              </Badge>
            </Group>
            <Text fw={700} size="md" mb={2}>
              My Appearance & Theme
            </Text>
            <Text size="xs" fw={600} c="dimmed" mb="xs">
              Light / Dark mode & personal accent
            </Text>
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.45, flex: 1 }}>
              Set your personal Dark or Light theme mode, choose your button accent color palette, and pick your language (English / اردو).
            </Text>
            <Group justify="flex-end" mt="md" gap={4}>
              <Text size="xs" fw={700} c="violet">
                Customize Look
              </Text>
              <ChevronRight size={14} color="var(--mantine-color-violet-6)" />
            </Group>
          </Card>
        </SimpleGrid>
      </Box>

      <Divider />

      {/* ============================================================ */}
      {/* SECTION 2: COUNTER & STORE OPERATIONS (Cashier, Admin, Owner) */}
      {/* ============================================================ */}
      <Box>
        <Group gap="xs" mb="sm">
          <ThemeIcon size={28} radius="md" color="teal" variant="light">
            <Printer size={16} />
          </ThemeIcon>
          <Text fw={700} size="md">
            2. Sales Counter & POS Operations
          </Text>
          <Badge size="xs" variant="outline" color="teal">
            Cashiers & Managers
          </Badge>
        </Group>
        <Text size="xs" c="dimmed" mb="md">
          Hardware and operational shortcuts for high-speed retail checkout and thermal receipt printing.
        </Text>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {/* Card: POS & Thermal Printer */}
          <Card
            withBorder
            padding="lg"
            radius="md"
            className="floating-card floating-card-interactive"
            onClick={() => onSelectSection("pos")}
            style={{
              cursor: "pointer",
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group justify="space-between" mb="xs">
              <ThemeIcon size={40} radius="md" color="teal" variant="light">
                <Printer size={20} />
              </ThemeIcon>
              <Badge variant="light" color="teal" size="sm">
                Counter Setup
              </Badge>
            </Group>
            <Text fw={700} size="md" mb={2}>
              Thermal Receipt & Printer Setup
            </Text>
            <Text size="xs" fw={600} c="dimmed" mb="xs">
              80mm, 58mm & A4 paper formats
            </Text>
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.45, flex: 1 }}>
              Select default receipt paper width, customize top header notes and bottom greetings (&quot;Thank you for shopping!&quot;).
            </Text>
            <Group justify="flex-end" mt="md" gap={4}>
              <Text size="xs" fw={700} c="teal">
                Configure Printer
              </Text>
              <ChevronRight size={14} color="var(--mantine-color-teal-6)" />
            </Group>
          </Card>

          {/* Card: Invoice Numbering & Layout */}
          <Card
            withBorder
            padding="lg"
            radius="md"
            className="floating-card floating-card-interactive"
            onClick={() => onSelectSection("invoicing")}
            style={{
              cursor: "pointer",
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group justify="space-between" mb="xs">
              <ThemeIcon size={40} radius="md" color="cyan" variant="light">
                <ReceiptText size={20} />
              </ThemeIcon>
              <Badge variant="light" color="cyan" size="sm">
                Invoicing
              </Badge>
            </Group>
            <Text fw={700} size="md" mb={2}>
              Invoice Format & FBR Tax Integration
            </Text>
            <Text size="xs" fw={600} c="dimmed" mb="xs">
              Prefixes, payment terms & FBR POS machine
            </Text>
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.45, flex: 1 }}>
              Configure invoice numbering sequence (INV-2026-0001), digital tax machine connection, and live FBR sync queue.
            </Text>
            <Group justify="flex-end" mt="md" gap={4}>
              <Text size="xs" fw={700} c="cyan">
                Manage Invoicing
              </Text>
              <ChevronRight size={14} color="var(--mantine-color-cyan-6)" />
            </Group>
          </Card>
        </SimpleGrid>
      </Box>

      <Divider />

      {/* ============================================================ */}
      {/* SECTION 3: BUSINESS GOVERNANCE & COMPLIANCE (Admin / Owner)  */}
      {/* ============================================================ */}
      <Box>
        <Group gap="xs" mb="sm">
          <ThemeIcon size={28} radius="md" color="gold" variant="light">
            <Building2 size={16} />
          </ThemeIcon>
          <Text fw={700} size="md">
            3. Business Profile, Security & Governance
          </Text>
          <Badge size="xs" variant="filled" color={isOwner ? "gold" : "blue"}>
            Admin & Owner Only
          </Badge>
        </Group>
        <Text size="xs" c="dimmed" mb="md">
          Official company tax registrations, store logo branding on printed bills, database backups, and security audit logs.
        </Text>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {/* Business Profile */}
          <Card
            withBorder
            padding="lg"
            radius="md"
            className="floating-card floating-card-interactive"
            onClick={() => onSelectSection("company")}
            style={{
              cursor: "pointer",
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group justify="space-between" mb="xs">
              <ThemeIcon size={40} radius="md" color="indigo" variant="light">
                <Building2 size={20} />
              </ThemeIcon>
              <Badge variant="light" color="indigo" size="sm">
                Legal
              </Badge>
            </Group>
            <Text fw={700} size="md" mb={2}>
              Legal Business Profile
            </Text>
            <Text size="xs" fw={600} c="dimmed" mb="xs">
              Shop name, NTN, STRN & address
            </Text>
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.45, flex: 1 }}>
              Official registered business identity, province, contact numbers, and National Tax Number.
            </Text>
            <Group justify="flex-end" mt="md" gap={4}>
              <Text size="xs" fw={700} c="indigo">
                Manage Details
              </Text>
              <ChevronRight size={14} color="var(--mantine-color-indigo-6)" />
            </Group>
          </Card>

          {/* Official Branding */}
          <Card
            withBorder
            padding="lg"
            radius="md"
            className="floating-card floating-card-interactive"
            onClick={() => onSelectSection("branding")}
            style={{
              cursor: "pointer",
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group justify="space-between" mb="xs">
              <ThemeIcon size={40} radius="md" color="grape" variant="light">
                <Sparkles size={20} />
              </ThemeIcon>
              <Badge variant="light" color="grape" size="sm">
                Branding
              </Badge>
            </Group>
            <Text fw={700} size="md" mb={2}>
              Official Store Logo & Bill Design
            </Text>
            <Text size="xs" fw={600} c="dimmed" mb="xs">
              Company logo printed on customer bills
            </Text>
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.45, flex: 1 }}>
              Upload your high-resolution store logo and tagline that appears on all official printed receipts and PDF invoices.
            </Text>
            <Group justify="flex-end" mt="md" gap={4}>
              <Text size="xs" fw={700} c="grape">
                Upload Logo
              </Text>
              <ChevronRight size={14} color="var(--mantine-color-grape-6)" />
            </Group>
          </Card>

          {/* Backups & Data Safety */}
          <Card
            withBorder
            padding="lg"
            radius="md"
            className="floating-card floating-card-interactive"
            onClick={() => onSelectSection("backup")}
            style={{
              cursor: "pointer",
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group justify="space-between" mb="xs">
              <ThemeIcon size={40} radius="md" color="orange" variant="light">
                <Database size={20} />
              </ThemeIcon>
              <Badge variant="light" color="orange" size="sm">
                Critical
              </Badge>
            </Group>
            <Text fw={700} size="md" mb={2}>
              Data Safety & Backups
            </Text>
            <Text size="xs" fw={600} c="dimmed" mb="xs">
              USB exports & database snapshots
            </Text>
            <Text size="xs" c="dimmed" style={{ lineHeight: 1.45, flex: 1 }}>
              Perform 1-click manual database backups to USB drives, view automatic daily archives, and restore historical data.
            </Text>
            <Group justify="flex-end" mt="md" gap={4}>
              <Text size="xs" fw={700} c="orange">
                Backup Data
              </Text>
              <ChevronRight size={14} color="var(--mantine-color-orange-6)" />
            </Group>
          </Card>

          {/* Modules & Audit Log */}
          {isAdmin && (
            <Card
              withBorder
              padding="lg"
              radius="md"
              className="floating-card floating-card-interactive"
              onClick={() => onSelectSection("advanced")}
              style={{
                cursor: "pointer",
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
              }}
            >
              <Group justify="space-between" mb="xs">
                <ThemeIcon size={40} radius="md" color="pink" variant="light">
                  <Sliders size={20} />
                </ThemeIcon>
                <Badge variant="light" color="pink" size="sm">
                  System Audit
                </Badge>
              </Group>
              <Text fw={700} size="md" mb={2}>
                System Audit & Optional Modules
              </Text>
              <Text size="xs" fw={600} c="dimmed" mb="xs">
                Staff activity audit & feature switches
              </Text>
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.45, flex: 1 }}>
                Inspect immutable security audit logs of all sales and edits, and toggle optional modules (Multi-Currency, Expiry Batches).
              </Text>
              <Group justify="flex-end" mt="md" gap={4}>
                <Text size="xs" fw={700} c="pink">
                  Audit Logs
                </Text>
                <ChevronRight size={14} color="var(--mantine-color-pink-6)" />
              </Group>
            </Card>
          )}
        </SimpleGrid>
      </Box>
    </Stack>
  );
}
