import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { AlertTriangle, Trash2 } from "lucide-react";
import { getErrorMessage, writeOffBatch } from "../../../api/backend";
import type { PublicStockBatch } from "../../../types/backend";
import { INK } from "../../../theme";
import { formatDate, LEDGER_NUM } from "../utils/inventoryHelpers";

interface WriteOffModalProps {
  batch: PublicStockBatch | null;
  onClose: () => void;
  onWrittenOff: () => Promise<void>;
}

export function WriteOffModal({
  batch,
  onClose,
  onWrittenOff,
}: WriteOffModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("expiry write-off");
  const isMobile = useMediaQuery("(max-width: 48em)");

  useEffect(() => {
    if (batch) {
      setError(null);
    }
  }, [batch]);

  async function handleWriteOff() {
    if (!batch) return;
    if (batch.quantity <= 0) {
      setError("This batch is already depleted (0 units left).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await writeOffBatch({
        batchId: batch.id,
        quantity: batch.quantity,
        reason: reason.trim() || "expiry write-off",
      });
      await onWrittenOff();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={!!batch}
      onClose={onClose}
      title={
        <Group gap={8}>
          <Trash2 size={16} color="red" />
          <Text fw={700} style={{ color: INK.text }}>
            Write off batch
          </Text>
        </Group>
      }
      centered
      radius="md"
      fullScreen={isMobile}
      transitionProps={isMobile ? { transition: "slide-up" } : undefined}
    >
      <Stack gap="md">
        {batch && (
          <Card
            padding="sm"
            radius="sm"
            style={{ background: INK.paper, border: `1px solid ${INK.border}` }}
          >
            <Group justify="space-between" wrap="wrap">
              <Text size="sm" c="dimmed">
                Expiry {formatDate(batch.expiryDate)} · {batch.productName}
              </Text>
              <Text size="sm" c="dimmed">
                Batch {batch.batchNumber || "—"}
              </Text>
              <Text fw={700} style={{ ...LEDGER_NUM, color: INK.text }}>
                {batch.quantity} units will be written off
              </Text>
            </Group>
          </Card>
        )}

        <TextInput
          label="Reason"
          placeholder="e.g. expired, damaged"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />

        <Text size="xs" c="dimmed">
          The entire remaining quantity of this batch is written off: both the
          batch and the product's stock on hand drop to 0. It is recorded as an
          adjustment in stock history.
        </Text>

        {error && (
          <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
            {error}
          </Alert>
        )}

        <Divider />

        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={loading}
            leftSection={<Trash2 size={14} />}
            onClick={handleWriteOff}
          >
            Write Off
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
