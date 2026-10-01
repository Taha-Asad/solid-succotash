import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  LoadingOverlay,
  Modal,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  Building2,
  CreditCard,
  Mail,
  Phone,
  ShieldAlert,
} from "lucide-react";

import {
  getErrorMessage,
  listPackages,
  registerTenant,
} from "../../api/backend";
import type { PublicPackage, RegisterTenantInput } from "../../types/backend";
import { useI18n } from "../../i18n/I18nProvider";
import LottieAnimation from "../../components/LottieAnimation";
import successCheck from "../../assets/lottie/success-check.json";
import { useSaTheme } from "./saTheme.tsx";

export default function RegisterTenantModal({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    companyName: "",
    adminFullName: "",
    adminEmail: "",
    adminPassword: "",
    packageId: "",
    phone: "",
    address: "",
    taxNumber: "",
    currencyCode: "PKR",
    ntn: "",
    strn: "",
    province: "",
  });

  useEffect(() => {
    if (opened) {
      listPackages(true).then(setPackages).catch(() => {});
    }
  }, [opened]);

  useEffect(() => {
    if (!opened) setCreated(false);
  }, [opened]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    setError("");
    if (!form.companyName || !form.adminFullName || !form.adminEmail || !form.adminPassword) {
      setError(t("sa.tenants.register.required"));
      return;
    }
    if (!form.packageId) {
      setError(t("sa.tenants.register.needPackage"));
      return;
    }
    setLoading(true);
    try {
      const input: RegisterTenantInput = {
        companyName: form.companyName,
        adminFullName: form.adminFullName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
        packageId: form.packageId,
        phone: form.phone || null,
        address: form.address || null,
        taxNumber: form.taxNumber || null,
        currencyCode: form.currencyCode,
        ntn: form.ntn || null,
        strn: form.strn || null,
        province: form.province || null,
      };
      await registerTenant(input);
      setCreated(true);
      setForm({
        companyName: "",
        adminFullName: "",
        adminEmail: "",
        adminPassword: "",
        packageId: "",
        phone: "",
        address: "",
        taxNumber: "",
        currencyCode: "PKR",
        ntn: "",
        strn: "",
        province: "",
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <Modal
        opened={opened}
        onClose={onClose}
        size="sm"
        centered
        overlayProps={{ blur: 4, backgroundOpacity: 0.6 }}
      >
        <Stack align="center" gap={8} py="md">
          <LottieAnimation animationData={successCheck} size={190} />
          <Text fw={800} size="lg" style={{ color: SA.text }}>
            {t("sa.tenants.register.createdTitle")}
          </Text>
          <Text size="sm" ta="center" style={{ color: SA.muted }}>
            {t("sa.tenants.register.createdSubtitle")}
          </Text>
          <Button
            mt="sm"
            onClick={() => {
              onCreated();
              onClose();
              setCreated(false);
            }}
            styles={{
              root: {
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 700,
                "&:hover": { filter: "brightness(1.08)" },
              },
            }}
          >
            {t("sa.tenants.register.done")}
          </Button>
        </Stack>
      </Modal>
    );
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("sa.tenants.register.title")}
      size="lg"
      centered
      overlayProps={{ blur: 4, backgroundOpacity: 0.6 }}
      styles={{
        header: { fontWeight: 800 },
      }}
    >
      <LoadingOverlay visible={loading} />
      <Stack gap="sm">
        <Text size="xs" style={{ color: SA.muted }}>
          {t("sa.tenants.register.subtitle")}
        </Text>

        <Text size="xs" fw={700} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
          {t("sa.tenants.register.companySection")}
        </Text>
        <SimpleGrid cols={2} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.companyName")}
            placeholder={t("sa.tenants.register.companyNamePh")}
            required
            value={form.companyName}
            onChange={(e) => set("companyName", e.currentTarget.value)}
            leftSection={<Building2 size={15} />}
          />
          <Select
            label={t("sa.tenants.register.package")}
            placeholder={t("sa.tenants.register.packagePh")}
            required
            data={packages.map((p) => ({
              value: p.id,
              label: `${p.name} — ${p.price.toLocaleString()} / ${p.billingCycle}`,
            }))}
            value={form.packageId}
            onChange={(v) => set("packageId", v ?? "")}
            leftSection={<CreditCard size={15} />}
            searchable
          />
        </SimpleGrid>
        <SimpleGrid cols={2} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.phone")}
            value={form.phone}
            onChange={(e) => set("phone", e.currentTarget.value)}
            leftSection={<Phone size={15} />}
          />
          <TextInput
            label={t("sa.tenants.register.address")}
            value={form.address}
            onChange={(e) => set("address", e.currentTarget.value)}
          />
        </SimpleGrid>
        <SimpleGrid cols={3} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.taxNumber")}
            value={form.taxNumber}
            onChange={(e) => set("taxNumber", e.currentTarget.value)}
          />
          <TextInput
            label="NTN"
            value={form.ntn}
            onChange={(e) => set("ntn", e.currentTarget.value)}
          />
          <TextInput
            label="STRN"
            value={form.strn}
            onChange={(e) => set("strn", e.currentTarget.value)}
          />
        </SimpleGrid>
        <SimpleGrid cols={2} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.province")}
            value={form.province}
            onChange={(e) => set("province", e.currentTarget.value)}
          />
          <Select
            label={t("sa.tenants.register.currency")}
            data={["PKR", "USD", "GBP", "EUR", "AED", "SAR"]}
            value={form.currencyCode}
            onChange={(v) => set("currencyCode", v ?? "PKR")}
          />
        </SimpleGrid>

        <Text size="xs" fw={700} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 1 }}>
          {t("sa.tenants.register.adminSection")}
        </Text>
        <SimpleGrid cols={2} spacing="sm">
          <TextInput
            label={t("sa.tenants.register.adminName")}
            required
            value={form.adminFullName}
            onChange={(e) => set("adminFullName", e.currentTarget.value)}
          />
          <TextInput
            label={t("sa.tenants.register.adminEmail")}
            type="email"
            required
            value={form.adminEmail}
            onChange={(e) => set("adminEmail", e.currentTarget.value)}
            leftSection={<Mail size={15} />}
          />
        </SimpleGrid>
        <PasswordInput
          label={t("sa.tenants.register.adminPassword")}
          required
          value={form.adminPassword}
          onChange={(e) => set("adminPassword", e.currentTarget.value)}
        />

        {error && (
          <Alert color="red" icon={<ShieldAlert size={16} />} styles={{ root: { color: "#F87171" } }}>
            {error}
          </Alert>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="light" onClick={onClose}>
            {t("sa.common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            loading={loading}
            styles={{
              root: {
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 700,
                "&:hover": { filter: "brightness(1.08)" },
              },
            }}
          >
            {t("sa.tenants.register.create")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
