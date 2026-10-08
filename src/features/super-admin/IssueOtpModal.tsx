import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  CopyButton,
  Group,
  Modal,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { getErrorMessage, resetTenantPassword } from "../../api/backend";
import type { ResetTenantPasswordResult } from "../../types/backend";
import { useSaTheme } from "./saTheme";

interface IssueOtpModalProps {
  companyId: string;
  companyName: string;
  opened: boolean;
  onClose: () => void;
}

export function IssueOtpModal({
  companyId,
  companyName,
  opened,
  onClose,
}: IssueOtpModalProps) {
  const SA = useSaTheme();
  const [result, setResult] = useState<ResetTenantPasswordResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await resetTenantPassword(companyId);
      setResult(res);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  const voucherText = result
    ? `=== CORBEL ENTERPRISE CREDENTIAL VOUCHER ===
Organization: ${companyName}
Company ID: ${companyId}
Admin Email: ${result.email}
Temporary One-Time Password: ${result.temporaryPassword}
First-Time Login Instruction:
1. Open Corbel ERP on your workstation.
2. Sign in with the Admin Email and Temporary Password above.
3. You will be required to set your permanent private password immediately.
==============================================`
    : "";

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="xs">
          <KeyRound size={18} color={SA.accent} />
          <Text fw={700}>Issue Temporary Password (OTP)</Text>
        </Group>
      }
      radius="md"
      centered
      size="md"
    >
      <Stack gap="md">
        {error && (
          <Alert color="red" title="Error" radius="sm">
            {error}
          </Alert>
        )}

        {!result ? (
          <>
            <Alert
              color="yellow"
              title="Centralized Provisioning Notice"
              icon={<AlertTriangle size={16} />}
              radius="sm"
            >
              Generating a temporary OTP will reset the company owner's password in both
              local storage and the central Neon cloud cluster. The user will be forced
              to set a new password upon first login.
            </Alert>

            <Text size="sm" c="dimmed">
              Target Organization: <strong>{companyName}</strong>
            </Text>

            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={handleClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                loading={submitting}
                leftSection={<KeyRound size={14} />}
                style={{
                  background: SA.accent,
                  color: SA.dockActiveColor,
                }}
              >
                Generate Temporary Password
              </Button>
            </Group>
          </>
        ) : (
          <>
            <div
              style={{
                padding: "16px",
                borderRadius: 10,
                background: "var(--sa-panel, #12151c)",
                border: "1px solid var(--sa-border, #27272a)",
              }}
            >
              <Group justify="space-between" mb="xs">
                <Group gap="xs">
                  <ShieldCheck size={16} color={SA.success} />
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                    Client Credential Voucher
                  </Text>
                </Group>
                <Badge size="xs" color="teal">
                  One-Time Password Active
                </Badge>
              </Group>

              <Stack gap="xs" mt="sm">
                <div>
                  <Text size="xs" c="dimmed">
                    Admin Email
                  </Text>
                  <Text size="sm" fw={600} ff="monospace">
                    {result.email}
                  </Text>
                </div>

                <div>
                  <Group justify="space-between" align="center">
                    <Text size="xs" c="dimmed">
                      Temporary OTP
                    </Text>
                    <CopyButton value={result.temporaryPassword} timeout={2000}>
                      {({ copied, copy }) => (
                        <Tooltip label={copied ? "Copied" : "Copy OTP"} withArrow>
                          <ActionIcon size="xs" variant="subtle" color="yellow" onClick={copy}>
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </CopyButton>
                  </Group>
                  <Text
                    size="md"
                    fw={700}
                    ff="monospace"
                    style={{
                      letterSpacing: 1.5,
                      color: SA.accent,
                      background: "rgba(201, 149, 42, 0.1)",
                      padding: "4px 8px",
                      borderRadius: 6,
                      display: "inline-block",
                    }}
                  >
                    {result.temporaryPassword}
                  </Text>
                </div>
              </Stack>
            </div>

            <Text size="xs" c="dimmed">
              Provide this credential voucher to the organization owner. They will be
              automatically required to choose a secure permanent password upon logging in.
            </Text>

            <Group justify="space-between" mt="md">
              <CopyButton value={voucherText} timeout={2000}>
                {({ copied, copy }) => (
                  <Button
                    variant="light"
                    color="yellow"
                    size="xs"
                    onClick={copy}
                    leftSection={copied ? <Check size={14} /> : <Copy size={14} />}
                  >
                    {copied ? "Voucher Copied!" : "Copy Full Voucher"}
                  </Button>
                )}
              </CopyButton>

              <Button size="xs" variant="default" onClick={handleClose}>
                Done
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
