import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Divider,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  getAllCurrencies,
  getCompany,
  getErrorMessage,
  updateCompany,
} from "../../../api/backend";
import { reportOnboardingEvent } from "../../../onboarding/bus";
import type { CurrencyConfig } from "../../../types/backend";

const PROVINCE_OPTIONS = [
  { value: "Punjab", label: "Punjab (PRA)" },
  { value: "Sindh", label: "Sindh (SRB)" },
  { value: "Khyber Pakhtunkhwa", label: "Khyber Pakhtunkhwa (KPRA)" },
  { value: "Balochistan", label: "Balochistan (BRA)" },
  { value: "Islamabad", label: "Islamabad Capital Territory (ICT)" },
  { value: "Gilgit-Baltistan", label: "Gilgit-Baltistan" },
  { value: "Azad Kashmir", label: "Azad Jammu & Kashmir" },
];

export function CompanyProfileTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<CurrencyConfig[]>([]);

  const form = useForm({
    initialValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
      taxNumber: "",
      ntn: "",
      strn: "",
      province: "",
      fbrRegistered: false,
      currencyCode: "PKR",
    },
  });

  useEffect(() => {
    getAllCurrencies()
      .then((list) => setCurrencies(list))
      .catch(() => {});
    getCompany()
      .then((c) => {
        form.setValues({
          name: c.name,
          email: c.email ?? "",
          phone: c.phone ?? "",
          address: c.address ?? "",
          taxNumber: c.ntn ?? c.taxNumber ?? "",
          ntn: c.ntn ?? c.taxNumber ?? "",
          strn: c.strn ?? "",
          province: c.province ?? "",
          fbrRegistered: Boolean(c.fbrRegistered),
          currencyCode: c.currencyCode,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(values: typeof form.values) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const effectiveNtn = values.ntn.trim() || values.taxNumber.trim() || null;
      await updateCompany({
        name: values.name.trim(),
        email: values.email.trim() || null,
        phone: values.phone.trim() || null,
        address: values.address.trim() || null,
        taxNumber: effectiveNtn,
        ntn: effectiveNtn,
        strn: values.strn.trim() || null,
        province: values.province.trim() || null,
        fbrRegistered: values.fbrRegistered,
        currencyCode: values.currencyCode,
      });
      reportOnboardingEvent({ type: "settings-saved" });
      setSuccess("Company profile updated successfully.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Text c="dimmed">Loading...</Text>;

  return (
    <Card withBorder padding="lg" maw={650}>
      <Title order={5} mb="md">
        Company Profile
      </Title>
      <form onSubmit={form.onSubmit(handleSave)}>
        <Stack gap="md">
          <TextInput
            label="Company Name"
            placeholder="e.g. ABC Traders"
            required
            {...form.getInputProps("name")}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Email"
              placeholder="e.g. info@company.com"
              {...form.getInputProps("email")}
            />
            <TextInput
              label="Phone"
              placeholder="e.g. 0300-1234567"
              {...form.getInputProps("phone")}
            />
          </SimpleGrid>
          <TextInput
            label="Address"
            placeholder="e.g. 123 Main Bazaar, Lahore"
            {...form.getInputProps("address")}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="National Tax Number (NTN)"
              placeholder="e.g. 1234567-8"
              {...form.getInputProps("ntn")}
              onChange={(e) => {
                const val = e.currentTarget.value;
                form.setFieldValue("ntn", val);
                form.setFieldValue("taxNumber", val);
              }}
            />
            <TextInput
              label="Sales Tax Reg # (STRN)"
              placeholder="e.g. 12-34-5678-901-23"
              {...form.getInputProps("strn")}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Province / Revenue Authority"
              placeholder="Select tax jurisdiction"
              data={PROVINCE_OPTIONS}
              clearable
              {...form.getInputProps("province")}
            />
            <Select
              label="Default Currency"
              data={
                currencies.length > 0
                  ? currencies.map((c) => ({
                      value: c.code,
                      label: `${c.code} — ${c.name}`,
                    }))
                  : ["PKR", "USD", "EUR", "GBP", "AED", "SAR", "INR"]
              }
              {...form.getInputProps("currencyCode")}
            />
          </SimpleGrid>

          <Divider my="xs" label="Tax Compliance & Integrations" labelPosition="center" />

          <Switch
            label="FBR Digital Invoicing Integration Active"
            description="Declare this company as registered with the Federal Board of Revenue for fiscal invoicing."
            checked={form.values.fbrRegistered}
            onChange={(event) =>
              form.setFieldValue("fbrRegistered", event.currentTarget.checked)
            }
          />

          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          {success && (
            <Text c="green" size="sm">
              {success}
            </Text>
          )}
          <Group justify="flex-end">
            <Button
              type="submit"
              loading={saving}
              data-tour="settings-save"
            >
              Save Changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}
