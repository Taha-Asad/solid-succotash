// ==========================================
// REGISTER TENANT — PROVISIONING WORKBENCH DRAWER
// ==========================================
// Replaces generic popup modal with a dedicated, tactile slide-over workbench.
// Allows super admin to configure legal entity details, root credentials,
// and select subscription package with live schema and subdomain preview.

import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  CopyButton,
  Drawer,
  Group,
  PasswordInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Coins,
  Copy,
  Globe,
  KeyRound,
  Layers,
  Server,
  User,
} from "lucide-react";

import {
  getErrorMessage,
  listPackages,
  registerTenant,
} from "../../api/backend";
import type { PublicPackage, RegisterTenantInput, RegisterTenantResult } from "../../types/backend";
import { useSaTheme } from "./saTheme";

const PROVINCE_OPTIONS = [
  { value: "Punjab", label: "Punjab" },
  { value: "Sindh", label: "Sindh" },
  { value: "Khyber Pakhtunkhwa", label: "Khyber Pakhtunkhwa" },
  { value: "Balochistan", label: "Balochistan" },
  { value: "Islamabad Capital Territory", label: "Islamabad (ICT)" },
];

const CURRENCY_OPTIONS = [
  { value: "PKR", label: "PKR — Pakistani Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "SAR", label: "SAR — Saudi Riyal" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "EUR", label: "EUR — Euro" },
];

export default function RegisterTenantDrawer({
  opened,
  onClose,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const SA = useSaTheme();

  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<RegisterTenantResult | null>(null);

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
    province: "Punjab",
  });

  // Load packages when drawer opens
  useEffect(() => {
    if (opened) {
      setSuccessResult(null);
      setError(null);
      listPackages(true)
        .then((pkgs) => {
          setPackages(pkgs);
          if (pkgs.length > 0 && !form.packageId) {
            setForm((f) => ({ ...f, packageId: pkgs[0].id }));
          }
        })
        .catch((err) => console.error("Failed to load packages:", err));
    }
  }, [opened]);

  const setField = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  // Live subdomain derivation
  const derivedSubdomain =
    form.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 24) || "tenant";

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.companyName.trim()) {
      setError("Please specify the official company name.");
      return;
    }
    if (!form.adminFullName.trim() || !form.adminEmail.trim() || !form.adminPassword) {
      setError("Root super-admin name, email, and password are required.");
      return;
    }
    if (form.adminPassword.length < 8) {
      setError("Admin password must be at least 8 characters.");
      return;
    }
    if (!form.packageId) {
      setError("Please select a subscription package tier.");
      return;
    }

    setProvisioning(true);
    try {
      const input: RegisterTenantInput = {
        companyName: form.companyName.trim(),
        adminFullName: form.adminFullName.trim(),
        adminEmail: form.adminEmail.trim().toLowerCase(),
        adminPassword: form.adminPassword,
        packageId: form.packageId,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        taxNumber: form.taxNumber.trim() || null,
        currencyCode: form.currencyCode,
        ntn: form.ntn.trim() || null,
        strn: form.strn.trim() || null,
        province: form.province || null,
      };

      const result = await registerTenant(input);
      setSuccessResult(result);
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setProvisioning(false);
    }
  };

  const handleResetAndClose = () => {
    setSuccessResult(null);
    setError(null);
    setForm({
      companyName: "",
      adminFullName: "",
      adminEmail: "",
      adminPassword: "",
      packageId: packages[0]?.id || "",
      phone: "",
      address: "",
      taxNumber: "",
      currencyCode: "PKR",
      ntn: "",
      strn: "",
      province: "Punjab",
    });
    onClose();
  };

  const selectedPkg = packages.find((p) => p.id === form.packageId);

  return (
    <Drawer
      opened={opened}
      onClose={handleResetAndClose}
      position="right"
      size={620}
      padding={0}
      withCloseButton={false}
      styles={{
        content: {
          background: SA.bg,
          borderLeft: `1px solid ${SA.border}`,
          boxShadow: "-8px 0 32px rgba(0, 0, 0, 0.08)",
        },
        body: {
          height: "100%",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* Drawer Header */}
      <div
        style={{
          padding: "24px 28px",
          borderBottom: `1px solid ${SA.border}`,
          background: SA.panel,
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <Group justify="space-between" align="flex-start">
          <Group gap={14}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: `${SA.accent}14`,
                color: SA.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Building2 size={22} />
            </div>
            <div>
              <Text fw={800} size="md" style={{ color: SA.text, fontSize: 17 }}>
                Provision Sovereign Tenant
              </Text>
              <Text size="xs" style={{ color: SA.muted }}>
                Isolate database schema, generate credentials, and assign tier
              </Text>
            </div>
          </Group>

          <Badge
            variant="light"
            styles={{
              root: {
                background: `${SA.accent}14`,
                color: SA.accent,
                fontWeight: 700,
              },
            }}
          >
            Workbench
          </Badge>
        </Group>
      </div>

      {/* Main Form Body / Success Screen */}
      <ScrollArea style={{ flex: 1 }} p={28}>
        {successResult ? (
          /* Success Screen */
          <Stack gap="lg" py="md">
            <div
              style={{
                padding: "24px",
                borderRadius: 18,
                background: SA.panel,
                border: `1px solid ${SA.border}`,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: `${SA.accent}14`,
                  color: SA.accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px",
                }}
              >
                <CheckCircle2 size={32} />
              </div>

              <Text fw={800} size="lg" style={{ color: SA.text }}>
                Tenant Provisioned Successfully
              </Text>
              <Text size="xs" style={{ color: SA.muted, marginTop: 4 }}>
                Isolated PostgreSQL tenant schema is initialized and operational.
              </Text>

              <div
                style={{
                  margin: "20px 0",
                  padding: "16px",
                  borderRadius: 14,
                  background: SA.panelStrong,
                  border: `1px solid ${SA.border}`,
                  textAlign: "left",
                }}
              >
                <Group justify="space-between" mb={8}>
                  <Text size="xs" fw={700} style={{ color: SA.text }}>
                    Company Name:
                  </Text>
                  <Text size="xs" fw={750} style={{ color: SA.accent }}>
                    {successResult.company.name}
                  </Text>
                </Group>
                <Group justify="space-between" mb={8}>
                  <Text size="xs" fw={700} style={{ color: SA.text }}>
                    Admin Account:
                  </Text>
                  <Text size="xs" style={{ color: SA.muted, fontFamily: "monospace" }}>
                    {successResult.adminUser.email}
                  </Text>
                </Group>
                <Group justify="space-between" mb={8}>
                  <Text size="xs" fw={700} style={{ color: SA.text }}>
                    Company ID:
                  </Text>
                  <Text size="xs" style={{ color: SA.muted, fontFamily: "monospace" }}>
                    {successResult.company.id}
                  </Text>
                </Group>
                <Group justify="space-between" mb={8}>
                  <Text size="xs" fw={700} style={{ color: SA.text }}>
                    Temporary Password:
                  </Text>
                  <Group gap={6}>
                    <Text size="xs" fw={700} style={{ color: SA.accent, fontFamily: "monospace" }}>
                      {form.adminPassword}
                    </Text>
                    <CopyButton value={form.adminPassword} timeout={2000}>
                      {({ copied, copy }) => (
                        <ActionIcon size="xs" variant="subtle" color="yellow" onClick={copy}>
                          {copied ? <Check size={12} /> : <Copy size={12} />}
                        </ActionIcon>
                      )}
                    </CopyButton>
                  </Group>
                </Group>
                <Group justify="space-between" mb={8}>
                  <Text size="xs" fw={700} style={{ color: SA.text }}>
                    Dedicated Domain:
                  </Text>
                  <Text size="xs" style={{ color: SA.accent, fontFamily: "monospace" }}>
                    {derivedSubdomain}.corbel.internal
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" fw={700} style={{ color: SA.text }}>
                    Subscription Tier:
                  </Text>
                  <Badge size="xs" color="orange" variant="light">
                    {selectedPkg?.name || "Active Tier"}
                  </Badge>
                </Group>
              </div>

              <CopyButton
                value={`=== CORBEL ENTERPRISE CREDENTIAL VOUCHER ===
Organization: ${successResult.company.name}
Company ID: ${successResult.company.id}
Admin Email: ${successResult.adminUser.email}
Temporary One-Time Password: ${form.adminPassword}
Subscription Tier: ${selectedPkg?.name || "Active Tier"}
First-Time Login Instruction:
1. Open Corbel ERP on your workstation.
2. Sign in with the Admin Email and Temporary Password above.
3. You will be required to set your permanent private password immediately.
==============================================`}
                timeout={2000}
              >
                {({ copied, copy }) => (
                  <Button
                    fullWidth
                    variant="light"
                    color="yellow"
                    mb="xs"
                    onClick={copy}
                    leftSection={copied ? <Check size={14} /> : <Copy size={14} />}
                  >
                    {copied ? "Credential Voucher Copied!" : "Copy Client Credential Voucher"}
                  </Button>
                )}
              </CopyButton>

              <Button
                fullWidth
                onClick={handleResetAndClose}
                styles={{
                  root: {
                    background: SA.accent,
                    color: "#FFFFFF",
                    fontWeight: 700,
                    borderRadius: 12,
                    height: 42,
                    boxShadow: "0 8px 20px -4px rgba(224, 114, 95, 0.35)",
                    "&:hover": { filter: "brightness(0.92)" },
                  },
                }}
              >
                Close & Return to Workspaces
              </Button>
            </div>
          </Stack>
        ) : (
          /* Provisioning Form */
          <form onSubmit={handleProvision}>
            <Stack gap="xl">
              {error && (
                <Alert
                  icon={<AlertCircle size={16} />}
                  color="red"
                  variant="light"
                  radius="md"
                  styles={{ root: { color: SA.danger } }}
                >
                  {error}
                </Alert>
              )}

              {/* 1. Company Identity & Domain */}
              <div
                style={{
                  padding: "20px 22px",
                  borderRadius: 18,
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                }}
              >
                <Group gap={10} mb="md">
                  <Building2 size={16} color={SA.accent} />
                  <Text fw={750} size="sm" style={{ color: SA.text }}>
                    Company & Enterprise Identity
                  </Text>
                </Group>

                <Stack gap="sm">
                  <TextInput
                    label="Official Company Name"
                    placeholder="e.g. Acme Textiles Ltd."
                    value={form.companyName}
                    onChange={(e) => setField("companyName", e.target.value)}
                    required
                    styles={{
                      input: {
                        background: SA.panelStrong,
                        border: `1px solid ${SA.border}`,
                        color: SA.text,
                        borderRadius: 10,
                      },
                    }}
                  />

                  {/* Derived Domain Pill */}
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: SA.panelStrong,
                      border: `1px solid ${SA.border}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Group gap={8}>
                      <Globe size={14} color={SA.muted} />
                      <Text size="xs" style={{ color: SA.muted }}>
                        Assigned Node Host:
                      </Text>
                    </Group>
                    <Text size="xs" fw={750} style={{ color: SA.accent, fontFamily: "monospace" }}>
                      {derivedSubdomain}.corbel.internal
                    </Text>
                  </div>

                  <SimpleGrid cols={2} spacing="sm">
                    <Select
                      label="Primary Currency"
                      data={CURRENCY_OPTIONS}
                      value={form.currencyCode}
                      onChange={(val) => setField("currencyCode", val || "PKR")}
                      styles={{
                        input: {
                          background: SA.panelStrong,
                          border: `1px solid ${SA.border}`,
                          color: SA.text,
                          borderRadius: 10,
                        },
                      }}
                    />
                    <Select
                      label="Operational Province"
                      data={PROVINCE_OPTIONS}
                      value={form.province}
                      onChange={(val) => setField("province", val || "Punjab")}
                      styles={{
                        input: {
                          background: SA.panelStrong,
                          border: `1px solid ${SA.border}`,
                          color: SA.text,
                          borderRadius: 10,
                        },
                      }}
                    />
                  </SimpleGrid>

                  <SimpleGrid cols={2} spacing="sm">
                    <TextInput
                      label="Contact Phone"
                      placeholder="+92 300 1234567"
                      value={form.phone}
                      onChange={(e) => setField("phone", e.target.value)}
                      styles={{
                        input: {
                          background: SA.panelStrong,
                          border: `1px solid ${SA.border}`,
                          color: SA.text,
                          borderRadius: 10,
                        },
                      }}
                    />
                    <TextInput
                      label="Physical Address / Branch"
                      placeholder="e.g. 14-B Gulberg III, Lahore"
                      value={form.address}
                      onChange={(e) => setField("address", e.target.value)}
                      styles={{
                        input: {
                          background: SA.panelStrong,
                          border: `1px solid ${SA.border}`,
                          color: SA.text,
                          borderRadius: 10,
                        },
                      }}
                    />
                  </SimpleGrid>
                </Stack>
              </div>

              {/* 2. Legal Entity & FBR Digital Fiscalization */}
              <div
                style={{
                  padding: "20px 22px",
                  borderRadius: 18,
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                }}
              >
                <Group gap={10} mb="md">
                  <Coins size={16} color={SA.accent} />
                  <Text fw={750} size="sm" style={{ color: SA.text }}>
                    Fiscal & Tax Registration (FBR Digital Ready)
                  </Text>
                </Group>

                <SimpleGrid cols={2} spacing="sm">
                  <TextInput
                    label="National Tax Number (NTN)"
                    placeholder="e.g. 1234567-8"
                    value={form.ntn}
                    onChange={(e) => setField("ntn", e.target.value)}
                    styles={{
                      input: {
                        background: SA.panelStrong,
                        border: `1px solid ${SA.border}`,
                        color: SA.text,
                        borderRadius: 10,
                      },
                    }}
                  />
                  <TextInput
                    label="Sales Tax Reg. Number (STRN)"
                    placeholder="e.g. 03-00-1234-567-89"
                    value={form.strn}
                    onChange={(e) => setField("strn", e.target.value)}
                    styles={{
                      input: {
                        background: SA.panelStrong,
                        border: `1px solid ${SA.border}`,
                        color: SA.text,
                        borderRadius: 10,
                      },
                    }}
                  />
                </SimpleGrid>
              </div>

              {/* 3. Root Administrator Account */}
              <div
                style={{
                  padding: "20px 22px",
                  borderRadius: 18,
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                }}
              >
                <Group gap={10} mb="md">
                  <User size={16} color={SA.accent} />
                  <Text fw={750} size="sm" style={{ color: SA.text }}>
                    Tenant Root Administrator Credentials
                  </Text>
                </Group>

                <Stack gap="sm">
                  <TextInput
                    label="Admin Full Name"
                    placeholder="e.g. Muhammad Bilal"
                    value={form.adminFullName}
                    onChange={(e) => setField("adminFullName", e.target.value)}
                    required
                    styles={{
                      input: {
                        background: SA.panelStrong,
                        border: `1px solid ${SA.border}`,
                        color: SA.text,
                        borderRadius: 10,
                      },
                    }}
                  />

                  <TextInput
                    label="Admin Email Address"
                    placeholder="e.g. admin@acmetextiles.pk"
                    type="email"
                    value={form.adminEmail}
                    onChange={(e) => setField("adminEmail", e.target.value)}
                    required
                    styles={{
                      input: {
                        background: SA.panelStrong,
                        border: `1px solid ${SA.border}`,
                        color: SA.text,
                        borderRadius: 10,
                      },
                    }}
                  />

                  <div>
                    <Group justify="space-between" mb={4}>
                      <Text size="xs" fw={500} style={{ color: SA.text }}>
                        Initial Master Password
                      </Text>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="yellow"
                        leftSection={<KeyRound size={12} />}
                        onClick={() => {
                          const otp = "Corbel-Temp-" + Math.random().toString(16).substring(2, 8).toUpperCase();
                          setField("adminPassword", otp);
                        }}
                      >
                        Auto-Generate OTP
                      </Button>
                    </Group>
                    <PasswordInput
                      placeholder="Min. 8 characters"
                      value={form.adminPassword}
                      onChange={(e) => setField("adminPassword", e.target.value)}
                      required
                      styles={{
                        input: {
                          background: SA.panelStrong,
                          border: `1px solid ${SA.border}`,
                          color: SA.text,
                          borderRadius: 10,
                        },
                      }}
                    />
                  </div>
                </Stack>
              </div>

              {/* 4. Subscription Package Selection */}
              <div
                style={{
                  padding: "20px 22px",
                  borderRadius: 18,
                  background: SA.panel,
                  border: `1px solid ${SA.border}`,
                }}
              >
                <Group justify="space-between" align="center" mb="md">
                  <Group gap={10}>
                    <Layers size={16} color={SA.accent} />
                    <Text fw={750} size="sm" style={{ color: SA.text }}>
                      Subscription Plan & Resource Quota
                    </Text>
                  </Group>
                  <Text size="xs" style={{ color: SA.muted }}>
                    {packages.length} Packages Available
                  </Text>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  {packages.map((pkg) => {
                    const isSelected = form.packageId === pkg.id;
                    return (
                      <UnstyledButton
                        key={pkg.id}
                        onClick={() => setField("packageId", pkg.id)}
                        style={{
                          padding: "16px",
                          borderRadius: 14,
                          background: isSelected ? `${SA.accent}14` : SA.panelStrong,
                          border: `2px solid ${isSelected ? SA.accent : SA.border}`,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          textAlign: "left",
                        }}
                      >
                        <Group justify="space-between" align="flex-start" mb={4}>
                          <Text fw={800} size="sm" style={{ color: isSelected ? SA.accent : SA.text }}>
                            {pkg.name}
                          </Text>
                          {isSelected && (
                            <div
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: "50%",
                                background: SA.accent,
                                color: "#FFFFFF",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Check size={12} strokeWidth={3} />
                            </div>
                          )}
                        </Group>

                        <Text fw={850} size="sm" style={{ color: SA.text, fontSize: 15, marginBottom: 8 }}>
                          PKR {pkg.price.toLocaleString()}{" "}
                          <span style={{ fontSize: 11, fontWeight: 500, color: SA.muted }}>
                            / {pkg.billingCycle || "month"}
                          </span>
                        </Text>

                        <Stack gap={4}>
                          <Text size="xs" style={{ color: SA.muted }}>
                            Users: {pkg.maxUsers || "Unlimited"}
                          </Text>
                          <Text size="xs" style={{ color: SA.muted }}>
                            Branches: {pkg.maxBranches || "Unlimited"}
                          </Text>
                        </Stack>
                      </UnstyledButton>
                    );
                  })}
                </SimpleGrid>
              </div>

              {/* Action Buttons */}
              <Group justify="flex-end" gap="sm" pb="xl">
                <Button
                  variant="subtle"
                  onClick={handleResetAndClose}
                  styles={{
                    root: {
                      color: SA.muted,
                      borderRadius: 10,
                      "&:hover": { background: SA.panelStrong, color: SA.text },
                    },
                  }}
                >
                  Cancel
                </Button>

                <Button
                  type="submit"
                  loading={provisioning}
                  leftSection={<Server size={16} />}
                  styles={{
                    root: {
                      background: SA.accent,
                      color: SA.accentOnAccent,
                      fontWeight: 750,
                      borderRadius: 12,
                      height: 44,
                      paddingInline: 24,
                      boxShadow: "0 4px 14px -2px rgba(194, 65, 12, 0.4)",
                      "&:hover": { background: SA.accentHover },
                    },
                  }}
                >
                  Provision Sovereign Tenant
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </ScrollArea>
    </Drawer>
  );
}
