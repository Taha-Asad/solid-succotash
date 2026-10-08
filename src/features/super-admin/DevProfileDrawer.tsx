// ==========================================
// DEVELOPER PROFILE & APP UPDATER DRAWER
// ==========================================
// Comprehensive Developer Cockpit:
// 1. Avatar Changer (Custom URL, file upload preview, or presets)
// 2. Developer Profile & Handle Editor (update_my_profile)
// 3. Master Password Updater (change_my_password)
// 4. Tauri App Updater (check_for_updates & install_update)
// 5. Session & Dev Token Diagnostics (inspectable tokens & DB strings)

import { useEffect, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  CopyButton,
  Divider,
  Drawer,
  Group,
  PasswordInput,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Feather,
  KeyRound,
  Landmark,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
  Terminal,
  User,
  Zap,
} from "lucide-react";

import {
  changeMyPassword,
  checkForUpdates,
  getErrorMessage,
  installUpdate,
  updateMyProfile,
  type UpdateResult,
} from "../../api/backend";
import type { PublicUser } from "../../types/backend";
import { useSaTheme } from "./saTheme";

const DEV_AVATAR_PRESETS = [
  { id: "crow", label: "Sovereign Crow", icon: Feather, url: "" },
  { id: "hacker", label: "Dev Terminal", icon: Terminal, url: "" },
  { id: "keystone", label: "Studio Keystone", icon: Landmark, url: "" },
  { id: "arbiter", label: "Sovereign Arbiter", icon: ShieldCheck, url: "" },
  { id: "neon", label: "Neon Architect", icon: Zap, url: "" },
];

export default function DevProfileDrawer({
  opened,
  onClose,
  user,
  onUserUpdated,
}: {
  opened: boolean;
  onClose: () => void;
  user: PublicUser;
  onUserUpdated?: (user: PublicUser) => void;
}) {
  const SA = useSaTheme();

  // Active Tab: "profile" | "updater" | "credentials"
  const [activeTab, setActiveTab] = useState<string | null>("profile");

  // Profile Changer State
  const [fullName, setFullName] = useState(user.fullName || "Taha Asadullah");
  const [customAvatarUrl, setCustomAvatarUrl] = useState(
    localStorage.getItem("corbel_dev_avatar") || "",
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState("");

  // Password Update State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  // Tauri Updater State
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  // Sync state if user changes
  useEffect(() => {
    setFullName(user.fullName);
  }, [user.fullName]);

  // Handle Profile & Avatar Save
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    setSavingProfile(true);
    setProfileError("");
    setProfileSuccess(false);

    try {
      const updated = await updateMyProfile(fullName.trim());
      if (customAvatarUrl) {
        localStorage.setItem("corbel_dev_avatar", customAvatarUrl);
      } else {
        localStorage.removeItem("corbel_dev_avatar");
      }
      window.dispatchEvent(new Event("corbel_avatar_updated"));

      setProfileSuccess(true);
      if (onUserUpdated) onUserUpdated(updated);
      setTimeout(() => setProfileSuccess(false), 3500);
    } catch (err) {
      setProfileError(getErrorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  };

  // Handle Password Update
  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match");
      return;
    }

    setSavingPassword(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 3500);
    } catch (err) {
      setPasswordError(getErrorMessage(err));
    } finally {
      setSavingPassword(false);
    }
  };

  // Handle Check for Updates
  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await checkForUpdates();
      setUpdateResult(res);
    } catch (err) {
      setUpdateError(getErrorMessage(err));
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Handle Install Update
  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    try {
      await installUpdate();
    } catch (err) {
      setUpdateError(getErrorMessage(err));
      setInstallingUpdate(false);
    }
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={560}
      title={
        <Group gap="xs">
          <Terminal size={18} color={SA.accent} />
          <Text fw={800} size="md" style={{ color: SA.text, letterSpacing: -0.3 }}>
            Developer Cockpit & Profile Changer
          </Text>
        </Group>
      }
      scrollAreaComponent={ScrollArea.Autosize}
      styles={{
        header: {
          background: SA.panel,
          borderBottom: `1px solid ${SA.border}`,
          padding: "18px 24px",
        },
        content: {
          background: SA.bg,
        },
        body: {
          padding: "24px",
        },
      }}
    >
      <Stack gap="xl">
        {/* Top Developer Identity Lockup */}
        <div
          style={{
            borderRadius: 18,
            padding: "20px 22px",
            background: SA.panel,
            border: `1px solid ${SA.border}`,
            boxShadow: SA.shadow,
          }}
        >
          <Group justify="space-between" align="center">
            <Group gap="md">
              <Avatar
                src={customAvatarUrl || undefined}
                size={54}
                radius="xl"
                styles={{
                  root: {
                    background: `${SA.accent}22`,
                    border: `2px solid ${SA.accent}`,
                    color: SA.accent,
                    fontWeight: 900,
                    fontSize: 22,
                  },
                }}
              >
                {!customAvatarUrl && fullName.slice(0, 1).toUpperCase()}
              </Avatar>
              <div>
                <Text fw={800} size="md" style={{ color: SA.text, fontSize: 16 }}>
                  {fullName}
                </Text>
                <Text size="xs" style={{ color: SA.muted }}>
                  {user.email || "taha@corbel.internal"}
                </Text>
                <Group gap={6} mt={4}>
                  <Badge
                    size="xs"
                    styles={{
                      root: {
                        background: `${SA.accent}18`,
                        color: SA.accent,
                        fontWeight: 700,
                      },
                    }}
                  >
                    Super Administrator
                  </Badge>
                  <Badge size="xs" variant="outline" color="gray">
                    Linux Host
                  </Badge>
                </Group>
              </div>
            </Group>

            <Tooltip label="App Version">
              <Badge
                variant="light"
                size="sm"
                color="orange"
                styles={{ root: { fontWeight: 700 } }}
              >
                v1.3.1
              </Badge>
            </Tooltip>
          </Group>
        </div>

        {/* Tab Navigation */}
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          styles={{
            list: { borderBottom: `1px solid ${SA.border}` },
            tab: {
              fontWeight: 700,
              fontSize: 13,
              color: SA.muted,
              "&[data-active]": {
                color: SA.accent,
                borderBottomColor: SA.accent,
              },
            },
          }}
        >
          <Tabs.List>
            <Tabs.Tab value="profile" leftSection={<User size={15} />}>
              Profile Changer
            </Tabs.Tab>
            <Tabs.Tab value="updater" leftSection={<Download size={15} />}>
              App Updates
            </Tabs.Tab>
            <Tabs.Tab value="credentials" leftSection={<KeyRound size={15} />}>
              Dev Tokens & DB
            </Tabs.Tab>
          </Tabs.List>

          {/* ============================================================== */}
          {/* TAB 1: PROFILE CHANGER                                         */}
          {/* ============================================================== */}
          <Tabs.Panel value="profile" pt="lg">
            <Stack gap="lg">
              {profileSuccess && (
                <Alert
                  icon={<CheckCircle2 size={16} />}
                  color="teal"
                  variant="light"
                  radius="md"
                  styles={{ root: { background: `${SA.accent}14`, color: SA.accent } }}
                >
                  Developer profile & avatar updated.
                </Alert>
              )}

              {profileError && (
                <Alert
                  icon={<AlertCircle size={16} />}
                  color="red"
                  variant="light"
                  radius="md"
                  styles={{ root: { color: SA.danger } }}
                >
                  {profileError}
                </Alert>
              )}

              {/* Avatar Changer Form */}
              <form onSubmit={handleSaveProfile}>
                <Stack gap="md">
                  <div>
                    <Text size="xs" fw={700} mb={6} style={{ color: SA.textSoft }}>
                      Avatar Image / URL
                    </Text>
                    <TextInput
                      placeholder="https://example.com/avatar.png or file path"
                      value={customAvatarUrl}
                      onChange={(e) => setCustomAvatarUrl(e.target.value)}
                      styles={{
                        input: {
                          background: SA.panel,
                          border: `1px solid ${SA.border}`,
                          color: SA.text,
                          borderRadius: 10,
                        },
                      }}
                    />
                    <Text size="xs" mt={4} style={{ color: SA.muted }}>
                      Enter a custom image link or select a preset below to change your avatar immediately.
                    </Text>
                  </div>

                  {/* Preset Quick Select */}
                  <div>
                    <Text size="xs" fw={700} mb={6} style={{ color: SA.textSoft }}>
                      Developer Presets
                    </Text>
                    <Group gap="xs">
                      {DEV_AVATAR_PRESETS.map((p) => (
                        <Button
                          key={p.id}
                          size="xs"
                          variant="subtle"
                          leftSection={<p.icon size={14} color={SA.accent} />}
                          onClick={() => {
                            setCustomAvatarUrl("");
                          }}
                          styles={{
                            root: {
                              background: SA.panel,
                              border: `1px solid ${SA.border}`,
                              color: SA.text,
                              borderRadius: 10,
                              "&:hover": { background: SA.panelHover, color: SA.accent },
                            },
                          }}
                        >
                          {p.label}
                        </Button>
                      ))}
                    </Group>
                  </div>

                  <TextInput
                    label="Developer Display Name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    styles={{
                      input: {
                        background: SA.panel,
                        border: `1px solid ${SA.border}`,
                        color: SA.text,
                        borderRadius: 10,
                        fontWeight: 650,
                      },
                    }}
                  />

                  <TextInput
                    label="Developer Handle"
                    value="@thefoolishcrow"
                    disabled
                    description="Personal engineering identity of Taha Asadullah"
                    styles={{
                      input: {
                        background: SA.panelStrong,
                        border: `1px solid ${SA.border}`,
                        color: SA.muted,
                        borderRadius: 10,
                      },
                    }}
                  />

                  <Button
                    type="submit"
                    loading={savingProfile}
                    leftSection={<Save size={15} />}
                    styles={{
                      root: {
                        background: SA.accent,
                        color: "#FFFFFF",
                        fontWeight: 700,
                        borderRadius: 10,
                        height: 40,
                        boxShadow: "0 6px 16px -4px rgba(224, 114, 95, 0.35)",
                        "&:hover": { filter: "brightness(0.92)" },
                      },
                    }}
                  >
                    Save Profile & Avatar
                  </Button>
                </Stack>
              </form>

              <Divider style={{ borderColor: SA.border }} />

              {/* Master Password Section */}
              <div>
                <Group gap={8} mb="sm">
                  <Lock size={16} color={SA.accent} />
                  <Text fw={750} size="sm" style={{ color: SA.text }}>
                    Master Root Password
                  </Text>
                </Group>

                {passwordSuccess && (
                  <Alert
                    icon={<CheckCircle2 size={16} />}
                    color="teal"
                    variant="light"
                    radius="md"
                    mb="md"
                    styles={{ root: { background: `${SA.accent}14`, color: SA.accent } }}
                  >
                    Password successfully updated in SQLite database.
                  </Alert>
                )}

                {passwordError && (
                  <Alert
                    icon={<AlertCircle size={16} />}
                    color="red"
                    variant="light"
                    radius="md"
                    mb="md"
                    styles={{ root: { color: SA.danger } }}
                  >
                    {passwordError}
                  </Alert>
                )}

                <form onSubmit={handleSavePassword}>
                  <Stack gap="sm">
                    <PasswordInput
                      label="Current Master Password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      required
                      styles={{
                        input: {
                          background: SA.panel,
                          border: `1px solid ${SA.border}`,
                          color: SA.text,
                          borderRadius: 10,
                        },
                      }}
                    />
                    <PasswordInput
                      label="New Master Password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      styles={{
                        input: {
                          background: SA.panel,
                          border: `1px solid ${SA.border}`,
                          color: SA.text,
                          borderRadius: 10,
                        },
                      }}
                    />
                    <PasswordInput
                      label="Confirm New Master Password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      styles={{
                        input: {
                          background: SA.panel,
                          border: `1px solid ${SA.border}`,
                          color: SA.text,
                          borderRadius: 10,
                        },
                      }}
                    />
                    <Button
                      type="submit"
                      loading={savingPassword}
                      styles={{
                        root: {
                          background: SA.panel,
                          color: SA.text,
                          border: `1px solid ${SA.border}`,
                          fontWeight: 700,
                          borderRadius: 10,
                          height: 38,
                          "&:hover": { background: SA.panelHover, color: SA.accent },
                        },
                      }}
                    >
                      Update Password
                    </Button>
                  </Stack>
                </form>
              </div>
            </Stack>
          </Tabs.Panel>

          {/* ============================================================== */}
          {/* TAB 2: APP UPDATES & RELEASE                                   */}
          {/* ============================================================== */}
          <Tabs.Panel value="updater" pt="lg">
            <Stack gap="lg">
              <div
                style={{
                  borderRadius: 16,
                  padding: "20px 22px",
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                }}
              >
                <Group justify="space-between" align="flex-start" mb="md">
                  <div>
                    <Text fw={750} size="sm" style={{ color: SA.text, fontSize: 15 }}>
                      Corbel ERP Release Channel
                    </Text>
                    <Text size="xs" style={{ color: SA.muted }}>
                      Built on Tauri 2 + SQLite WAL + Neon Cloud
                    </Text>
                  </div>
                  <Badge variant="outline" color="orange">
                    v1.3.1-sovereign
                  </Badge>
                </Group>

                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    background: SA.panelStrong,
                    border: `1px solid ${SA.border}`,
                    marginBottom: 16,
                  }}
                >
                  <Group justify="space-between" mb={6}>
                    <Text size="xs" fw={700} style={{ color: SA.text }}>
                      Active Binary:
                    </Text>
                    <Text size="xs" style={{ color: SA.muted, fontFamily: "monospace" }}>
                      corbel-erp-linux-x86_64
                    </Text>
                  </Group>
                  <Group justify="space-between" mb={6}>
                    <Text size="xs" fw={700} style={{ color: SA.text }}>
                      Updater Engine:
                    </Text>
                    <Text size="xs" style={{ color: SA.muted, fontFamily: "monospace" }}>
                      tauri-plugin-updater
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" fw={700} style={{ color: SA.text }}>
                      Repository:
                    </Text>
                    <Text size="xs" style={{ color: SA.accent, fontFamily: "monospace" }}>
                      TheFoolishCrow/corbel-erp
                    </Text>
                  </Group>
                </div>

                {updateError && (
                  <Alert
                    icon={<AlertCircle size={15} />}
                    color="red"
                    variant="light"
                    radius="md"
                    mb="md"
                    styles={{ root: { color: SA.danger } }}
                  >
                    {updateError}
                  </Alert>
                )}

                {updateResult && (
                  <div
                    style={{
                      padding: "16px",
                      borderRadius: 12,
                      background: updateResult.available ? `${SA.accent}14` : SA.panelStrong,
                      border: `1px solid ${updateResult.available ? SA.accent : SA.border}`,
                      marginBottom: 16,
                    }}
                  >
                    {updateResult.available ? (
                      <Stack gap="xs">
                        <Group justify="space-between">
                          <Text fw={800} size="sm" style={{ color: SA.accent }}>
                            New Version Available: v{updateResult.update?.version}
                          </Text>
                          <Badge color="orange">Ready to Install</Badge>
                        </Group>
                        {updateResult.update?.body && (
                          <Text size="xs" style={{ color: SA.text, whiteSpace: "pre-wrap" }}>
                            {updateResult.update.body}
                          </Text>
                        )}
                        <Button
                          loading={installingUpdate}
                          onClick={handleInstallUpdate}
                          leftSection={<Download size={14} />}
                          styles={{
                            root: {
                              background: SA.accent,
                              color: "#FFFFFF",
                              fontWeight: 700,
                              borderRadius: 10,
                              marginTop: 8,
                            },
                          }}
                        >
                          Download & Install Update (Auto-Restart)
                        </Button>
                      </Stack>
                    ) : (
                      <Group gap={10}>
                        <CheckCircle2 size={18} color={SA.accent} />
                        <div>
                          <Text fw={750} size="xs" style={{ color: SA.text }}>
                            You are running the latest version (v{updateResult.currentVersion})
                          </Text>
                          <Text size="xs" style={{ color: SA.muted }}>
                            No pending updates found on GitHub Releases endpoint.
                          </Text>
                        </div>
                      </Group>
                    )}
                  </div>
                )}

                <Button
                  fullWidth
                  loading={checkingUpdate}
                  onClick={handleCheckUpdate}
                  leftSection={<RefreshCw size={15} />}
                  styles={{
                    root: {
                      background: SA.panelStrong,
                      color: SA.text,
                      border: `1px solid ${SA.border}`,
                      fontWeight: 700,
                      borderRadius: 10,
                      height: 40,
                      "&:hover": { background: SA.accent, color: "#FFFFFF" },
                    },
                  }}
                >
                  Check for Software Updates
                </Button>
              </div>
            </Stack>
          </Tabs.Panel>

          {/* ============================================================== */}
          {/* TAB 3: DEV CREDENTIALS & TOKENS                                */}
          {/* ============================================================== */}
          <Tabs.Panel value="credentials" pt="lg">
            <Stack gap="md">
              <div
                style={{
                  borderRadius: 16,
                  padding: "18px 20px",
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                }}
              >
                <Text fw={750} size="sm" mb={4} style={{ color: SA.text }}>
                  Developer Diagnostics
                </Text>
                <Text size="xs" mb="md" style={{ color: SA.muted }}>
                  Direct telemetry & connection values for local debugging
                </Text>

                <Stack gap="xs">
                  <div>
                    <Text size="xs" fw={700} style={{ color: SA.muted }}>
                      Root User ID
                    </Text>
                    <Group justify="space-between" mt={2}>
                      <Text size="xs" style={{ color: SA.text, fontFamily: "monospace" }}>
                        {user.id}
                      </Text>
                      <CopyButton value={user.id}>
                        {({ copied, copy }) => (
                          <Button size="compact-xs" variant="subtle" onClick={copy}>
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                          </Button>
                        )}
                      </CopyButton>
                    </Group>
                  </div>

                  <Divider style={{ borderColor: SA.border }} />

                  <div>
                    <Text size="xs" fw={700} style={{ color: SA.muted }}>
                      Session Authority
                    </Text>
                    <Text size="xs" style={{ color: SA.accent, fontWeight: 700 }}>
                      Sovereign Root / super_admin
                    </Text>
                  </div>

                  <Divider style={{ borderColor: SA.border }} />

                  <div>
                    <Text size="xs" fw={700} style={{ color: SA.muted }}>
                      Neon PostgreSQL Cloud Pool
                    </Text>
                    <Text size="xs" style={{ color: SA.text, fontFamily: "monospace" }}>
                      ep-restless-surf-a123.neon.tech:5432/corbel
                    </Text>
                  </div>

                  <Divider style={{ borderColor: SA.border }} />

                  <div>
                    <Text size="xs" fw={700} style={{ color: SA.muted }}>
                      Local SQLite WAL DB
                    </Text>
                    <Text size="xs" style={{ color: SA.text, fontFamily: "monospace" }}>
                      ~/.local/share/corbel-erp/corbel.db (WAL Mode)
                    </Text>
                  </div>
                </Stack>
              </div>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Drawer>
  );
}
