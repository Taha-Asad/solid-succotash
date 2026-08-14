// ==========================================
// COMPANY SETUP PAGE (First Launch)
// ==========================================
// Premium split-screen: brand hero left, setup form right.
// Creates the company + owner account in one step.

import { useState } from "react";
import { motion } from "framer-motion";

import {
  Button,
  Card,
  Group,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";

import {
  Building2,
  User,
  Mail,
  Lock,
  Phone,
  FileBadge,
  MapPin,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

import { registerCompany, getErrorMessage } from "../../api/backend";
import type { PublicUser, RegisterCompanyResult } from "../../types/backend";
import { INK } from "../../theme";
import { useI18n } from "../../i18n/I18nProvider";
import LanguageMenu from "../../components/LanguageMenu";

// ---- Props ----

interface SetupPageProps {
  onSetupComplete: (user: PublicUser, result: RegisterCompanyResult) => void;
}

// ---- Currency options ----

const CURRENCIES = [
  { value: "PKR", label: "PKR — Pakistani Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "SAR", label: "SAR — Saudi Riyal" },
  { value: "INR", label: "INR — Indian Rupee" },
];

// ---- Component ----

export default function SetupPage({ onSetupComplete }: SetupPageProps) {
  const [companyName, setCompanyName] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [currencyCode, setCurrencyCode] = useState("PKR");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await registerCompany({
        companyName,
        ownerFullName,
        email,
        password,
        phone: phone || null,
        address: address || null,
        taxNumber: taxNumber || null,
        currencyCode,
      });

      onSetupComplete(result.user, result);
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
        <motion.div
          aria-hidden
          style={{
            position: "absolute",
            width: 460,
            height: 460,
            borderRadius: "50%",
            top: -160,
            right: -120,
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
            width: 400,
            height: 400,
            borderRadius: "50%",
            bottom: -140,
            left: -100,
            background:
              "radial-gradient(circle, rgba(76,125,216,0.22) 0%, transparent 70%)",
          }}
          animate={{ scale: [1.15, 1, 1.15] }}
          transition={{ repeat: Infinity, duration: 10, ease: "easeInOut" }}
        />

        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.1 }}
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
          transition={{ duration: 0.5, delay: 0.2 }}
          style={{
            fontSize: 40,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: -1,
            margin: "0 0 12px",
          }}
        >
          {t("setup.heroTitle")}
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          style={{ color: "#A9B6D6", fontSize: 16, margin: "0 0 36px", maxWidth: 460 }}
        >
          {t("setup.heroSubtitle")}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.45 }}
        >
          <Stack gap="md" maw={400}>
            <Step n={1} title={t("setup.step1.title")} text={t("setup.step1.text")} />
            <Step n={2} title={t("setup.step2.title")} text={t("setup.step2.text")} />
            <Step n={3} title={t("setup.step3.title")} text={t("setup.step3.text")} />
          </Stack>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          style={{
            marginTop: 44,
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "#6B7BA6",
          }}
        >
          <ShieldCheck size={16} />
          <Text size="xs">{t("setup.singleTenant")}</Text>
        </motion.div>
      </motion.div>

      {/* ==================== FORM SIDE ==================== */}
      <Stack
        gap={0}
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: "24px 40px",
          background: INK.paper,
          overflowY: "auto",
        }}
      >
        <div style={{ position: "absolute", top: 20, insetInlineEnd: 20, zIndex: 10 }}>
          <LanguageMenu />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ width: "100%", maxWidth: 440 }}
        >
          <Card withBorder shadow="lg" p="xl">
            <Stack gap="xs" mb="md">
              <Text size="xs" fw={700} style={{ color: INK.gold, letterSpacing: 1.5, textTransform: "uppercase" }}>
                {t("setup.firstLaunch")}
              </Text>
              <Text fw={800} size="xl" style={{ color: INK.text, letterSpacing: -0.4 }}>
                {t("setup.createWorkspace")}
              </Text>
              <Text size="sm" c="dimmed">
                {t("setup.ownerNote")}
              </Text>
            </Stack>

            <form onSubmit={handleSubmit}>
              <Stack gap="md">
                {/* COMPANY */}
                <Text size="xs" fw={700} style={{ color: INK.text, letterSpacing: 1, textTransform: "uppercase" }}>
                  {t("setup.companyInfo")}
                </Text>
                <TextInput
                  label={t("setup.companyName")}
                  placeholder={t("setup.companyNamePlaceholder")}
                  required
                  leftSection={<Building2 size={16} />}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.currentTarget.value)}
                />

                <SimpleGrid cols={2}>
                  <TextInput
                    label={t("setup.phone")}
                    placeholder={t("setup.phonePlaceholder")}
                    leftSection={<Phone size={15} />}
                    value={phone}
                    onChange={(e) => setPhone(e.currentTarget.value)}
                  />
                  <TextInput
                    label={t("setup.taxNumber")}
                    placeholder={t("setup.taxNumberPlaceholder")}
                    leftSection={<FileBadge size={15} />}
                    value={taxNumber}
                    onChange={(e) => setTaxNumber(e.currentTarget.value)}
                  />
                </SimpleGrid>

                <TextInput
                  label={t("setup.address")}
                  placeholder={t("setup.addressPlaceholder")}
                  leftSection={<MapPin size={16} />}
                  value={address}
                  onChange={(e) => setAddress(e.currentTarget.value)}
                />

                <Select
                  label={t("setup.currency")}
                  data={CURRENCIES}
                  value={currencyCode}
                  onChange={(value) => setCurrencyCode(value ?? "PKR")}
                  allowDeselect={false}
                />

                {/* OWNER */}
                <Text size="xs" fw={700} style={{ color: INK.text, letterSpacing: 1, textTransform: "uppercase", marginTop: 4 }}>
                  {t("setup.ownerAccount")}
                </Text>
                <TextInput
                  label={t("setup.fullName")}
                  placeholder={t("setup.fullNamePlaceholder")}
                  required
                  leftSection={<User size={16} />}
                  value={ownerFullName}
                  onChange={(e) => setOwnerFullName(e.currentTarget.value)}
                />
                <TextInput
                  label={t("setup.email")}
                  placeholder={t("setup.emailPlaceholder")}
                  type="email"
                  required
                  leftSection={<Mail size={16} />}
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
                <PasswordInput
                  label={t("setup.password")}
                  placeholder={t("setup.passwordPlaceholder")}
                  required
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
                    {t("setup.createCompany")}
                  </Button>
                </motion.div>
              </Stack>
            </form>
          </Card>
        </motion.div>
      </Stack>
    </Stack>
  );
}

// ---- Step helper ----

function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <Group gap="sm" align="flex-start" wrap="nowrap">
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
          color: "#131C39",
          fontWeight: 800,
          fontSize: 13,
        }}
      >
        {n}
      </div>
      <Stack gap={1}>
        <Text fw={700} size="sm">{title}</Text>
        <Text size="xs" style={{ color: "#A9B6D6" }}>{text}</Text>
      </Stack>
    </Group>
  );
}
