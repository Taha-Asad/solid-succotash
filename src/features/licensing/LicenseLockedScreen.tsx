import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  CopyButton,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  Check,
  Copy,
  Cpu,
  KeyRound,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import {
  checkLicenseStatus,
  deactivateLicense,
  getErrorMessage,
} from "../../api/backend";
import { CorbelSquircle } from "../../components/CorbelLogo";
import type { LicenseStatusResponse } from "../../types/backend";

interface LicenseLockedScreenProps {
  status: LicenseStatusResponse | null;
  onUnlocked: (newStatus: LicenseStatusResponse) => void;
  onEnterNewKey: () => void;
}

export default function LicenseLockedScreen({
  status,
  onUnlocked,
  onEnterNewKey,
}: LicenseLockedScreenProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRecheck = async () => {
    setIsChecking(true);
    setError(null);
    try {
      const res = await checkLicenseStatus();
      if (res.isLicensed && !res.isBlocked) {
        onUnlocked(res);
      } else {
        setError(res.blockReason || "Device remains locked. Contact administrator.");
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsChecking(false);
    }
  };

  const handleClearAndNewKey = async () => {
    try {
      await deactivateLicense();
    } catch (err) {
      console.warn("Error clearing local lease:", err);
    }
    onEnterNewKey();
  };

  const reasonText =
    status?.blockReason ||
    (status?.isOfflineGrace
      ? "7-Day Offline Grace Period Expired. Reconnect to internet."
      : "Access revoked by sovereign administrator.");

  return (
    <Center
      h="100vh"
      style={{
        background: "radial-gradient(ellipse at 50% 20%, #201314 0%, #0a0607 100%)",
        color: "#f8fafc",
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
          background: "rgba(28, 17, 19, 0.9)",
          backdropFilter: "blur(16px)",
          border: "1px solid rgba(224, 114, 95, 0.4)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.85)",
        }}
      >
        <Stack gap="lg" align="center" ta="center">
          <CorbelSquircle size={56} variant="gold" />

          <div>
            <Badge
              variant="filled"
              color="red"
              size="lg"
              leftSection={<ShieldAlert size={14} />}
              style={{
                backgroundColor: "#E0725F",
                textTransform: "uppercase",
                letterSpacing: 0.8,
                padding: "0.5rem 1rem",
              }}
            >
              Access Suspended
            </Badge>
            <Title order={3} mt="sm" style={{ color: "#F4F0EA" }}>
              Device Access Locked
            </Title>
            <Text size="sm" c="dimmed" mt={4} style={{ maxWidth: 380, lineHeight: 1.5 }}>
              {reasonText}
            </Text>
          </div>

          {/* Hardware Identity Box */}
          <div
            style={{
              width: "100%",
              background: "rgba(10, 6, 8, 0.75)",
              borderRadius: 8,
              padding: "0.75rem 1rem",
              border: "1px solid rgba(224, 114, 95, 0.2)",
              textAlign: "left",
            }}
          >
            <Group justify="space-between" align="center">
              <Group gap={6}>
                <Cpu size={14} color="#E0725F" />
                <Text size="xs" fw={600} style={{ color: "#e2e8f0" }}>
                  Hardware Identity (HWID)
                </Text>
              </Group>
              {status?.deviceHwid && (
                <CopyButton value={status.deviceHwid} timeout={2000}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "Copied" : "Copy HWID"}>
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
            <Text
              size="xs"
              ff="monospace"
              mt={6}
              style={{
                color: "#fca5a5",
                background: "rgba(0, 0, 0, 0.3)",
                padding: "4px 8px",
                borderRadius: 4,
              }}
            >
              {status?.deviceHwid || "Detecting HWID..."}
            </Text>
          </div>

          {error && (
            <Text size="xs" c="red" style={{ background: "rgba(239, 68, 68, 0.1)", padding: "6px 12px", borderRadius: 4, width: "100%" }}>
              {error}
            </Text>
          )}

          {/* Action Buttons */}
          <Stack gap="xs" style={{ width: "100%" }}>
            <Button
              fullWidth
              onClick={handleRecheck}
              loading={isChecking}
              leftSection={<RefreshCw size={15} />}
              style={{
                backgroundColor: "#E0725F",
                color: "#ffffff",
                height: 40,
                fontWeight: 600,
              }}
            >
              Re-check Cloud License
            </Button>

            <Button
              variant="subtle"
              fullWidth
              onClick={handleClearAndNewKey}
              leftSection={<KeyRound size={15} />}
              style={{
                color: "#94a3b8",
                height: 38,
                fontSize: "0.85rem",
              }}
            >
              Enter Different License Key
            </Button>
          </Stack>

          {/* Support Notice */}
          <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
            To restore access or extend your trial, forward your HWID to
            <br />
            <span style={{ color: "#E0725F", fontWeight: 500 }}>
              Taha Asadullah (@thefoolishcrow)
            </span>
          </Text>
        </Stack>
      </Card>
    </Center>
  );
}
