// ==========================================
// SETTINGS PAGE
// ==========================================
//
// Tab 1: Company Profile
// Tab 2: Invoice Settings (FBR fields, numbering)
// Tab 3: Backup & Restore
// Tab 4: Audit Log

import { useCallback, useEffect, useState } from "react";

import {
  Badge,
  Button,
  Card,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  ScrollArea,
  NumberInput,
  Select,
  Alert,
} from "@mantine/core";

import { useForm } from "@mantine/form";

import {
  getCompany,
  updateCompany,
  getInvoiceSettings,
  updateInvoiceSettings,
  createBackup,
  restoreBackup,
  listAuditEntries,
  openFileDialog,
  saveFileDialog,
  getErrorMessage,
} from "../../api/backend";

import type { AuditEntry } from "../../api/backend";

import type { PublicUser } from "../../types/backend";

// ==========================================
// PROPS
// ==========================================

interface SettingsPageProps {
  user: PublicUser;
  onLogout: () => Promise<void>;
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function SettingsPage({ user, onLogout }: SettingsPageProps) {
  const canEdit = user.role === "owner";

  return (
    <Stack>
      <Title order={3}>Settings</Title>
      <Tabs defaultValue="company">
        <Tabs.List>
          <Tabs.Tab value="company">Company Profile</Tabs.Tab>
          <Tabs.Tab value="invoice">Invoice Settings</Tabs.Tab>
          <Tabs.Tab value="backup">Backup & Restore</Tabs.Tab>
          {canEdit && <Tabs.Tab value="audit">Audit Log</Tabs.Tab>}
        </Tabs.List>

        <Tabs.Panel value="company" pt="md">
          <CompanyProfileTab />
        </Tabs.Panel>
        <Tabs.Panel value="invoice" pt="md">
          <InvoiceSettingsTab />
        </Tabs.Panel>
        <Tabs.Panel value="backup" pt="md">
          <BackupRestoreTab onLogout={onLogout} />
        </Tabs.Panel>
        {canEdit && (
          <Tabs.Panel value="audit" pt="md">
            <AuditLogTab />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}

// ==========================================
// COMPANY PROFILE TAB
// ==========================================

function CompanyProfileTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
              data={["PKR", "USD", "EUR", "GBP", "AED", "SAR", "INR"]}
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
            <Button type="submit" loading={saving}>
              Save Changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

// ==========================================
// INVOICE SETTINGS TAB
// ==========================================

function InvoiceSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const form = useForm({
    initialValues: {
      companyNtn: "",
      companyStrn: "",
      companyCnic: "",
      invoicePrefix: "INV",
      nextNumber: 1,
      defaultDueDays: 30,
      invoiceFooter: "",
      termsConditions: "",
    },
  });

  useEffect(() => {
    getInvoiceSettings()
      .then((s) => {
        form.setValues({
          companyNtn: s.companyNtn ?? "",
          companyStrn: s.companyStrn ?? "",
          companyCnic: s.companyCnic ?? "",
          invoicePrefix: s.invoicePrefix,
          nextNumber: s.nextNumber,
          defaultDueDays: s.defaultDueDays,
          invoiceFooter: s.invoiceFooter ?? "",
          termsConditions: s.termsConditions ?? "",
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
      await updateInvoiceSettings(values);
      setSuccess("Invoice settings updated.");
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
        Invoice Settings
      </Title>
      <form onSubmit={form.onSubmit(handleSave)}>
        <Stack gap="md">
          <Title order={6}>FBR Tax Information</Title>
          <SimpleGrid cols={3}>
            <TextInput
              label="Company NTN"
              placeholder="1234567-8"
              {...form.getInputProps("companyNtn")}
            />
            <TextInput
              label="Company STRN"
              placeholder="STRN number"
              {...form.getInputProps("companyStrn")}
            />
            <TextInput
              label="Owner CNIC"
              placeholder="12345-1234567-1"
              {...form.getInputProps("companyCnic")}
            />
          </SimpleGrid>

          <Divider />
          <Title order={6}>Invoice Numbering</Title>
          <SimpleGrid cols={3}>
            <TextInput
              label="Prefix"
              placeholder="INV"
              {...form.getInputProps("invoicePrefix")}
            />
            <NumberInput
              label="Next Number"
              min={1}
              {...form.getInputProps("nextNumber")}
            />
            <NumberInput
              label="Default Due Days"
              min={1}
              {...form.getInputProps("defaultDueDays")}
            />
          </SimpleGrid>

          <Divider />
          <Title order={6}>Invoice Content</Title>
          <TextInput
            label="Footer Text"
            placeholder="Thank you for your business!"
            {...form.getInputProps("invoiceFooter")}
          />
          <TextInput
            label="Terms & Conditions"
            placeholder="Payment due within 30 days..."
            {...form.getInputProps("termsConditions")}
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
            <Button type="submit" loading={saving}>
              Save Settings
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

// ==========================================
// BACKUP & RESTORE TAB
// ==========================================

function BackupRestoreTab({ onLogout }: { onLogout: () => Promise<void> }) {
  const [backing, setBacking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleBackup() {
    setBacking(true);
    setError(null);
    setSuccess(null);
    try {
      const path = await saveFileDialog({
        title: "Save Backup",
        defaultPath: "ijazandcompany-backup.db",
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      });
      if (!path) {
        setBacking(false);
        return;
      }
      const result = await createBackup(path);
      setSuccess(`Backup saved to: ${result}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBacking(false);
    }
  }

  async function handleRestore() {
    setError(null);
    setSuccess(null);

    const path = await openFileDialog({
      title: "Select Backup File",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (typeof path !== "string" || !path) return;

    if (
      !confirm(
        "WARNING: This will replace your current database. A safety backup will be created automatically. Continue?",
      )
    ) {
      return;
    }

    setRestoring(true);
    try {
      const result = await restoreBackup(path);
      setSuccess(result);
      // App needs to restart after restore
      setTimeout(() => {
        onLogout();
      }, 3000);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Stack maw={600}>
      <Card withBorder padding="lg">
        <Title order={5} mb="md">
          💾 Backup
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          Save a copy of your database to a location of your choice (USB drive,
          cloud folder, external hard drive).
        </Text>
        <Button onClick={handleBackup} loading={backing}>
          Create Backup...
        </Button>
      </Card>

      <Card withBorder padding="lg" style={{ borderColor: "#fd7e14" }}>
        <Title order={5} mb="md">
          📥 Restore
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          Restore your database from a previous backup file. This will replace
          all current data. A safety backup of the current database is created
          automatically before restoring.
        </Text>
        <Alert color="orange" variant="light" mb="md">
          <Text size="sm" fw={500}>
            ⚠️ Restoring will replace all current data. The app will log you out
            and you'll need to restart.
          </Text>
        </Alert>
        <Button color="orange" onClick={handleRestore} loading={restoring}>
          Restore from Backup...
        </Button>
      </Card>

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

      <Card withBorder padding="lg">
        <Title order={5} mb="md">
          📁 Where is my data?
        </Title>
        <Text size="sm" c="dimmed">
          Your database is stored at:
        </Text>
        <Text size="sm" fw={500} ff="monospace" mt={4}>
          C:\Users\&lt;username&gt;\AppData\Roaming\com.ijazandcompany.erp\ijazandcompany-erp\ijazandcompany.db
        </Text>
        <Text size="sm" c="dimmed" mt="md">
          Backups are saved wherever you choose. We recommend backing up to a
          USB drive or cloud folder regularly.
        </Text>
      </Card>
    </Stack>
  );
}

// ==========================================
// AUDIT LOG TAB
// ==========================================

function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAuditEntries(pageSize, page * pageSize);
      setEntries(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const actionColors: Record<string, string> = {
    create: "green",
    update: "blue",
    delete: "red",
    finalize: "teal",
    import: "violet",
    login: "cyan",
    logout: "gray",
    backup: "yellow",
    restore: "orange",
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={5}>Audit Log</Title>
        <Group>
          <Button
            size="xs"
            variant="subtle"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            ← Previous
          </Button>
          <Text size="sm">Page {page + 1}</Text>
          <Button
            size="xs"
            variant="subtle"
            disabled={entries.length < pageSize}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </Button>
        </Group>
      </Group>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {loading ? (
        <Text c="dimmed">Loading...</Text>
      ) : entries.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          No audit entries yet.
        </Text>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Time</Table.Th>
                <Table.Th>User</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Resource</Table.Th>
                <Table.Th>Details</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>
                    <Text size="xs">{entry.createdAt}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.userEmail}</Text>
                    <Text size="xs" c="dimmed">
                      {entry.userRole}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={actionColors[entry.action] ?? "gray"}
                      variant="light"
                      size="sm"
                    >
                      {entry.action}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.resource}</Text>
                    {entry.resourceId && (
                      <Text size="xs" c="dimmed">
                        {entry.resourceId.slice(0, 8)}...
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" lineClamp={2}>
                      {entry.details ?? "—"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}
