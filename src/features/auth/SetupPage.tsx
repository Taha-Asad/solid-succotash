// ==========================================
// COMPANY SETUP PAGE (First Launch)
// ==========================================
//
// This screen appears ONLY when no company exists in the database.
// It collects the company name, owner details, and creates both
// the company and the owner account in one operation.
//
// After success, the owner is automatically logged in and taken
// to the dashboard. They never see the login page on first launch.

import { useState } from "react";

import {
  // Anchor,
  // Group,
  Button,
  Container,
  Paper,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import { registerCompany, getErrorMessage } from "../../api/backend";
import type { PublicUser, RegisterCompanyResult } from "../../types/backend";

// ---- Props ----
// This page needs to TELL the App "setup is done, here's the user".
// The App passes a callback function that this page calls on success.

interface SetupPageProps {
  onSetupComplete: (user: PublicUser, result: RegisterCompanyResult) => void;
}

// ---- Currency options for the dropdown ----

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
  // Form field values
  const [companyName, setCompanyName] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [currencyCode, setCurrencyCode] = useState("PKR");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Form submission ----

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
        // Empty string → null (Rust expects null, not "")
        phone: phone || null,
        address: address || null,
        taxNumber: taxNumber || null,
        currencyCode,
      });

      // Tell the App: setup done, here's the owner
      onSetupComplete(result.user, result);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // ---- Render ----

  return (
    <Container size="sm" py="xl">
      <Paper radius="md" p="xl" withBorder>
        <Title order={2} ta="center" mb="xs">
          Welcome to Ijaz & Company
        </Title>
        <Text c="dimmed" size="sm" ta="center" mb="xl">
          Set up your company to get started. You will become the owner.
        </Text>

        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {/* ---- COMPANY DETAILS ---- */}
            <Title order={5}>Company Information</Title>

            <TextInput
              label="Company Name"
              placeholder="Ijaz & Company"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.currentTarget.value)}
            />

            <SimpleGrid cols={2}>
              <TextInput
                label="Phone"
                placeholder="+92 300 1234567"
                value={phone}
                onChange={(e) => setPhone(e.currentTarget.value)}
              />
              <TextInput
                label="Tax Number (optional)"
                placeholder="NTN or STRN"
                value={taxNumber}
                onChange={(e) => setTaxNumber(e.currentTarget.value)}
              />
            </SimpleGrid>

            <TextInput
              label="Address"
              placeholder="Lahore, Punjab, Pakistan"
              value={address}
              onChange={(e) => setAddress(e.currentTarget.value)}
            />

            <Select
              label="Currency"
              data={CURRENCIES}
              value={currencyCode}
              onChange={(value) => setCurrencyCode(value ?? "PKR")}
              allowDeselect={false}
            />

            {/* ---- OWNER DETAILS ---- */}
            <Title order={5} mt="sm">
              Owner Account
            </Title>

            <TextInput
              label="Your Full Name"
              placeholder="Ijaz Ahmad"
              required
              value={ownerFullName}
              onChange={(e) => setOwnerFullName(e.currentTarget.value)}
            />

            <TextInput
              label="Email"
              placeholder="owner@ijaz.com"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />

            <PasswordInput
              label="Password"
              placeholder="Choose a strong password"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />

            {/* ---- ERROR ---- */}
            {error && (
              <Text c="red" size="sm">
                {error}
              </Text>
            )}

            {/* ---- SUBMIT ---- */}
            <Button type="submit" fullWidth loading={loading} size="md">
              Create Company & Continue
            </Button>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
