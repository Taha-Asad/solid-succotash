import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Group,
  Select,
  SimpleGrid,
  Stack,
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
          taxNumber: c.taxNumber ?? "",
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
      await updateCompany({
        ...values,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        taxNumber: values.taxNumber || null,
      });
      reportOnboardingEvent({ type: "settings-saved" });
      setSuccess("Company profile updated.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Text c="dimmed">Loading...</Text>;

  return (
    <Card withBorder padding="lg" maw={600}>
      <Title order={5} mb="md">
        Company Profile
      </Title>
      <form onSubmit={form.onSubmit(handleSave)}>
        <Stack gap="md">
          <TextInput
            label="Company Name"
            required
            {...form.getInputProps("name")}
          />
          <SimpleGrid cols={2}>
            <TextInput label="Email" {...form.getInputProps("email")} />
            <TextInput label="Phone" {...form.getInputProps("phone")} />
          </SimpleGrid>
          <TextInput label="Address" {...form.getInputProps("address")} />
          <SimpleGrid cols={2}>
            <TextInput
              label="Tax Number (NTN)"
              {...form.getInputProps("taxNumber")}
            />
            <Select
              label="Currency"
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
