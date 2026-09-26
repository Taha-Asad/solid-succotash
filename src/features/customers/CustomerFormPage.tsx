// ==========================================
// CUSTOMER FORM PAGE
// Dedicated Full-Page Customer Creation & Editor
// ==========================================
// Replaces cramped modal dialogs with a spacious,
// clear, and responsive form experience.

import { useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Radio,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  ArrowLeft,
  FileCheck,
  Mail,
  MessageSquare,
  Phone,
  User,
  AlertCircle,
  Save,
} from "lucide-react";
import { createCustomer, getErrorMessage } from "../../api/backend";
import type { PublicCustomer } from "../../types/backend";
import {
  formatWhatsAppNumber,
  isValidWhatsAppNumber,
  launchWhatsAppUrl,
} from "../../utils/whatsapp";

interface CustomerFormPageProps {
  onBack: () => void;
  onCustomerCreated: (customer: PublicCustomer) => void;
}

export default function CustomerFormPage({
  onBack,
  onCustomerCreated,
}: CustomerFormPageProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      name: "",
      phone: "",
      email: "",
      address: "",
      buyerType: "unregistered" as "unregistered" | "registered",
      cnic: "",
      ntn: "",
      strn: "",
    },
    validate: {
      name: (val) =>
        val.trim().length === 0 ? "Customer or business name is required" : null,
      cnic: (val, values) => {
        if (values.buyerType === "unregistered" && val.trim().length > 0) {
          const clean = val.replace(/[^0-9]/g, "");
          if (clean.length !== 13) return "CNIC must be 13 digits (e.g. 35201-1234567-1)";
        }
        return null;
      },
      ntn: (val, values) => {
        if (values.buyerType === "registered" && val.trim().length === 0) {
          return "NTN is required for FBR-registered B2B customers";
        }
        return null;
      },
    },
  });

  async function handleSubmit(values: typeof form.values) {
    setSubmitting(true);
    setError(null);
    try {
      const created = await createCustomer({
        name: values.name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        address: values.address.trim(),
        buyerType: values.buyerType,
        cnic: values.cnic.trim(),
        ntn: values.ntn.trim(),
        strn: values.strn.trim(),
      });
      onCustomerCreated(created);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Helper to open WhatsApp for quick verification
  async function handleTestWhatsApp() {
    const raw = form.values.phone.trim();
    if (!isValidWhatsAppNumber(raw)) return;
    const clean = formatWhatsAppNumber(raw);
    const greeting = encodeURIComponent(
      `Assalam-o-Alaikum ${form.values.name.trim() || "Customer"}, this is a test message from Corbel ERP.`,
    );
    await launchWhatsAppUrl(`https://wa.me/${clean}?text=${greeting}`);
  }

  return (
    <Stack gap="xl" style={{ maxWidth: 1100, margin: "0 auto", paddingBottom: 60 }}>
      {/* Top Header Navigation */}
      <Box>
        <Group justify="space-between" align="center" mb="sm">
          <Button
            variant="subtle"
            color="gray"
            size="sm"
            leftSection={<ArrowLeft size={16} />}
            onClick={onBack}
            radius="md"
          >
            ← Back to Customer Directory
          </Button>

          <Group gap="xs">
            <Badge
              variant="light"
              color={form.values.buyerType === "registered" ? "blue" : "teal"}
              size="lg"
              radius="sm"
            >
              {form.values.buyerType === "registered"
                ? "FBR B2B Registered Client"
                : "Standard Retail / Walk-in"}
            </Badge>
          </Group>
        </Group>

        <Group justify="space-between" align="flex-end">
          <Box>
            <Title order={2} style={{ letterSpacing: -0.4 }}>
              Register New Customer
            </Title>
            <Text size="sm" c="dimmed" mt={4}>
              Add an individual client or commercial business for billing, ledger tracking, and FBR compliance.
            </Text>
          </Box>

          <Group gap="sm">
            <Button variant="default" onClick={onBack} disabled={submitting}>
              Cancel
            </Button>
            <Button
              leftSection={<Save size={16} />}
              loading={submitting}
              onClick={() => void form.onSubmit(handleSubmit)()}
              style={{
                background: "var(--app-accent, #1d2b54)",
                color: "#ffffff",
                fontWeight: 600,
              }}
            >
              Save Customer
            </Button>
          </Group>
        </Group>
      </Box>

      {error && (
        <Alert
          icon={<AlertCircle size={16} />}
          title="Could not register customer"
          color="red"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {/* Main Form Sections Grid */}
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="xl">
          {/* Card 1: Identity & Classification */}
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
                  Customer Identity & Classification
                </Text>
                <Text size="xs" c="dimmed">
                  Official name and commercial tax status for invoicing.
                </Text>
              </Box>
            </Group>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              <TextInput
                label="Full Name or Business Name"
                placeholder="e.g. Al-Madina Hardware or Muhammad Bilal"
                required
                size="md"
                {...form.getInputProps("name")}
              />

              <Box>
                <Text size="sm" fw={500} mb="xs">
                  Buyer Tax Classification
                </Text>
                <Radio.Group {...form.getInputProps("buyerType")}>
                  <Group mt="xs" gap="xl">
                    <Radio
                      value="unregistered"
                      label="Unregistered / Retail (Individual or Walk-in)"
                    />
                    <Radio
                      value="registered"
                      label="B2B Registered (Has NTN/STRN)"
                    />
                  </Group>
                </Radio.Group>
              </Box>
            </SimpleGrid>
          </Card>

          {/* Card 2: Contact Details & WhatsApp Integration */}
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
                <ThemeIcon size={34} radius="md" color="teal" variant="light">
                  <Phone size={18} />
                </ThemeIcon>
                <Box>
                  <Text fw={700} size="md">
                    Contact & Communication
                  </Text>
                  <Text size="xs" c="dimmed">
                    Mobile phone for automated SMS/WhatsApp invoices, plus delivery address.
                  </Text>
                </Box>
              </Group>

              {isValidWhatsAppNumber(form.values.phone) && (
                <Button
                  variant="light"
                  color="teal"
                  size="xs"
                  leftSection={<MessageSquare size={14} />}
                  onClick={handleTestWhatsApp}
                >
                  Test WhatsApp Chat
                </Button>
              )}
            </Group>

            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" mb="md">
              <TextInput
                label="Mobile / WhatsApp Number"
                placeholder="0300-1234567"
                description="Pakistani mobile format (e.g. 0300-1234567). Enables 1-click WhatsApp Khata balance reminders."
                leftSection={<Phone size={16} />}
                size="md"
                {...form.getInputProps("phone")}
              />

              <TextInput
                label="Email Address"
                placeholder="customer@example.com (optional)"
                leftSection={<Mail size={16} />}
                size="md"
                {...form.getInputProps("email")}
              />
            </SimpleGrid>

            <Textarea
              label="Billing / Delivery Address"
              placeholder="Shop #, Street, Commercial Market, City (e.g. Shop 12, Hall Road, Lahore)"
              minRows={3}
              {...form.getInputProps("address")}
            />
          </Card>

          {/* Card 3: Tax & FBR Compliance */}
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
              <ThemeIcon size={34} radius="md" color="violet" variant="light">
                <FileCheck size={18} />
              </ThemeIcon>
              <Box>
                <Text fw={700} size="md">
                  FBR Tax Registration & Identifiers
                </Text>
                <Text size="xs" c="dimmed">
                  Required for official corporate invoices and FBR digital invoice reporting.
                </Text>
              </Box>
            </Group>

            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
              <TextInput
                label="CNIC (National ID)"
                placeholder="35201-1234567-1 (13 digits)"
                description="For Pakistani unregistered individuals > Rs. 100k sales"
                {...form.getInputProps("cnic")}
              />

              <TextInput
                label="NTN (National Tax Number)"
                placeholder="1234567-8"
                description={
                  form.values.buyerType === "registered"
                    ? "Mandatory for registered B2B clients"
                    : "Optional for retail"
                }
                required={form.values.buyerType === "registered"}
                {...form.getInputProps("ntn")}
              />

              <TextInput
                label="STRN (Sales Tax Number)"
                placeholder="01-00-1234-567-89"
                description="Optional: Sales Tax Registration Number"
                {...form.getInputProps("strn")}
              />
            </SimpleGrid>
          </Card>

          {/* Bottom Actions Bar */}
          <Group justify="flex-end" gap="md" mt="md">
            <Button variant="default" size="md" onClick={onBack} disabled={submitting}>
              Discard & Return
            </Button>
            <Button
              type="submit"
              size="md"
              leftSection={<Save size={18} />}
              loading={submitting}
              style={{
                background: "var(--app-accent, #1d2b54)",
                color: "#ffffff",
                fontWeight: 600,
                minWidth: 160,
              }}
            >
              Save Customer
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
