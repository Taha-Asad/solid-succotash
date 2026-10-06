import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  LoadingOverlay,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { Building2, Mail, Phone, ShieldAlert } from "lucide-react";

import { getErrorMessage, updateTenantCompany } from "../../api/backend";
import type { PublicCompany, UpdateTenantCompanyInput } from "../../types/backend";
import { useI18n } from "../../i18n/I18nProvider";
import LottieAnimation from "../../components/LottieAnimation";
import successCheck from "../../assets/lottie/success-check.json";
import { useSaTheme } from "./saTheme.tsx";

export default function EditTenantModal({
  company,
  opened,
  onClose,
  onSaved,
}: {
  company: PublicCompany | null;
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    taxNumber: "",
    currencyCode: "PKR",
  });

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name ?? "",
        email: company.email ?? "",
        phone: company.phone ?? "",
        address: company.address ?? "",
        taxNumber: company.taxNumber ?? "",
        currencyCode: company.currencyCode ?? "PKR",
      });
      setSaved(false);
      setError("");
    }
  }, [company, opened]);

  async function handleSave() {
    if (!company) return;
    if (!form.name.trim()) {
      setError(t("sa.tenants.register.required"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const input: UpdateTenantCompanyInput = {
        companyId: company.id,
        name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        taxNumber: form.taxNumber || null,
        currencyCode: form.currencyCode,
      };
      await updateTenantCompany(input);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("sa.tenants.edit.title")}
      size="md"
      centered
      overlayProps={{ blur: 4, backgroundOpacity: 0.6 }}
      styles={{ header: { fontWeight: 800 } }}
    >
      <LoadingOverlay visible={saving} />
      {saved ? (
        <Stack align="center" gap={6} py="md">
          <LottieAnimation animationData={successCheck} size={150} />
          <Text fw={700} style={{ color: SA.success }}>
            {t("sa.tenants.edit.saved")}
          </Text>
          <Button
            mt="xs"
            variant="light"
            onClick={onClose}
            styles={{ root: { color: SA.text, border: `1px solid ${SA.border}` } }}
          >
            {t("sa.tenants.register.done")}
          </Button>
        </Stack>
      ) : (
        <Stack gap="sm">
          <TextInput
            label={t("sa.tenants.register.companyName")}
            required
            value={form.name}
            onChange={(e) => {
              const name = e.currentTarget.value;
              setForm((f) => ({ ...f, name }));
            }}
            leftSection={<Building2 size={15} />}
          />
          <SimpleGrid cols={2} spacing="sm">
            <TextInput
              label={t("sa.tenants.register.adminEmail")}
              type="email"
              value={form.email}
              onChange={(e) => {
                const email = e.currentTarget.value;
                setForm((f) => ({ ...f, email }));
              }}
              leftSection={<Mail size={15} />}
            />
            <TextInput
              label={t("sa.tenants.register.phone")}
              value={form.phone}
              onChange={(e) => {
                const phone = e.currentTarget.value;
                setForm((f) => ({ ...f, phone }));
              }}
              leftSection={<Phone size={15} />}
            />
          </SimpleGrid>
          <TextInput
            label={t("sa.tenants.register.address")}
            value={form.address}
            onChange={(e) => {
              const address = e.currentTarget.value;
              setForm((f) => ({ ...f, address }));
            }}
          />
          <SimpleGrid cols={2} spacing="sm">
            <TextInput
              label={t("sa.tenants.register.taxNumber")}
              value={form.taxNumber}
              onChange={(e) => {
                const taxNumber = e.currentTarget.value;
                setForm((f) => ({ ...f, taxNumber }));
              }}
            />
            <Select
              label={t("sa.tenants.register.currency")}
              data={["PKR", "USD", "GBP", "EUR", "AED", "SAR"]}
              value={form.currencyCode}
              onChange={(v) => setForm((f) => ({ ...f, currencyCode: v ?? "PKR" }))}
            />
          </SimpleGrid>

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
              onClick={handleSave}
              loading={saving}
              styles={{
                root: {
                  background: SA.gradient,
                  color: SA.dockActiveColor,
                  fontWeight: 700,
                  "&:hover": { filter: "brightness(1.08)" },
                },
              }}
            >
              {t("sa.tenants.edit.save")}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
