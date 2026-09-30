// ==========================================
// SHARED UI: CONFIRMATION DIALOG PRIMITIVE
// ==========================================
//
// Replaces raw window.confirm() and inconsistent dialog boilerplate.
// Supports danger states, async loading indicators, and customizable text.

import { type ReactNode } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { AlertTriangle, Trash2 } from "lucide-react";

export interface ConfirmDialogProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: ReactNode;
  subtitle?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  error?: string | null;
}

export function ConfirmDialog({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  subtitle,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
  loading = false,
  error = null,
}: ConfirmDialogProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          {danger ? (
            <Trash2 size={18} color="var(--mantine-color-red-6)" />
          ) : (
            <AlertTriangle size={18} color="var(--mantine-color-yellow-6)" />
          )}
          <Text fw={700}>{title}</Text>
        </Group>
      }
      centered
      size="sm"
    >
      <Stack gap="md">
        {error && (
          <Alert color="red" title="Error">
            {error}
          </Alert>
        )}

        <Text size="sm">{message}</Text>

        {subtitle && (
          <Text size="xs" c="dimmed">
            {subtitle}
          </Text>
        )}

        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            color={danger ? "red" : "blue"}
            loading={loading}
            disabled={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export default ConfirmDialog;
