import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Divider,
  Group,
  List,
  Loader,
  Modal,
  PasswordInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Switch,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  RefreshCw,
  Send,
  Settings,
  XCircle,
  Zap,
} from "lucide-react";
import {
  getCompany,
  getErrorMessage,
  getFbrConfig,
  getFbrQueueStatus,
  processFbrQueueNow,
  retryFbrSubmission,
  saveFbrConfig,
  testFbrConnection,
} from "../../../api/backend";
import type {
  FbrConfig,
  FbrConnectionTestResult,
  FbrQueueStatus,
  PublicCompany,
} from "../../../types/backend";

export function FbrSettingsTab() {
  const [config, setConfig] = useState<FbrConfig | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [isActive, setIsActive] = useState(false);
  const [environment, setEnvironment] = useState("sandbox");
  const [pralToken, setPralToken] = useState("");

  const [queueStatus, setQueueStatus] = useState<FbrQueueStatus | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [processingQueue, setProcessingQueue] = useState(false);

  const [wizardOpened, setWizardOpened] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizEnvironment, setWizEnvironment] = useState("sandbox");
  const [wizToken, setWizToken] = useState("");
  const [wizSaving, setWizSaving] = useState(false);
  const [wizTesting, setWizTesting] = useState(false);
  const [wizTestResult, setWizTestResult] = useState<FbrConnectionTestResult | null>(null);

  const isConnected = Boolean(config?.pralToken && config?.isActive);
  const lastTestOk = config?.lastTestResult === "success";

  const loadConfig = useCallback(async () => {
    try {
      const [c, co] = await Promise.all([getFbrConfig(), getCompany()]);
      if (c) {
        setConfig(c);
        setEnvironment(c.environment);
        setPralToken(c.pralToken ?? "");
        setIsActive(c.isActive);
        setCompany(co);
      } else {
        setCompany(co);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      setQueueLoading(true);
      const qs = await getFbrQueueStatus();
      setQueueStatus(qs);
    } catch {
      // Queue load failure is non-critical
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadQueue();
  }, [loadConfig, loadQueue]);

  const handleToggleActive = async (checked: boolean) => {
    if (checked && !config?.pralToken) {
      setWizardOpened(true);
      return;
    }
    setError(null);
    try {
      const updated = await saveFbrConfig(environment, checked, pralToken || null);
      setConfig(updated);
      setIsActive(updated.isActive);
      setSuccess(checked ? "FBR submission enabled." : "FBR submission paused.");
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleProcessQueue = async () => {
    setProcessingQueue(true);
    setError(null);
    try {
      const processed = await processFbrQueueNow();
      setSuccess(`Processed ${processed} queued invoice(s).`);
      await loadQueue();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setProcessingQueue(false);
    }
  };

  const handleRetry = async (queueId: string) => {
    try {
      await retryFbrSubmission(queueId);
      setSuccess("Submission queued for retry.");
      await loadQueue();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  // --- Wizard handlers ---
  const openWizard = () => {
    setWizardStep(0);
    setWizEnvironment(config?.environment ?? "sandbox");
    setWizToken(config?.pralToken ?? "");
    setWizTestResult(null);
    setError(null);
    setWizardOpened(true);
  };

  const handleWizardSaveAndTest = async () => {
    setWizSaving(true);
    setError(null);
    try {
      const updated = await saveFbrConfig(wizEnvironment, true, wizToken || null);
      setConfig(updated);
      setEnvironment(updated.environment);
      setPralToken(updated.pralToken ?? "");
      setIsActive(true);
      setWizSaving(false);
      setWizardStep(2);
    } catch (e) {
      setError(getErrorMessage(e));
      setWizSaving(false);
    }
  };

  const handleWizardTest = async () => {
    setWizTesting(true);
    setWizTestResult(null);
    try {
      const result = await testFbrConnection();
      setWizTestResult(result);
      const updated = await getFbrConfig();
      if (updated) setConfig(updated);
    } catch (e) {
      setWizTestResult({
        success: false,
        message: getErrorMessage(e),
        timestamp: new Date().toISOString(),
      });
    } finally {
      setWizTesting(false);
    }
  };

  const handleWizardFinish = () => {
    setWizardOpened(false);
    if (wizTestResult?.success) {
      setSuccess("FBR connection configured and verified.");
    }
  };

  if (loading) {
    return <Text c="dimmed">Loading FBR configuration...</Text>;
  }

  const isProduction = (config?.environment ?? environment) === "production";
  const canGoProduction = isConnected && lastTestOk && !isProduction;

  return (
    <>
      <Stack gap="lg">
        {/* ---- Connection status card ---- */}
        <Card withBorder padding="lg" maw={700}>
          <Group gap="sm" mb="sm">
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 12,
                background: isConnected
                  ? "linear-gradient(135deg, #2B8A3E 0%, #40C057 100%)"
                  : "var(--app-accent-gradient)",
                color: isConnected ? "#fff" : "var(--app-on-accent, #0A0A0C)",
              }}
            >
              {isConnected ? <CheckCircle size={18} /> : <Send size={18} />}
            </span>
            <Title order={5}>FBR Digital Invoicing</Title>
          </Group>
          <Text size="sm" c="dimmed" mb="lg">
            Your ERP can automatically submit finalized sales invoices to FBR.
            {isConnected
              ? " Your connection is active."
              : " Connect your business to get started."}
          </Text>

          <Card
            withBorder
            padding="md"
            style={{
              borderColor: isConnected ? "var(--mantine-color-green-4)" : undefined,
              background: isConnected ? "var(--mantine-color-green-0)" : undefined,
            }}
          >
            <Group justify="space-between" wrap="nowrap">
              <Group gap="md" wrap="nowrap">
                <ThemeIcon
                  size={42}
                  radius="xl"
                  variant="light"
                  color={isConnected ? "green" : "yellow"}
                >
                  {isConnected ? <CheckCircle size={20} /> : <XCircle size={20} />}
                </ThemeIcon>
                <Box>
                  <Text fw={600} size="sm">
                    {isConnected ? "Connected" : "Not Connected"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {isConnected
                      ? `Environment: ${config?.environment === "production" ? "Production" : "Sandbox"}`
                      : "Configure your FBR integration to start submitting invoices."}
                    {config?.lastTestedAt && isConnected && (
                      <> · Last tested: {new Date(config.lastTestedAt).toLocaleDateString()}</>
                    )}
                  </Text>
                </Box>
              </Group>
              <Button
                variant={isConnected ? "light" : "filled"}
                color={isConnected ? "gray" : "green"}
                size="sm"
                onClick={openWizard}
                leftSection={<Settings size={14} />}
              >
                {isConnected ? "Manage Connection" : "Connect FBR"}
              </Button>
            </Group>
          </Card>

          {/* Automatic submission toggle */}
          <Box mt="lg">
            <Group justify="space-between" align="center">
              <Box>
                <Text fw={500} size="sm">Automatic Submission</Text>
                <Text size="xs" c="dimmed">
                  {isConnected
                    ? "Finalized invoices will be automatically queued for FBR submission."
                    : "Connect to FBR first, then enable automatic submission."}
                </Text>
              </Box>
              <Switch
                checked={isActive}
                disabled={!isConnected}
                onChange={(e) => void handleToggleActive(e.currentTarget.checked)}
                size="lg"
              />
            </Group>
          </Box>

          {/* Environment indicator */}
          {isProduction && (
            <Alert color="orange" mt="md" variant="light" title="Production Environment">
              <Text size="sm">
                Invoices are submitted to FBR's live production system.
                All submissions are final and legally binding.
              </Text>
            </Alert>
          )}

          {/* Errors / Success */}
          {error && (
            <Alert color="red" title="Error" variant="light" mt="md">
              {error}
            </Alert>
          )}
          {success && (
            <Alert color="green" title="Success" variant="light" mt="md" onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}
        </Card>

        {/* ---- Queue card ---- */}
        <Card withBorder padding="lg" maw={700}>
          <Group gap="sm" mb="sm">
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 12,
                background: "var(--app-accent-gradient)",
                color: "var(--app-on-accent, #0A0A0C)",
              }}
            >
              <AlertTriangle size={18} />
            </span>
            <Title order={5}>Submission Queue</Title>
          </Group>
          <Text size="sm" c="dimmed" mb="md">
            Invoices are submitted asynchronously. Failed submissions are retried
            with exponential backoff (2m → 10m → 30m → 2h) and moved to dead
            letter after 5 attempts.
          </Text>

          {queueLoading ? (
            <Group gap="sm">
              <Loader size="sm" />
              <Text c="dimmed" size="sm">Loading queue...</Text>
            </Group>
          ) : queueStatus ? (
            <Stack gap="md">
              <SimpleGrid cols={4}>
                <Card padding="sm" withBorder>
                  <Text size="xs" c="dimmed">Queued</Text>
                  <Title order={4}>{queueStatus.queued}</Title>
                </Card>
                <Card padding="sm" withBorder>
                  <Text size="xs" c="dimmed">Submitting</Text>
                  <Title order={4} c="blue">{queueStatus.submitting}</Title>
                </Card>
                <Card padding="sm" withBorder>
                  <Text size="xs" c="dimmed">Failed</Text>
                  <Title order={4} c="orange">{queueStatus.failed}</Title>
                </Card>
                <Card padding="sm" withBorder>
                  <Text size="xs" c="dimmed">Dead</Text>
                  <Title order={4} c="red">{queueStatus.dead}</Title>
                </Card>
              </SimpleGrid>

              {queueStatus.items.length > 0 && (
                <ScrollArea>
                  <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Invoice</Table.Th>
                        <Table.Th>Type</Table.Th>
                        <Table.Th>Status</Table.Th>
                        <Table.Th>Attempts</Table.Th>
                        <Table.Th>IRN</Table.Th>
                        <Table.Th>Error</Table.Th>
                        <Table.Th>Action</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {queueStatus.items.map((item) => (
                        <Table.Tr key={item.id}>
                          <Table.Td>
                            <Text size="sm" fw={500}>
                              {item.invoiceId.slice(0, 8)}...
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="sm" variant="light">
                              {item.invoiceType}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Badge
                              size="sm"
                              color={
                                item.status === "validated"
                                  ? "green"
                                  : item.status === "failed"
                                  ? "orange"
                                  : item.status === "dead"
                                  ? "red"
                                  : "blue"
                              }
                              variant="light"
                            >
                              {item.status}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">
                              {item.attemptCount}/{item.maxAttempts}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" style={{ fontFamily: "monospace" }}>
                              {item.irn ?? "—"}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed" lineClamp={1} maw={150}>
                              {item.lastError ?? "—"}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            {(item.status === "failed" || item.status === "dead") && (
                              <Tooltip label="Retry submission">
                                <ActionIcon
                                  size="sm"
                                  variant="light"
                                  color="blue"
                                  onClick={() => void handleRetry(item.id)}
                                >
                                  <RefreshCw size={12} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}

              {queueStatus.items.length === 0 && (
                <Text c="dimmed" ta="center" py="md">
                  No submissions in queue.
                </Text>
              )}

              <Group justify="flex-end">
                <Button
                  variant="light"
                  loading={processingQueue}
                  onClick={() => void handleProcessQueue()}
                  leftSection={<Send size={14} />}
                >
                  Process Queue Now
                </Button>
              </Group>
            </Stack>
          ) : (
            <Text c="dimmed">No queue data available.</Text>
          )}
        </Card>
      </Stack>

      {/* ========================================== */}
      {/* MANAGE CONNECTION WIZARD                   */}
      {/* ========================================== */}
      <Modal
        opened={wizardOpened}
        onClose={() => setWizardOpened(false)}
        title="Connect FBR Digital Invoicing"
        size="lg"
        closeOnClickOutside={wizardStep === 0}
      >
        <Stepper active={wizardStep} onStepClick={setWizardStep} size="sm">
          {/* Step 0: Business info */}
          <Stepper.Step label="Business Info" description="Verify your details">
            <Stack gap="md" mt="md">
              <Text size="sm" c="dimmed">
                Your ERP will use these details when submitting invoices to FBR.
                They are taken from your Company Profile.
              </Text>

              <Card withBorder padding="md">
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Business Name</Text>
                    <Text size="sm" fw={500}>{company?.name ?? "—"}</Text>
                  </Group>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">NTN</Text>
                    <Text size="sm" fw={500} style={{ fontFamily: "monospace" }}>
                      {company?.ntn ?? company?.taxNumber ?? "—"}
                    </Text>
                  </Group>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">STRN</Text>
                    <Text size="sm" fw={500} style={{ fontFamily: "monospace" }}>
                      {company?.strn ?? "—"}
                    </Text>
                  </Group>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Province</Text>
                    <Text size="sm" fw={500}>{company?.province ?? "—"}</Text>
                  </Group>
                </Stack>
              </Card>

              <Alert color="blue" variant="light" title="FBR Integration">
                <Text size="sm">
                  FBR Digital Invoicing requires your business to be registered
                  with FBR. If your NTN/STRN are missing, update your Company
                  Profile first.
                </Text>
              </Alert>

              <Group justify="flex-end">
                <Button
                  rightSection={<ArrowRight size={14} />}
                  onClick={() => setWizardStep(1)}
                >
                  Continue
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>

          {/* Step 1: Environment + Token */}
          <Stepper.Step label="FBR Connection" description="Enter credentials">
            <Stack gap="md" mt="md">
              <Box>
                <Text fw={500} size="sm" mb={4}>Environment</Text>
                <Select
                  data={[
                    { value: "sandbox", label: "Sandbox (Testing)" },
                    { value: "production", label: "Production (Live)" },
                  ]}
                  value={wizEnvironment}
                  onChange={(v) => v && setWizEnvironment(v)}
                  disabled={canGoProduction === false}
                />
                {wizEnvironment === "sandbox" ? (
                  <Text size="xs" c="dimmed" mt={4}>
                    Used for testing only. No invoices are submitted to FBR.
                  </Text>
                ) : (
                  <Text size="xs" c="orange" mt={4}>
                    Invoices will be submitted to FBR's live system.
                  </Text>
                )}
              </Box>

              <Divider />

              <Box>
                <Text fw={500} size="sm" mb={4}>Security Token</Text>
                <PasswordInput
                  placeholder="Enter your FBR/PRAL security token"
                  value={wizToken}
                  onChange={(e) => setWizToken(e.currentTarget.value)}
                />
                <Text size="xs" c="dimmed" mt={4}>
                  Your token is provided by FBR or a licensed integrator.
                  It is encrypted and stored securely.
                </Text>
              </Box>

              <Group justify="space-between" mt="md">
                <Button variant="subtle" onClick={() => setWizardStep(0)}>
                  Back
                </Button>
                <Button
                  loading={wizSaving}
                  disabled={!wizToken.trim()}
                  onClick={() => void handleWizardSaveAndTest()}
                >
                  Save & Continue
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>

          {/* Step 2: Test connection */}
          <Stepper.Step label="Verify" description="Test connection">
            <Stack gap="md" mt="md">
              {!wizTestResult && (
                <>
                  <Text size="sm" c="dimmed">
                    Test your connection to make sure the token is valid and
                    FBR can authenticate your business.
                  </Text>
                  <Center py="md">
                    <Button
                      loading={wizTesting}
                      onClick={() => void handleWizardTest()}
                      leftSection={<Zap size={14} />}
                      size="lg"
                    >
                      Test Connection
                    </Button>
                  </Center>
                </>
              )}

              {wizTestResult && (
                <Card
                  withBorder
                  padding="md"
                  style={{
                    borderColor: wizTestResult.success
                      ? "var(--mantine-color-green-4)"
                      : "var(--mantine-color-red-4)",
                    background: wizTestResult.success
                      ? "var(--mantine-color-green-0)"
                      : "var(--mantine-color-red-0)",
                  }}
                >
                  <Group gap="sm" mb="sm">
                    <ThemeIcon
                      size={32}
                      radius="xl"
                      variant="light"
                      color={wizTestResult.success ? "green" : "red"}
                    >
                      {wizTestResult.success ? (
                        <CheckCircle size={16} />
                      ) : (
                        <XCircle size={16} />
                      )}
                    </ThemeIcon>
                    <Title order={6}>
                      {wizTestResult.success
                        ? "Connection Successful"
                        : "Connection Failed"}
                    </Title>
                  </Group>
                  <Text size="sm">{wizTestResult.message}</Text>

                  {wizTestResult.success && (
                    <List size="sm" mt="sm" spacing={4}>
                      <List.Item>
                        Environment:{" "}
                        {wizEnvironment === "production"
                          ? "Production"
                          : "Sandbox"}
                      </List.Item>
                      <List.Item>
                        Business NTN:{" "}
                        {company?.ntn ?? company?.taxNumber ?? "—"}
                      </List.Item>
                      <List.Item>
                        {wizEnvironment === "sandbox"
                          ? "You can now submit test invoices."
                          : "Invoices will be submitted to FBR live."}
                      </List.Item>
                    </List>
                  )}

                  {!wizTestResult.success && (
                    <List size="sm" mt="sm" spacing={4} c="dimmed">
                      <List.Item>Verify your token is correct</List.Item>
                      <List.Item>Check the token has not expired</List.Item>
                      <List.Item>
                        Ensure the token matches the selected environment
                      </List.Item>
                    </List>
                  )}
                </Card>
              )}

              <Group justify="space-between" mt="md">
                <Button variant="subtle" onClick={() => setWizardStep(1)}>
                  Back
                </Button>
                {wizTestResult?.success ? (
                  <Button
                    color="green"
                    onClick={handleWizardFinish}
                    leftSection={<Check size={14} />}
                  >
                    Done
                  </Button>
                ) : wizTestResult && !wizTestResult.success ? (
                  <Button
                    variant="light"
                    onClick={() => {
                      setWizTestResult(null);
                    }}
                    leftSection={<RefreshCw size={14} />}
                  >
                    Try Again
                  </Button>
                ) : null}
              </Group>
            </Stack>
          </Stepper.Step>
        </Stepper>
      </Modal>
    </>
  );
}
