import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  CopyButton,
  Drawer,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  AlertTriangle,
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  KeyRound,
  Laptop,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  getErrorMessage,
  saasExtendLicense,
  saasIssueLicense,
  saasListActiveDevices,
  saasListLicenses,
  saasRevokeDevice,
  saasRevokeLicense,
  saasUnblockDevice,
} from "../../api/backend";
import type {
  IssueLicenseInput,
  PublicDeviceActivation,
  PublicLicense,
} from "../../types/backend";
import { useSaTheme } from "./saTheme";

export default function FleetLicensingPage() {
  const SA = useSaTheme();

  // State
  const [licenses, setLicenses] = useState<PublicLicense[]>([]);
  const [devices, setDevices] = useState<PublicDeviceActivation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<string | null>("devices");

  // Issue License Drawer
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [licenseType, setLicenseType] = useState("beta_feedback");
  const [maxDevices, setMaxDevices] = useState(1);
  const [validityDays, setValidityDays] = useState<string>("14");
  const [notes, setNotes] = useState("");
  const [isIssuing, setIsIssuing] = useState(false);
  const [newlyIssuedLicense, setNewlyIssuedLicense] = useState<PublicLicense | null>(null);

  // Kill-Switch Modal
  const [selectedDeviceToBlock, setSelectedDeviceToBlock] = useState<PublicDeviceActivation | null>(null);
  const [blockReason, setBlockReason] = useState("Access suspended by administrator");
  const [isBlocking, setIsBlocking] = useState(false);

  // Revoke License Modal
  const [selectedLicenseToRevoke, setSelectedLicenseToRevoke] = useState<PublicLicense | null>(null);
  const [isRevokingLicense, setIsRevokingLicense] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [licList, devList] = await Promise.all([
        saasListLicenses(),
        saasListActiveDevices(),
      ]);
      setLicenses(licList);
      setDevices(devList);
    } catch (err) {
      console.error("Failed to load fleet licensing data", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleIssueLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) return;

    setIsIssuing(true);
    try {
      const days = validityDays === "perpetual" ? null : parseInt(validityDays, 10);
      const input: IssueLicenseInput = {
        clientName: clientName.trim(),
        licenseType,
        maxDevices,
        validityDays: days,
        offlineGraceDays: 7,
        notes: notes.trim() || undefined,
      };

      const issued = await saasIssueLicense(input);
      setNewlyIssuedLicense(issued);
      setLicenses((prev) => [issued, ...prev]);
      setClientName("");
      setNotes("");
    } catch (err) {
      alert("Failed to issue license: " + getErrorMessage(err));
    } finally {
      setIsIssuing(false);
    }
  };

  const handleConfirmBlockDevice = async () => {
    if (!selectedDeviceToBlock) return;
    setIsBlocking(true);
    try {
      await saasRevokeDevice(selectedDeviceToBlock.id, blockReason);
      setDevices((prev) =>
        prev.map((d) =>
          d.id === selectedDeviceToBlock.id
            ? { ...d, isBlocked: true, blockReason }
            : d
        )
      );
      setSelectedDeviceToBlock(null);
    } catch (err) {
      alert("Failed to block device: " + getErrorMessage(err));
    } finally {
      setIsBlocking(false);
    }
  };

  const handleUnblockDevice = async (device: PublicDeviceActivation) => {
    try {
      await saasUnblockDevice(device.id);
      setDevices((prev) =>
        prev.map((d) =>
          d.id === device.id ? { ...d, isBlocked: false, blockReason: null } : d
        )
      );
    } catch (err) {
      alert("Failed to unblock device: " + getErrorMessage(err));
    }
  };

  const handleExtendLicense = async (license: PublicLicense, days: number) => {
    try {
      await saasExtendLicense(license.id, days);
      await fetchData();
    } catch (err) {
      alert("Failed to extend license: " + getErrorMessage(err));
    }
  };

  const handleConfirmRevokeLicense = async () => {
    if (!selectedLicenseToRevoke) return;
    setIsRevokingLicense(true);
    try {
      await saasRevokeLicense(selectedLicenseToRevoke.id, "Revoked by Sovereign Admin");
      setSelectedLicenseToRevoke(null);
      await fetchData();
    } catch (err) {
      alert("Failed to revoke license: " + getErrorMessage(err));
    } finally {
      setIsRevokingLicense(false);
    }
  };

  // Metrics
  const totalLicenses = licenses.length;
  const activeNodesCount = devices.filter((d) => !d.isBlocked).length;
  const blockedNodesCount = devices.filter((d) => d.isBlocked).length;

  const filteredDevices = devices.filter((d) => {
    const q = searchQuery.toLowerCase();
    return (
      d.deviceHwid.toLowerCase().includes(q) ||
      d.deviceName.toLowerCase().includes(q) ||
      d.osInfo.toLowerCase().includes(q)
    );
  });

  const filteredLicenses = licenses.filter((l) => {
    const q = searchQuery.toLowerCase();
    return (
      l.licenseKey.toLowerCase().includes(q) ||
      l.clientName.toLowerCase().includes(q) ||
      l.licenseType.toLowerCase().includes(q)
    );
  });

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1720,
        margin: "0 auto",
        padding: "clamp(16px, 2.2vw, 28px)",
        color: SA.text,
        minHeight: "calc(100dvh - 76px)",
      }}
    >
      {/* Top Header */}
      <Group justify="space-between" align="center" mb="lg">
        <div>
          <Title order={2} style={{ color: SA.text, letterSpacing: -0.5 }}>
            Fleet Licensing & Hardware Governance
          </Title>
          <Text size="sm" c="dimmed">
            Hardware-bound binary activation gates, remote kill-switches, and offline lease quotas
          </Text>
        </div>
        <Group>
          <Button
            variant="default"
            leftSection={<RefreshCw size={14} />}
            onClick={fetchData}
            loading={isLoading}
            style={{ borderColor: SA.border, background: SA.panel, color: SA.text }}
          >
            Sync Control Plane
          </Button>
          <Button
            leftSection={<Plus size={16} />}
            onClick={() => {
              setNewlyIssuedLicense(null);
              setIsDrawerOpen(true);
            }}
            style={{
              backgroundColor: SA.accent,
              color: SA.accentOnAccent,
              fontWeight: 750,
              boxShadow: "0 2px 8px -1px rgba(194, 65, 12, 0.35)",
            }}
          >
            Issue Activation Key
          </Button>
        </Group>
      </Group>

      {/* Metric Cards */}
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} mb="xl">
        <Card p="md" radius="md" style={{ background: SA.panel, border: `1px solid ${SA.border}` }}>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Issued Licenses
              </Text>
              <Title order={2} mt={4} style={{ color: SA.text }}>
                {totalLicenses}
              </Title>
              <Text size="xs" c="dimmed" mt={2}>
                Total distributed contracts
              </Text>
            </div>
            <ActionIcon variant="light" color="orange" radius="md" size="lg">
              <KeyRound size={20} />
            </ActionIcon>
          </Group>
        </Card>

        <Card p="md" radius="md" style={{ background: SA.panel, border: `1px solid ${SA.border}` }}>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Active Hardware Nodes
              </Text>
              <Title order={2} mt={4} style={{ color: SA.accent }}>
                {activeNodesCount}
              </Title>
              <Text size="xs" c="dimmed" mt={2}>
                Verified physical machines
              </Text>
            </div>
            <ActionIcon variant="light" color="teal" radius="md" size="lg">
              <Cpu size={20} />
            </ActionIcon>
          </Group>
        </Card>

        <Card p="md" radius="md" style={{ background: SA.panel, border: `1px solid ${SA.border}` }}>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Kill-Switched Nodes
              </Text>
              <Title order={2} mt={4} style={{ color: blockedNodesCount > 0 ? "#ef4444" : SA.textSoft }}>
                {blockedNodesCount}
              </Title>
              <Text size="xs" c="dimmed" mt={2}>
                Remotely revoked machines
              </Text>
            </div>
            <ActionIcon variant="light" color="red" radius="md" size="lg">
              <Ban size={20} />
            </ActionIcon>
          </Group>
        </Card>

        <Card p="md" radius="md" style={{ background: SA.panel, border: `1px solid ${SA.border}` }}>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Offline Lease Window
              </Text>
              <Title order={2} mt={4} style={{ color: SA.text }}>
                7 Days
              </Title>
              <Text size="xs" c="dimmed" mt={2}>
                Tamper-resistant POS counter grace
              </Text>
            </div>
            <ActionIcon variant="light" color="gray" radius="md" size="lg">
              <Clock size={20} />
            </ActionIcon>
          </Group>
        </Card>
      </SimpleGrid>

      {/* Search and Tabs */}
      <Card p="lg" radius="md" style={{ background: SA.panel, border: `1px solid ${SA.border}` }}>
        <Tabs value={activeTab} onChange={setActiveTab}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 14,
              borderBottom: `1px solid ${SA.border}`,
              paddingBottom: 14,
              marginBottom: 16,
            }}
          >
            <Tabs.List style={{ borderBottom: "none" }}>
              <Tabs.Tab value="devices" leftSection={<Cpu size={14} />}>
                Connected Hardware ({devices.length})
              </Tabs.Tab>
              <Tabs.Tab value="licenses" leftSection={<KeyRound size={14} />}>
                License Contracts ({licenses.length})
              </Tabs.Tab>
            </Tabs.List>

            <TextInput
              placeholder="Search HWID, machine hostname, or client..."
              leftSection={<Search size={15} />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              style={{ minWidth: 260, maxWidth: 380, flex: 1 }}
              styles={{
                input: {
                  background: SA.panelStrong,
                  borderColor: SA.border,
                  color: SA.text,
                  height: 38,
                },
              }}
            />
          </div>

          {isLoading ? (
            <Group justify="center" py="xl">
              <Loader size="sm" color={SA.accent} />
              <Text size="sm" c="dimmed">
                Synchronizing fleet state with Neon Control Plane...
              </Text>
            </Group>
          ) : activeTab === "devices" ? (
            /* TAB 1: FLEET HARDWARE NODES */
            filteredDevices.length === 0 ? (
              <Stack align="center" py="xl" gap="xs">
                <Laptop size={36} color={SA.muted} />
                <Text size="sm" fw={500} style={{ color: SA.text }}>
                  No active physical devices registered yet
                </Text>
                <Text size="xs" c="dimmed">
                  When clients run your distributed binaries and activate them, their hardware fingerprints will appear here.
                </Text>
              </Stack>
            ) : (
              <div className="sa-table-scroll">
                <Table highlightOnHover verticalSpacing="sm" style={{ color: SA.text, minWidth: 780 }}>
                  <Table.Thead>
                    <Table.Tr style={{ borderColor: SA.border }}>
                      <Table.Th>Workstation Hostname</Table.Th>
                      <Table.Th>Hardware ID (HWID)</Table.Th>
                      <Table.Th>OS & Version</Table.Th>
                      <Table.Th>Last Heartbeat</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th style={{ textAlign: "right" }}>Kill-Switch</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
              <Table.Tbody>
                {filteredDevices.map((dev) => (
                  <Table.Tr key={dev.id} style={{ borderColor: SA.border }}>
                    <Table.Td>
                      <Group gap="xs">
                        <Laptop size={16} color={dev.isBlocked ? "#ef4444" : SA.accent} />
                        <div>
                          <Text size="sm" fw={600} style={{ color: SA.text }}>
                            {dev.deviceName}
                          </Text>
                          {dev.blockReason && (
                            <Text size="xs" c="red">
                              {dev.blockReason}
                            </Text>
                          )}
                        </div>
                      </Group>
                    </Table.Td>

                    <Table.Td>
                      <Group gap={6}>
                        <Text size="xs" ff="monospace" style={{ color: SA.textSoft }}>
                          {dev.deviceHwid}
                        </Text>
                        <CopyButton value={dev.deviceHwid} timeout={2000}>
                          {({ copied, copy }) => (
                            <Tooltip label={copied ? "Copied" : "Copy HWID"}>
                              <ActionIcon size="xs" variant="subtle" onClick={copy}>
                                {copied ? <Check size={12} color="teal" /> : <Copy size={12} />}
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </CopyButton>
                      </Group>
                    </Table.Td>

                    <Table.Td>
                      <Text size="xs" style={{ color: SA.textSoft }}>
                        {dev.osInfo} • v{dev.appVersion}
                      </Text>
                    </Table.Td>

                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {dev.lastHeartbeatAt ? new Date(dev.lastHeartbeatAt).toLocaleString() : "Never"}
                      </Text>
                    </Table.Td>

                    <Table.Td>
                      {dev.isBlocked ? (
                        <Badge color="red" variant="filled" size="sm">
                          REVOKED (BLOCKED)
                        </Badge>
                      ) : (
                        <Badge color="teal" variant="light" size="sm">
                          AUTHORIZED
                        </Badge>
                      )}
                    </Table.Td>

                    <Table.Td style={{ textAlign: "right" }}>
                      {dev.isBlocked ? (
                        <Button
                          size="xs"
                          variant="light"
                          color="teal"
                          leftSection={<ShieldCheck size={13} />}
                          onClick={() => handleUnblockDevice(dev)}
                        >
                          Unblock Node
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          leftSection={<Ban size={13} />}
                          onClick={() => {
                            setSelectedDeviceToBlock(dev);
                            setBlockReason("Access suspended by administrator");
                          }}
                        >
                          Kill-Switch (Block)
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        )
      ) : (
        /* TAB 2: ISSUED LICENSE KEYS */
        filteredLicenses.length === 0 ? (
          <Stack align="center" py="xl" gap="xs">
            <KeyRound size={36} color={SA.muted} />
            <Text size="sm" fw={500} style={{ color: SA.text }}>
              No licenses found
            </Text>
            <Text size="xs" c="dimmed">
              Issue a license key above to authorize testing or commercial binaries.
            </Text>
          </Stack>
        ) : (
          <div className="sa-table-scroll">
            <Table highlightOnHover verticalSpacing="sm" style={{ color: SA.text, minWidth: 840 }}>
              <Table.Thead>
                <Table.Tr style={{ borderColor: SA.border }}>
                  <Table.Th>License Key</Table.Th>
                  <Table.Th>Client / Tester</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Devices</Table.Th>
                  <Table.Th>Expiry</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredLicenses.map((lic) => (
                  <Table.Tr key={lic.id} style={{ borderColor: SA.border }}>
                    <Table.Td>
                      <Group gap={6}>
                        <Text size="xs" fw={700} ff="monospace" style={{ color: SA.accent }}>
                          {lic.licenseKey}
                        </Text>
                        <CopyButton value={lic.licenseKey} timeout={2000}>
                          {({ copied, copy }) => (
                            <Tooltip label={copied ? "Copied" : "Copy Key"}>
                              <ActionIcon size="xs" variant="subtle" onClick={copy}>
                                {copied ? <Check size={12} color="teal" /> : <Copy size={12} />}
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </CopyButton>
                      </Group>
                    </Table.Td>

                    <Table.Td>
                      <Text size="sm" fw={600} style={{ color: SA.text }}>
                        {lic.clientName}
                      </Text>
                      {lic.notes && (
                        <Text size="xs" c="dimmed">
                          {lic.notes}
                        </Text>
                      )}
                    </Table.Td>

                    <Table.Td>
                      <Badge variant="outline" color="orange" size="sm">
                        {lic.licenseType.replace("_", " ")}
                      </Badge>
                    </Table.Td>

                    <Table.Td>
                      <Text size="xs" style={{ color: SA.textSoft }}>
                        {lic.activeDevicesCount} / {lic.maxDevices} Active
                      </Text>
                    </Table.Td>

                    <Table.Td>
                      <Text size="xs" style={{ color: SA.textSoft }}>
                        {lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString() : "Perpetual"}
                      </Text>
                    </Table.Td>

                    <Table.Td>
                      {lic.status === "active" ? (
                        <Badge color="teal" size="sm">ACTIVE</Badge>
                      ) : (
                        <Badge color="red" size="sm">{lic.status.toUpperCase()}</Badge>
                      )}
                    </Table.Td>

                    <Table.Td style={{ textAlign: "right" }}>
                      <Group gap="xs" justify="flex-end">
                        <Button
                          size="xs"
                          variant="subtle"
                          color="orange"
                          leftSection={<Calendar size={13} />}
                          onClick={() => handleExtendLicense(lic, 14)}
                        >
                          +14 Days
                        </Button>
                        {lic.status === "active" && (
                          <Button
                            size="xs"
                            variant="subtle"
                            color="red"
                            leftSection={<Ban size={13} />}
                            onClick={() => setSelectedLicenseToRevoke(lic)}
                          >
                            Revoke
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
          )
        )}
        </Tabs>
      </Card>

      {/* ISSUE LICENSE DRAWER */}
      <Drawer
        opened={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Issue Sovereign Activation Key"
        position="right"
        size="md"
        styles={{
          header: { background: SA.panel, color: SA.text, borderBottom: `1px solid ${SA.border}` },
          content: { background: SA.bg, color: SA.text },
        }}
      >
        <Stack gap="md">
          {newlyIssuedLicense ? (
            <Card p="md" radius="md" style={{ background: "rgba(224, 114, 95, 0.15)", border: `1px solid ${SA.accent}` }}>
              <Stack gap="sm">
                <Group gap="xs">
                  <CheckCircle2 size={18} color={SA.accent} />
                  <Text size="sm" fw={600} style={{ color: SA.accent }}>
                    License Issued Successfully!
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  Send this key to your client/tester. When entered into Corbel ERP, it will bind permanently to their computer:
                </Text>

                <Group justify="space-between" p="xs" style={{ background: SA.panel, borderRadius: 6 }}>
                  <Text size="sm" ff="monospace" fw={700} style={{ color: SA.text }}>
                    {newlyIssuedLicense.licenseKey}
                  </Text>
                  <CopyButton
                    value={`Corbel ERP Activation Key: ${newlyIssuedLicense.licenseKey}\nClient: ${newlyIssuedLicense.clientName}\nValid For: 1 Device (${newlyIssuedLicense.licenseType})`}
                    timeout={2000}
                  >
                    {({ copied, copy }) => (
                      <Button size="xs" variant="light" color={copied ? "teal" : "orange"} onClick={copy} leftSection={copied ? <Check size={12} /> : <Copy size={12} />}>
                        {copied ? "Copied WhatsApp Text" : "Copy Formatted Key"}
                      </Button>
                    )}
                  </CopyButton>
                </Group>

                <Button
                  variant="default"
                  size="xs"
                  mt="xs"
                  onClick={() => setNewlyIssuedLicense(null)}
                >
                  Issue Another Key
                </Button>
              </Stack>
            </Card>
          ) : (
            <form onSubmit={handleIssueLicense}>
              <Stack gap="md">
                <TextInput
                  label="Client / Evaluator Name"
                  placeholder="e.g. Bilal Textiles - Beta Test"
                  value={clientName}
                  onChange={(e) => setClientName(e.currentTarget.value)}
                  required
                  styles={{
                    input: { background: SA.panel, borderColor: SA.border, color: SA.text },
                    label: { color: SA.text, fontSize: "0.85rem", fontWeight: 500 },
                  }}
                />

                <Select
                  label="License Agreement Type"
                  data={[
                    { value: "beta_feedback", label: "Beta Testing / Feedback (Evaluation)" },
                    { value: "trial", label: "Standard Commercial Trial" },
                    { value: "commercial", label: "Commercial Production License" },
                    { value: "perpetual", label: "Perpetual / Internal Studio Node" },
                  ]}
                  value={licenseType}
                  onChange={(val) => setLicenseType(val || "beta_feedback")}
                  styles={{
                    input: { background: SA.panel, borderColor: SA.border, color: SA.text },
                    label: { color: SA.text, fontSize: "0.85rem", fontWeight: 500 },
                  }}
                />

                <NumberInput
                  label="Hardware Machine Quota"
                  description="Maximum physical computers that can activate this key"
                  min={1}
                  max={50}
                  value={maxDevices}
                  onChange={(val) => setMaxDevices(typeof val === "number" ? val : 1)}
                  styles={{
                    input: { background: SA.panel, borderColor: SA.border, color: SA.text },
                    label: { color: SA.text, fontSize: "0.85rem", fontWeight: 500 },
                    description: { color: SA.textSoft, fontSize: "0.75rem" },
                  }}
                />

                <Select
                  label="Evaluation Validity Duration"
                  data={[
                    { value: "14", label: "14 Days (Standard Beta Period)" },
                    { value: "30", label: "30 Days (Extended Trial)" },
                    { value: "90", label: "90 Days (Quarterly)" },
                    { value: "365", label: "1 Year Commercial" },
                    { value: "perpetual", label: "Perpetual (No Expiry Date)" },
                  ]}
                  value={validityDays}
                  onChange={(val) => setValidityDays(val || "14")}
                  styles={{
                    input: { background: SA.panel, borderColor: SA.border, color: SA.text },
                    label: { color: SA.text, fontSize: "0.85rem", fontWeight: 500 },
                  }}
                />

                <TextInput
                  label="Offline Grace Window"
                  value="7 Days (Confirmed POS Counter Grace)"
                  disabled
                  styles={{
                    input: { background: SA.panelStrong, borderColor: SA.border, color: SA.textSoft },
                    label: { color: SA.text, fontSize: "0.85rem", fontWeight: 500 },
                  }}
                />

                <Textarea
                  label="Internal Reference Notes"
                  placeholder="e.g. Sent via WhatsApp to Tariq on Oct 6 for testing POS receipt flow"
                  value={notes}
                  onChange={(e) => setNotes(e.currentTarget.value)}
                  rows={3}
                  styles={{
                    input: { background: SA.panel, borderColor: SA.border, color: SA.text },
                    label: { color: SA.text, fontSize: "0.85rem", fontWeight: 500 },
                  }}
                />

                <Button
                  type="submit"
                  fullWidth
                  loading={isIssuing}
                  leftSection={<Sparkles size={16} />}
                  style={{ backgroundColor: SA.accent, color: "#fff", height: 42, marginTop: 8 }}
                >
                  Generate & Activate Key
                </Button>
              </Stack>
            </form>
          )}
        </Stack>
      </Drawer>

      {/* KILL-SWITCH CONFIRMATION MODAL */}
      <Modal
        opened={!!selectedDeviceToBlock}
        onClose={() => setSelectedDeviceToBlock(null)}
        title="Execute Remote Kill-Switch"
        styles={{
          header: { background: SA.panel, color: SA.text },
          content: { background: SA.bg, color: SA.text },
        }}
      >
        <Stack gap="md">
          <Group gap="sm" align="flex-start">
            <AlertTriangle size={24} color="#ef4444" style={{ flexShrink: 0 }} />
            <div>
              <Text size="sm" fw={600} style={{ color: SA.text }}>
                Block Node: {selectedDeviceToBlock?.deviceName}?
              </Text>
              <Text size="xs" c="dimmed" mt={2}>
                HWID: {selectedDeviceToBlock?.deviceHwid}
              </Text>
            </div>
          </Group>

          <Text size="xs" style={{ color: SA.textSoft, lineHeight: 1.5 }}>
            This immediately marks this physical machine as <strong>BLOCKED</strong> in the cloud control plane.
            On the next startup or background heartbeat check, Corbel ERP will lock down on their machine. Customer business data remains safe, but all app interactions will halt.
          </Text>

          <TextInput
            label="Lockout Reason"
            value={blockReason}
            onChange={(e) => setBlockReason(e.currentTarget.value)}
            styles={{
              input: { background: SA.panel, borderColor: SA.border, color: SA.text },
              label: { color: SA.text, fontSize: "0.85rem" },
            }}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setSelectedDeviceToBlock(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={handleConfirmBlockDevice}
              loading={isBlocking}
              leftSection={<Ban size={15} />}
            >
              Trigger Kill-Switch
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* REVOKE ENTIRE LICENSE MODAL */}
      <Modal
        opened={!!selectedLicenseToRevoke}
        onClose={() => setSelectedLicenseToRevoke(null)}
        title="Revoke License Key"
        styles={{
          header: { background: SA.panel, color: SA.text },
          content: { background: SA.bg, color: SA.text },
        }}
      >
        <Stack gap="md">
          <Text size="sm" style={{ color: SA.text }}>
            Are you sure you want to revoke key <strong>{selectedLicenseToRevoke?.licenseKey}</strong> ({selectedLicenseToRevoke?.clientName})?
          </Text>
          <Text size="xs" c="dimmed">
            This will immediately lock out ALL physical machines activated under this key.
          </Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setSelectedLicenseToRevoke(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={handleConfirmRevokeLicense}
              loading={isRevokingLicense}
            >
              Revoke Entire License
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
