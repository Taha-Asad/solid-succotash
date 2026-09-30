// ==========================================
// USER PROFILE PAGE
// Dedicated Full-Page Account, Security & Appearance
// ==========================================
// Scoped to the individual user:
// - Personal details & Name
// - User-scoped Color Scheme (Light / Dark / Auto)
// - Personal Interface Accent Color
// - Password Change & Security
// - Operational Role & Permissions Summary

import { useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  ColorSwatch,
  Divider,
  Grid,
  Group,
  PasswordInput,
  Progress,
  Radio,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  ArrowLeft,
  Check,
  CheckCircle,
  KeyRound,
  Lock,
  LogOut,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  User,
  AlertCircle,
  Save,
  Sparkles,
} from "lucide-react";

import {
  changeMyPassword,
  getErrorMessage,
  updateMyProfile,
} from "../../api/backend";
import type { PublicUser, UserRole } from "../../types/backend";
import {
  useAppTheme,
  USER_ACCENT_PALETTES,
  type ColorScheme,
} from "../../theme/AppThemeProvider";
import { useI18n } from "../../i18n/I18nProvider";

interface ProfilePageProps {
  user: PublicUser;
  onBack: () => void;
  onLogout: () => Promise<void>;
  onUserUpdated?: (updated: PublicUser) => void;
}

const ROLE_INFO: Record<
  UserRole,
  { label: string; color: string; description: string; permissions: string[] }
> = {
  owner: {
    label: "Business Owner / Executive",
    color: "gold",
    description: "Full administrative ownership. Unrestricted access to all finances, staff, and settings.",
    permissions: [
      "Create, edit, finalize & void invoices",
      "Full inventory management, batch tracking & pricing",
      "Supplier management & purchase orders",
      "Full financial reports, profit margins & tax reports",
      "User accounts, role assignments & system audit logs",
      "Official company branding & FBR integration",
      "1-Click manual backups & database restore",
    ],
  },
  admin: {
    label: "System Administrator",
    color: "blue",
    description: "Delegated operational administrator. Manages daily business, staff, and stock.",
    permissions: [
      "Create, edit & finalize invoices",
      "Inventory additions, updates & stock counts",
      "Purchase orders & supplier communications",
      "Operational sales & stock reports",
      "Staff account oversight (excluding owner)",
      "Daily manual backups",
    ],
  },
  employee: {
    label: "Counter Cashier / Associate",
    color: "teal",
    description: "Front-desk counter operations. Fast sales checkout and customer registration.",
    permissions: [
      "Create draft & finalized sales invoices",
      "1-Click Walk-in & fast counter POS line entry",
      "Customer directory registration & WhatsApp alerts",
      "Product catalog search & stock lookups",
      "Personal appearance & password management",
    ],
  },
};

function getPasswordStrength(password: string): { score: number; color: string; label: string } {
  if (!password) return { score: 0, color: "gray", label: "Empty" };
  let score = 0;
  if (password.length >= 8) score += 30;
  if (password.length >= 12) score += 20;
  if (/[A-Z]/.test(password)) score += 20;
  if (/[0-9]/.test(password)) score += 15;
  if (/[^A-Za-z0-9]/.test(password)) score += 15;

  if (score < 40) return { score, color: "red", label: "Weak" };
  if (score < 75) return { score, color: "yellow", label: "Fair" };
  return { score: 100, color: "teal", label: "Strong" };
}

export default function ProfilePage({
  user,
  onBack,
  onLogout,
  onUserUpdated,
}: ProfilePageProps) {
  const { colorScheme, setColorScheme, userAccent, setUserAccent } = useAppTheme();
  const { lang, setLang } = useI18n();

  // Name Update State
  const [fullName, setFullName] = useState(user.fullName);
  const [savingName, setSavingName] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const roleMeta = ROLE_INFO[user.role] ?? ROLE_INFO.employee;
  const pwStrength = getPasswordStrength(newPassword);

  async function handleUpdateName(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) return;
    setSavingName(true);
    setNameError(null);
    setNameSuccess(false);
    try {
      const updated = await updateMyProfile(fullName.trim());
      setNameSuccess(true);
      if (onUserUpdated) onUserUpdated(updated);
      setTimeout(() => setNameSuccess(false), 4000);
    } catch (err) {
      setNameError(getErrorMessage(err));
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (!currentPassword) {
      setPasswordError("Please enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setSavingPassword(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 5000);
    } catch (err) {
      setPasswordError(getErrorMessage(err));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <Stack gap="xl" style={{ maxWidth: 1100, margin: "0 auto", paddingBottom: 60 }}>
      {/* Top Header */}
      <Box>
        <Button
          variant="subtle"
          color="gray"
          size="sm"
          leftSection={<ArrowLeft size={16} />}
          onClick={onBack}
          radius="md"
          mb="sm"
        >
          ← Back to Workspace
        </Button>

        <Group justify="space-between" align="flex-end">
          <Box>
            <Title order={2} style={{ letterSpacing: -0.4 }}>
              My Account & Profile
            </Title>
            <Text size="sm" c="dimmed" mt={4}>
              Manage your personal credentials, personal color scheme, and security settings.
            </Text>
          </Box>

          <Button
            variant="light"
            color="red"
            size="sm"
            leftSection={<LogOut size={15} />}
            onClick={() => void onLogout()}
          >
            Sign Out
          </Button>
        </Group>
      </Box>

      {/* Main Grid: Left Identity Card + Right Configuration Cards */}
      <Grid>
        {/* Left Column: User Summary Card */}
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Card
            withBorder
            padding="xl"
            radius="md"
            style={{
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
              textAlign: "center",
            }}
          >
            <Stack align="center" gap="md">
              <Avatar
                size={84}
                radius="xl"
                color={roleMeta.color}
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  boxShadow: `0 4px 20px -4px var(--app-accent)`,
                }}
              >
                {user.fullName.charAt(0).toUpperCase()}
              </Avatar>

              <Box>
                <Text fw={800} size="lg" style={{ letterSpacing: -0.2 }}>
                  {user.fullName}
                </Text>
                <Text size="xs" c="dimmed">
                  {user.email}
                </Text>
              </Box>

              <Badge
                size="lg"
                color={roleMeta.color}
                variant="light"
                radius="sm"
                styles={{ label: { textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 } }}
              >
                {roleMeta.label}
              </Badge>

              <Divider w="100%" />

              <Stack gap="xs" w="100%" style={{ textAlign: "left" }}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Account Status
                  </Text>
                  <Badge color="green" variant="dot" size="sm">
                    Active
                  </Badge>
                </Group>

                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Member Since
                  </Text>
                  <Text size="xs" fw={600}>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </Text>
                </Group>

                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Device Scheme
                  </Text>
                  <Badge variant="outline" color="gray" size="sm">
                    {colorScheme.toUpperCase()}
                  </Badge>
                </Group>
              </Stack>
            </Stack>
          </Card>

          {/* Operational Permissions Box */}
          <Card
            withBorder
            padding="lg"
            radius="md"
            mt="md"
            style={{
              background: "var(--app-surface)",
              borderColor: "var(--app-border)",
            }}
          >
            <Group gap="xs" mb="sm">
              <ShieldCheck size={18} color="var(--app-accent)" />
              <Text size="sm" fw={700}>
                Assigned Operational Rights
              </Text>
            </Group>
            <Text size="xs" c="dimmed" mb="md">
              {roleMeta.description}
            </Text>
            <Stack gap={6}>
              {roleMeta.permissions.map((p, idx) => (
                <Group key={idx} gap="xs" wrap="nowrap" align="flex-start">
                  <Check size={13} color="#10b981" style={{ flexShrink: 0, marginTop: 3 }} />
                  <Text size="xs" style={{ lineHeight: 1.35 }}>
                    {p}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Right Column: Settings Sections */}
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="xl">
            {/* Section 1: Personal Details */}
            <Card
              withBorder
              padding="xl"
              radius="md"
              style={{
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
              }}
            >
              <Group gap="xs" mb="lg">
                <ThemeIcon size={34} radius="md" color="blue" variant="light">
                  <User size={18} />
                </ThemeIcon>
                <Box>
                  <Text fw={700} size="md">
                    Personal Information
                  </Text>
                  <Text size="xs" c="dimmed">
                    Update your visible display name used on receipts and invoices.
                  </Text>
                </Box>
              </Group>

              {nameSuccess && (
                <Alert icon={<CheckCircle size={16} />} color="green" mb="md">
                  Your profile name has been updated successfully!
                </Alert>
              )}
              {nameError && (
                <Alert icon={<AlertCircle size={16} />} color="red" mb="md">
                  {nameError}
                </Alert>
              )}

              <form onSubmit={handleUpdateName}>
                <Stack gap="md">
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <TextInput
                      label="Full Name"
                      value={fullName}
                      onChange={(e) => setFullName(e.currentTarget.value)}
                      required
                      size="md"
                    />

                    <TextInput
                      label="Login Email Address"
                      value={user.email}
                      disabled
                      size="md"
                      description="Account email is managed by your company administrator"
                    />
                  </SimpleGrid>

                  <Group justify="flex-end" mt="xs">
                    <Button
                      type="submit"
                      loading={savingName}
                      disabled={fullName.trim() === user.fullName}
                      leftSection={<Save size={16} />}
                      style={{
                        background: "var(--app-accent, #1d2b54)",
                        color: "#ffffff",
                        fontWeight: 600,
                      }}
                    >
                      Save Profile Name
                    </Button>
                  </Group>
                </Stack>
              </form>
            </Card>

            {/* Section 2: User-Scoped Appearance & Theme */}
            <Card
              withBorder
              padding="xl"
              radius="md"
              style={{
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
              }}
            >
              <Group justify="space-between" mb="lg">
                <Group gap="xs">
                  <ThemeIcon size={34} radius="md" color="violet" variant="light">
                    <Palette size={18} />
                  </ThemeIcon>
                  <Box>
                    <Text fw={700} size="md">
                      Personal Appearance & Color Scheme
                    </Text>
                    <Text size="xs" c="dimmed">
                      Scoped exclusively to your user account on this device.
                    </Text>
                  </Box>
                </Group>

                <Badge variant="light" color="violet" size="sm">
                  User Specific
                </Badge>
              </Group>

              <Alert color="blue" variant="light" radius="md" mb="lg" icon={<Sparkles size={16} />}>
                These settings personalize your workspace experience only. They will not alter other cashiers' screens or your official company invoice logo.
              </Alert>

              <Stack gap="lg">
                {/* Theme Mode Toggle (Light / Dark / Auto) */}
                <Box>
                  <Text size="sm" fw={600} mb="xs">
                    Interface Theme Mode
                  </Text>
                  <Radio.Group
                    value={colorScheme}
                    onChange={(val) => setColorScheme(val as ColorScheme)}
                  >
                    <Group gap="md">
                      <Card
                        withBorder
                        padding="sm"
                        radius="md"
                        style={{
                          cursor: "pointer",
                          borderColor: colorScheme === "light" ? "var(--app-accent)" : undefined,
                          background: colorScheme === "light" ? "var(--app-hover)" : undefined,
                        }}
                        onClick={() => setColorScheme("light")}
                      >
                        <Group gap="xs">
                          <Sun size={18} color="#f59e0b" />
                          <Box>
                            <Text size="sm" fw={600}>
                              Light Mode
                            </Text>
                            <Text size="11px" c="dimmed">
                              Clean paper contrast
                            </Text>
                          </Box>
                        </Group>
                      </Card>

                      <Card
                        withBorder
                        padding="sm"
                        radius="md"
                        style={{
                          cursor: "pointer",
                          borderColor: colorScheme === "dark" ? "var(--app-accent)" : undefined,
                          background: colorScheme === "dark" ? "var(--app-hover)" : undefined,
                        }}
                        onClick={() => setColorScheme("dark")}
                      >
                        <Group gap="xs">
                          <Moon size={18} color="#3b82f6" />
                          <Box>
                            <Text size="sm" fw={600}>
                              Dark Mode
                            </Text>
                            <Text size="11px" c="dimmed">
                              Night / OLED navy
                            </Text>
                          </Box>
                        </Group>
                      </Card>

                      <Card
                        withBorder
                        padding="sm"
                        radius="md"
                        style={{
                          cursor: "pointer",
                          borderColor: colorScheme === "auto" ? "var(--app-accent)" : undefined,
                          background: colorScheme === "auto" ? "var(--app-hover)" : undefined,
                        }}
                        onClick={() => setColorScheme("auto")}
                      >
                        <Group gap="xs">
                          <Sparkles size={18} color="#8b5cf6" />
                          <Box>
                            <Text size="sm" fw={600}>
                              System Auto
                            </Text>
                            <Text size="11px" c="dimmed">
                              Sync with OS
                            </Text>
                          </Box>
                        </Group>
                      </Card>
                    </Group>
                  </Radio.Group>
                </Box>

                <Divider />

                {/* Personal Accent Color Palette */}
                <Box>
                  <Text size="sm" fw={600} mb={4}>
                    Personal Accent Color
                  </Text>
                  <Text size="xs" c="dimmed" mb="sm">
                    Select a highlight tone for your buttons, active tabs, and navigation focus.
                  </Text>

                  <Group gap="sm" wrap="wrap">
                    {USER_ACCENT_PALETTES.map((pal) => {
                      const isSelected = userAccent.toLowerCase() === pal.value.toLowerCase();
                      return (
                        <Tooltip key={pal.value} label={`${pal.name} — ${pal.description}`}>
                          <Card
                            withBorder
                            padding="xs"
                            radius="md"
                            style={{
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              borderColor: isSelected ? pal.value : "var(--app-border)",
                              borderWidth: isSelected ? 2 : 1,
                              background: isSelected ? "var(--app-hover)" : "var(--app-surface)",
                            }}
                            onClick={() => setUserAccent(pal.value)}
                          >
                            <ColorSwatch color={pal.value} size={22} radius="md" />
                            <Text size="xs" fw={isSelected ? 700 : 500}>
                              {pal.name}
                            </Text>
                            {isSelected && <Check size={14} color={pal.value} />}
                          </Card>
                        </Tooltip>
                      );
                    })}
                  </Group>
                </Box>

                <Divider />

                {/* Preferred Language */}
                <Box>
                  <Text size="sm" fw={600} mb={4}>
                    Interface Language
                  </Text>
                  <Group gap="md">
                    <Button
                      variant={lang === "en" ? "filled" : "default"}
                      size="sm"
                      onClick={() => setLang("en")}
                      style={
                        lang === "en"
                          ? { background: "var(--app-accent, #1d2b54)", color: "#ffffff" }
                          : undefined
                      }
                    >
                      English (UK / US)
                    </Button>
                    <Button
                      variant={lang === "ur" ? "filled" : "default"}
                      size="sm"
                      onClick={() => setLang("ur")}
                      style={
                        lang === "ur"
                          ? { background: "var(--app-accent, #1d2b54)", color: "#ffffff" }
                          : undefined
                      }
                    >
                      اردو (Urdu)
                    </Button>
                  </Group>
                </Box>
              </Stack>
            </Card>

            {/* Section 3: Security & Password Management */}
            <Card
              withBorder
              padding="xl"
              radius="md"
              style={{
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
              }}
            >
              <Group gap="xs" mb="lg">
                <ThemeIcon size={34} radius="md" color="red" variant="light">
                  <KeyRound size={18} />
                </ThemeIcon>
                <Box>
                  <Text fw={700} size="md">
                    Security & Credentials
                  </Text>
                  <Text size="xs" c="dimmed">
                    Change your local password to protect your terminal from unauthorized transactions.
                  </Text>
                </Box>
              </Group>

              {passwordSuccess && (
                <Alert icon={<CheckCircle size={16} />} color="green" mb="md">
                  Password updated successfully! Please remember your new password.
                </Alert>
              )}
              {passwordError && (
                <Alert icon={<AlertCircle size={16} />} color="red" mb="md">
                  {passwordError}
                </Alert>
              )}

              <form onSubmit={handleChangePassword}>
                <Stack gap="md">
                  <PasswordInput
                    label="Current Password"
                    placeholder="Enter existing password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.currentTarget.value)}
                    required
                    size="md"
                  />

                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    <Box>
                      <PasswordInput
                        label="New Password"
                        placeholder="At least 8 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.currentTarget.value)}
                        required
                        size="md"
                      />
                      {newPassword.length > 0 && (
                        <Box mt="xs">
                          <Progress
                            value={pwStrength.score}
                            color={pwStrength.color}
                            size="xs"
                            radius="xl"
                          />
                          <Text size="11px" c={pwStrength.color} mt={3} fw={600}>
                            Strength: {pwStrength.label}
                          </Text>
                        </Box>
                      )}
                    </Box>

                    <PasswordInput
                      label="Confirm New Password"
                      placeholder="Re-type new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                      required
                      size="md"
                    />
                  </SimpleGrid>

                  <Group justify="flex-end" mt="xs">
                    <Button
                      type="submit"
                      loading={savingPassword}
                      disabled={!currentPassword || !newPassword || !confirmPassword}
                      leftSection={<Lock size={16} />}
                      style={{
                        background: "var(--app-accent, #1d2b54)",
                        color: "#ffffff",
                        fontWeight: 600,
                      }}
                    >
                      Update Password
                    </Button>
                  </Group>
                </Stack>
              </form>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
