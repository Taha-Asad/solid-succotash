// ==========================================
// LOGIN PAGE — Premium split-screen auth
// ==========================================
// Left: animated brand hero. Right: sign-in form.

import { useState } from "react";
import { motion } from "framer-motion";

import {
  Button,
  Card,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";

import {
  Mail,
  Lock,
  ArrowRight,
  ShieldCheck,
  Boxes,
  ReceiptText,
  ChartPie,
} from "lucide-react";

import { loginUser, getErrorMessage } from "../../api/backend";
import type { PublicUser } from "../../types/backend";
import { INK } from "../../theme";
import { useI18n } from "../../i18n/I18nProvider";
import LanguageMenu from "../../components/LanguageMenu";

// ---- Props ----

interface LoginPageProps {
  onLogin: (user: PublicUser) => void;
}

const FEATURES = [
  {
    icon: <Boxes size={18} />,
    titleKey: "login.feat1.title",
    textKey: "login.feat1.text",
  },
  {
    icon: <ReceiptText size={18} />,
    titleKey: "login.feat2.title",
    textKey: "login.feat2.text",
  },
  {
    icon: <ChartPie size={18} />,
    titleKey: "login.feat3.title",
    textKey: "login.feat3.text",
  },
];

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const user = await loginUser({ email, password });
      onLogin(user);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack
      h="100vh"
      gap={0}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        background: INK.paper,
      }}
    >
      {/* ==================== BRAND HERO ==================== */}
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{
          flex: 1.1,
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 64px",
          color: "#fff",
          background:
            "linear-gradient(140deg, #0E1530 0%, #16214A 50%, #23315F 100%)",
        }}
      >
        {/* Ambient glows */}
        <motion.div
          aria-hidden
          style={{
            position: "absolute",
            width: 480,
            height: 480,
            borderRadius: "50%",
            top: -180,
            right: -140,
            background:
              "radial-gradient(circle, rgba(201,149,42,0.28) 0%, transparent 70%)",
          }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          style={{
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: "50%",
            bottom: -160,
            left: -120,
            background:
              "radial-gradient(circle, rgba(76,125,216,0.25) 0%, transparent 70%)",
          }}
          animate={{ scale: [1.15, 1, 1.15] }}
          transition={{ repeat: Infinity, duration: 10, ease: "easeInOut" }}
        />

        {/* Brand mark */}
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.15 }}
          style={{
            width: 58,
            height: 58,
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
            color: "#131C39",
            fontWeight: 800,
            fontSize: 22,
            marginBottom: 28,
            boxShadow: "0 12px 32px -8px rgba(201,149,42,0.6)",
          }}
        >
          I&
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          style={{
            fontSize: 40,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: -1,
            margin: "0 0 12px",
          }}
        >
          {t("login.heroTitle")}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
          style={{ color: "#A9B6D6", fontSize: 16, margin: "0 0 40px", maxWidth: 460 }}
        >
          {t("login.heroSubtitle")}
        </motion.p>

        <Stack gap="md" maw={400}>
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.titleKey}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.45 + i * 0.12 }}
            >
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(201,149,42,0.15)",
                    color: "#E6C965",
                    border: "1px solid rgba(201,149,42,0.3)",
                  }}
                >
                  {f.icon}
                </div>
                <Stack gap={1}>
                  <Text fw={700} size="sm">{t(f.titleKey)}</Text>
                  <Text size="xs" style={{ color: "#A9B6D6" }}>{t(f.textKey)}</Text>
                </Stack>
              </Group>
            </motion.div>
          ))}
        </Stack>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          style={{
            marginTop: 44,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "#6B7BA6",
          }}
        >
          <ShieldCheck size={16} />
          <Text size="xs">{t("login.privateData")}</Text>
        </motion.div>
      </motion.div>

      {/* ==================== FORM SIDE ==================== */}
      <Stack
        gap={0}
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: "32px 40px",
          background: INK.paper,
        }}
      >
        <div style={{ position: "absolute", top: 20, insetInlineEnd: 20, zIndex: 10 }}>
          <LanguageMenu />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ width: "100%", maxWidth: 400 }}
        >
          <Card withBorder shadow="lg" p="xl" data-tour="login-form">
            <Stack gap="xs" mb="lg">
              <Text size="xs" fw={700} style={{ color: INK.gold, letterSpacing: 1.5, textTransform: "uppercase" }}>
                {t("login.welcome")}
              </Text>
              <Text fw={800} size="xl" style={{ color: INK.text, letterSpacing: -0.4 }}>
                {t("login.signinTitle")}
              </Text>
              <Text size="sm" c="dimmed">
                {t("login.signinSubtitle")}
              </Text>
            </Stack>

            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                <TextInput
                  label={t("login.email")}
                  placeholder={t("login.emailPlaceholder")}
                  type="email"
                  required
                  size="md"
                  leftSection={<Mail size={16} />}
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />

                <PasswordInput
                  label={t("login.password")}
                  placeholder={t("login.passwordPlaceholder")}
                  required
                  size="md"
                  leftSection={<Lock size={16} />}
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />

                {error && (
                  <Text c="red" size="sm">
                    {error}
                  </Text>
                )}

                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button
                    type="submit"
                    fullWidth
                    loading={loading}
                    size="md"
                    rightSection={!loading && <ArrowRight size={16} />}
                    styles={{
                      root: {
                        background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
                        color: "#131C39",
                        fontWeight: 700,
                        height: 46,
                        "&:hover": { filter: "brightness(1.05)" },
                      },
                    }}
                  >
                    {t("login.signIn")}
                  </Button>
                </motion.div>
              </Stack>
            </form>
          </Card>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            style={{
              textAlign: "center",
              color: "#8A94A8",
              fontSize: 12,
              marginTop: 20,
            }}
          >
            Ijaz & Company ERP — v0.1
          </motion.p>
        </motion.div>
      </Stack>
    </Stack>
  );
}
