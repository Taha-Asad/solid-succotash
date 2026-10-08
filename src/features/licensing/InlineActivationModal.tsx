import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  CopyButton,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Check, Copy, Cpu, KeyRound, ShieldCheck } from "lucide-react";
import { activateLicense, getDeviceIdentity, getErrorMessage } from "../../api/backend";
import type { DeviceIdentity, LicenseStatusResponse } from "../../types/backend";

interface InlineActivationModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: (status: LicenseStatusResponse) => void;
}

export function InlineActivationModal({
  opened,
  onClose,
  onSuccess,
}: InlineActivationModalProps) {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      getDeviceIdentity()
        .then((id) => {
          setIdentity(id);
          setDeviceName(id.deviceName);
        })
        .catch((err) => {
          console.error("Failed to read device hardware identity", err);
        });
    }
  }, [opened]);

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
      onSuccess(res);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ShieldCheck size={20} color="var(--app-accent, #3b82f6)" />
          <Text fw={700}>Activate Sovereign License</Text>
        </Group>
      }
      centered
      radius="md"
      size="md"
    >
      <form onSubmit={handleActivate}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Enter your enterprise license key to permanently activate this workstation.
          </Text>

          {error && (
            <Alert color="red" title="Activation Failed" radius="sm">
              {error}
            </Alert>
          )}

          {identity && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "var(--app-soft, #18181b)",
                border: "1px solid var(--app-border, #27272a)",
              }}
            >
              <Group justify="space-between" align="center">
                <Group gap="xs">
                  <Cpu size={14} color="var(--app-muted, #a1a1aa)" />
                  <Text size="xs" c="dimmed">Workstation Hardware ID</Text>
                </Group>
                <CopyButton value={identity.hwid} timeout={2000}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied" : "Copy HWID"} withArrow>
                      <ActionIcon size="xs" variant="subtle" color="gray" onClick={copy}>
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
              <Text size="xs" ff="monospace" fw={600} mt={4}>
                {identity.hwid}
              </Text>
            </div>
          )}

          <TextInput
            label="License Activation Key"
            placeholder="CORBEL-XXXX-XXXX-XXXX"
            leftSection={<KeyRound size={16} />}
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.currentTarget.value)}
            required
            styles={{ input: { fontFamily: "monospace", textTransform: "uppercase" } }}
          />

          <TextInput
            label="Device / Workstation Label"
            placeholder="Main Counter, Backoffice Terminal 1..."
            value={deviceName}
            onChange={(e) => setDeviceName(e.currentTarget.value)}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={isSubmitting}
              style={{
                background: "var(--app-accent, #3b82f6)",
                color: "#ffffff",
              }}
            >
              Activate Station
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
