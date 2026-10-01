// ==========================================
// PLATFORM SETTINGS — theme, language & about
// ==========================================
// Platform-level configuration surfaced to the super admin.

import { useState } from "react";
import { motion } from "framer-motion";

import {
  Alert,
  Button,
  Group,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  KeyRound,
  Languages,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
} from "lucide-react";

import { changeMyPassword, getErrorMessage } from "../../api/backend";
import { useI18n } from "../../i18n/I18nProvider";
import { LANGUAGES, LANGUAGE_ORDER } from "../../i18n/translations";
import { useSaScheme, useSaTheme } from "./saTheme.tsx";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const item = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 220, damping: 24 },
  },
};

function SectionCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const SA = useSaTheme();
  return (
    <motion.div
      variants={item}
      style={{
        borderRadius: 18,
        padding: "20px 22px",
        background: SA.panel,
        border: `1px solid ${SA.border}`,
      }}
    >
      <Group gap={12} align="flex-start">
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${SA.accent}1f`,
            color: SA.accent,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <Stack gap={0}>
          <Text fw={800} size="sm" style={{ color: SA.text }}>
            {title}
          </Text>
          <Text size="xs" style={{ color: SA.muted }}>
            {description}
          </Text>
        </Stack>
      </Group>
      <div style={{ marginTop: 16 }}>{children}</div>
    </motion.div>
  );
}

export default function PlatformSettingsPage() {
  const { t, lang, setLang } = useI18n();
  const SA = useSaTheme();
  const { scheme, setScheme } = useSaScheme();

  const themeOptions = [
    { id: "dark" as const, label: t("sa.settings.dark"), icon: <Moon size={16} /> },
    { id: "light" as const, label: t("sa.settings.light"), icon: <Sun size={16} /> },
  ];

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      style={{ padding: "26px 28px", maxWidth: 860 }}
    >
      <motion.div variants={item}>
        <Text fw={800} size="xl" style={{ color: SA.text, letterSpacing: -0.3 }}>
          {t("sa.title.settings")}
        </Text>
        <Text size="sm" mt={2} style={{ color: SA.muted }}>
          {t("sa.settings.subtitle")}
        </Text>
      </motion.div>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mt="xl">
        <SectionCard
          title={t("sa.settings.theme")}
          description={t("sa.settings.themeDesc")}
          icon={<Palette size={18} />}
        >
          <Stack gap={8}>
            {themeOptions.map((opt) => {
              const active = scheme === opt.id;
              return (
                <UnstyledButton
                  key={opt.id}
                  onClick={() => setScheme(opt.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${active ? SA.accent : SA.border}`,
                    background: active ? `${SA.accent}14` : SA.panelStrong,
                    color: active ? SA.accent : SA.textSoft,
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  <Group gap={8} wrap="nowrap">
                    {opt.icon}
                    <span>{opt.label}</span>
                  </Group>
                  {active && <Check size={15} />}
                </UnstyledButton>
              );
            })}
          </Stack>
        </SectionCard>

        <SectionCard
          title={t("sa.settings.language")}
          description={t("sa.settings.languageDesc")}
          icon={<Languages size={18} />}
        >
          <Stack gap={8}>
            {LANGUAGE_ORDER.map((code) => {
              const active = lang === code;
              return (
                <UnstyledButton
                  key={code}
                  onClick={() => setLang(code)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${active ? SA.accent : SA.border}`,
                    background: active ? `${SA.accent}14` : SA.panelStrong,
                    color: active ? SA.accent : SA.textSoft,
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  <span>{LANGUAGES[code].label}</span>
                  {active && <Check size={15} />}
                </UnstyledButton>
              );
            })}
          </Stack>
        </SectionCard>

        <SectionCard
          title={t("sa.settings.about")}
          description={t("sa.settings.aboutDesc")}
          icon={<ShieldCheck size={18} />}
        >
          <Stack gap={10}>
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" style={{ color: SA.muted }}>
                {t("sa.settings.version")}
              </Text>
              <Text size="sm" fw={700} style={{ color: SA.text }}>
                Ijaz ERP
              </Text>
            </Group>
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" style={{ color: SA.muted }}>
                {t("sa.settings.channel")}
              </Text>
              <Text size="sm" fw={700} style={{ color: SA.text }}>
                {t("sa.settings.stable")}
              </Text>
            </Group>
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" style={{ color: SA.muted }}>
                {t("sa.settings.build")}
              </Text>
              <Text size="sm" fw={700} style={{ color: SA.text }}>
                v1.0.0
              </Text>
            </Group>
          </Stack>
        </SectionCard>

        <AdminPasswordChangeCard />
      </SimpleGrid>
    </motion.div>
  );
}

function AdminPasswordChangeCard() {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword) {
      setError(t("sa.settings.currentPasswordRequired"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("sa.settings.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("sa.settings.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SectionCard
      title={t("sa.settings.security")}
      description={t("sa.settings.securityDesc")}
      icon={<KeyRound size={18} />}
    >
      <form onSubmit={handleSubmit}>
        <Stack gap={10}>
          {error && (
            <Alert
              icon={<AlertCircle size={15} />}
              color="red"
              variant="light"
              radius="md"
              p="xs"
            >
              <Text size="xs">{error}</Text>
            </Alert>
          )}

          {success && (
            <Alert
              icon={<CheckCircle2 size={15} />}
              color="teal"
              variant="light"
              radius="md"
              p="xs"
            >
              <Text size="xs">{t("sa.settings.passwordUpdated")}</Text>
            </Alert>
          )}

          <PasswordInput
            label={t("sa.settings.currentPassword")}
            placeholder={t("sa.settings.currentPasswordPh")}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            required
            radius="md"
            size="xs"
          />

          <PasswordInput
            label={t("sa.settings.newPassword")}
            placeholder={t("sa.settings.newPasswordPh")}
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            required
            radius="md"
            size="xs"
          />

          <PasswordInput
            label={t("sa.settings.confirmPassword")}
            placeholder={t("sa.settings.confirmPasswordPh")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            required
            radius="md"
            size="xs"
          />

          <Button
            type="submit"
            fullWidth
            loading={loading}
            radius="md"
            mt={6}
            styles={{
              root: {
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 700,
                "&:hover": { filter: "brightness(1.1)" },
              },
            }}
          >
            {t("sa.settings.updatePassword")}
          </Button>
        </Stack>
      </form>
    </SectionCard>
  );
}
