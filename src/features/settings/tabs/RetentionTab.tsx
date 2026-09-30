import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  archiveOldRecords,
  getErrorMessage,
  getRetentionSummary,
  type RetentionSummary,
} from "../../../api/backend";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";
import { INK } from "../../../theme";

export function RetentionTab() {
  const [summary, setSummary] = useState<RetentionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [years, setYears] = useState(5);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRetentionSummary(years);
      setSummary(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [years]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirmArchive() {
    setConfirmArchiveOpen(false);
    setArchiving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await archiveOldRecords(years);
      setSuccess(result);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setArchiving(false);
    }
  }

  return (
    <Stack maw={700}>
      <Card withBorder padding="lg">
        <Title order={5} mb="md">
          Data Retention Policy
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          Old paid invoices and purchase orders are archived to keep the
          database fast. Archived records are soft-deleted — they can be
          restored if needed.
        </Text>

        <Group mb="md">
          <NumberInput
            label="Retention period (years)"
            value={years}
            onChange={(v) => setYears(typeof v === "number" ? v : 5)}
            min={1}
            max={20}
            w={200}
          />
          <Button variant="light" onClick={load} loading={loading} mt={24}>
            Refresh
          </Button>
        </Group>

        {loading ? (
          <Text c="dimmed">Loading...</Text>
        ) : summary ? (
          <Stack gap="md">
            <SimpleGrid cols={3}>
              <Card
                withBorder
                padding="md"
                style={{ borderTop: `3px solid ${INK.navy}` }}
              >
                <Text size="xs" c="dimmed">
                  Archivable Invoices
                </Text>
                <Title order={4} style={{ color: INK.text }}>
                  {summary.invoicesArchivable}
                </Title>
              </Card>
              <Card
                withBorder
                padding="md"
                style={{ borderTop: `3px solid ${INK.gold}` }}
              >
                <Text size="xs" c="dimmed">
                  Archivable Purchase Orders
                </Text>
                <Title order={4} style={{ color: INK.text }}>
                  {summary.poArchivable}
                </Title>
              </Card>
              <Card
                withBorder
                padding="md"
                style={{ borderTop: `3px solid ${INK.chart.teal}` }}
              >
                <Text size="xs" c="dimmed">
                  Archivable Stock Movements
                </Text>
                <Title order={4} style={{ color: INK.text }}>
                  {summary.movementsArchivable}
                </Title>
              </Card>
            </SimpleGrid>

            {summary.oldestInvoiceDate && (
              <Text size="xs" c="dimmed">
                Oldest invoice: {summary.oldestInvoiceDate}
              </Text>
            )}
            {summary.oldestMovementDate && (
              <Text size="xs" c="dimmed">
                Oldest stock movement: {summary.oldestMovementDate}
              </Text>
            )}

            <Alert color="blue" variant="light">
              <Text size="sm">
                Archiving hides old records from normal views but keeps them in
                the database. They can be restored by a database administrator
                if needed for audits.
              </Text>
            </Alert>

            <Group justify="flex-end">
              <Button
                color="orange"
                onClick={() => setConfirmArchiveOpen(true)}
                loading={archiving}
                disabled={
                  summary.invoicesArchivable === 0 &&
                  summary.poArchivable === 0 &&
                  summary.movementsArchivable === 0
                }
              >
                Archive Records Older Than {years} Years
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text c="dimmed">No retention data available.</Text>
        )}

        {error && (
          <Text c="red" size="sm" mt="md">
            {error}
          </Text>
        )}
        {success && (
          <Text c="green" size="sm" mt="md">
            {success}
          </Text>
        )}
      </Card>

      <ConfirmDialog
        opened={confirmArchiveOpen}
        onClose={() => setConfirmArchiveOpen(false)}
        onConfirm={handleConfirmArchive}
        title="Archive Historical Records"
        message={
          <>
            Archive all paid/cancelled records older than <strong>{years} years</strong>?
          </>
        }
        subtitle="Records are soft-deleted from active view, keeping your database swift, and can be restored if needed."
        confirmLabel={`Archive Older than ${years} Years`}
        danger={false}
        loading={archiving}
      />
    </Stack>
  );
}
