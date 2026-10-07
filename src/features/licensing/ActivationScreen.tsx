import { useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  CopyButton,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  AlertCircle,
  Check,
  Copy,
  Cpu,
  KeyRound,
  Laptop,
  ShieldCheck,
} from "lucide-react";
import { activateLicense, getDeviceIdentity, getErrorMessage } from "../../api/backend";
import { CorbelSquircle } from "../../components/CorbelLogo";
import type { DeviceIdentity, LicenseStatusResponse } from "../../types/backend";

interface ActivationScreenProps {
  onActivationSuccess: (status: LicenseStatusResponse) => void;
}

export default function ActivationScreen({
  onActivationSuccess,
}: ActivationScreenProps) {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDeviceIdentity()
      .then((id) => {
        setIdentity(id);
        setDeviceName(id.deviceName);
      })
      .catch((err) => {
        console.error("Failed to read device hardware identity", err);
      });
  }, []);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = licenseKey.trim().toUpperCase();
    if (!cleanKey) {
      setError("Please enter a valid license activation key.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await activateLicense({
        licenseKey: cleanKey,
        deviceName: deviceName.trim() || undefined,
      });
      onActivationSuccess(res);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Center
      h="100vh"
      style={{
        background: "radial-gradient(ellipse at 50% 20%, #1a233d 0%, #0c1021 100%)",
        color: "#e2e8f0",
        padding: "1.5rem",
      }}
    >
      <Card
        shadow="xl"
        radius="lg"
        p="xl"
        style={{
          width: "100%",
          maxWidth: 480,
          background: "rgba(18, 24, 43, 0.85)",
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(224, 114, 95, 0.25)",
          boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.7)",
        }}
      >
        <Stack gap="lg">
          {/* Header & Logo */}
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <CorbelSquircle size={42} variant="gold" />
              <div>
                <Title order={4} style={{ color: "#F4F0EA", letterSpacing: -0.2 }}>
                  Corbel ERP
                </Title>
                <Text size="xs" c="dimmed">
                  Sovereign Hardware Activation Gate
                </Text>
              </div>
            </Group>
            <Badge
              variant="outline"
              color="orange"
              leftSection={<ShieldCheck size={12} />}
              style={{
                borderColor: "rgba(224, 114, 95, 0.4)",
                color: "#E0725F",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Gate Locked
            </Badge>
          </Group>

          {/* Machine Identity Inspector */}
          <div
            style={{
              background: "rgba(10, 14, 26, 0.7)",
              borderRadius: 8,
              padding: "0.85rem 1rem",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <Group justify="space-between" align="center" mb={6}>
              <Group gap={6}>
                <Cpu size={14} color="#E0725F" />
                <Text size="xs" fw={600} style={{ color: "#cbd5e1" }}>
                  Hardware Identity (HWID)
                </Text>
              </Group>
              {identity && (
                <CopyButton value={identity.hwid} timeout={2000}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied HWID" : "Copy HWID"}>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color={copied ? "teal" : "gray"}
                        onClick={copy}
                      >
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              )}
            </Group>

            {identity ? (
              <Stack gap={4}>
                <Text
                  size="xs"
                  ff="monospace"
                  style={{
                    color: "#F4F0EA",
                    letterSpacing: 0.8,
                    background: "rgba(0, 0, 0, 0.3)",
                    padding: "4px 8px",
                    borderRadius: 4,
                  }}
                >
                  {identity.hwid}
                </Text>
                <Group justify="space-between" mt={4}>
                  <Group gap={4}>
                    <Laptop size={12} color="#94a3b8" />
                    <Text size="xs" c="dimmed">
                      {identity.deviceName}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {identity.osInfo} • v{identity.appVersion}
                  </Text>
                </Group>
              </Stack>
            ) : (
              <Group gap="xs" py={4}>
                <Loader size="xs" color="#E0725F" />
                <Text size="xs" c="dimmed">
                  Detecting machine hardware signature...
                </Text>
              </Group>
            )}
          </div>

          {/* Activation Form */}
          <form onSubmit={handleActivate}>
            <Stack gap="md">
              <TextInput
                label="License Activation Key"
                description="Enter the key issued by Taha Asadullah"
                placeholder="CRBL-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.currentTarget.value.toUpperCase())}
                leftSection={<KeyRound size={16} color="#E0725F" />}
                required
                styles={{
                  input: {
                    fontFamily: "monospace",
                    letterSpacing: 1.2,
                    textTransform: "uppercase",
                    backgroundColor: "rgba(10, 14, 26, 0.8)",
                    borderColor: "rgba(255, 255, 255, 0.15)",
                    color: "#F4F0EA",
                  },
                  label: { color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 500 },
                  description: { color: "#94a3b8", fontSize: "0.75rem" },
                }}
              />

              <TextInput
                label="Workstation Identifier"
                description="Friendly label for this device in the fleet directory"
                placeholder="e.g. counter-pos-01"
                value={deviceName}
                onChange={(e) => setDeviceName(e.currentTarget.value)}
                styles={{
                  input: {
                    backgroundColor: "rgba(10, 14, 26, 0.8)",
                    borderColor: "rgba(255, 255, 255, 0.15)",
                    color: "#F4F0EA",
                  },
                  label: { color: "#e2e8f0", fontSize: "0.85rem", fontWeight: 500 },
                  description: { color: "#94a3b8", fontSize: "0.75rem" },
                }}
              />

              {error && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.75rem",
                    borderRadius: 6,
                    background: "rgba(239, 68, 68, 0.12)",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    color: "#fca5a5",
                    fontSize: "0.8rem",
                  }}
                >
                  <AlertCircle size={16} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                fullWidth
                loading={isSubmitting}
                style={{
                  backgroundColor: "#E0725F",
                  color: "#ffffff",
                  height: 42,
                  marginTop: 6,
                  fontWeight: 600,
                  letterSpacing: 0.3,
                }}
              >
                Activate & Bind Device
              </Button>
            </Stack>
          </form>

          {/* Footer Note */}
          <Text size="xs" ta="center" c="dimmed" style={{ lineHeight: 1.5 }}>
            Each binary is bound to physical hardware to protect intellectual property.
            <br />
            Need an activation key? Contact{" "}
            <span style={{ color: "#E0725F", fontWeight: 500 }}>
              Taha Asadullah (@thefoolishcrow)
            </span>
          </Text>
        </Stack>
      </Card>
    </Center>
  );
}
