import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  createBackup,
  getErrorMessage,
  openFileDialog,
  restoreBackup,
  saveFileDialog,
} from "../../../api/backend";
import { ConfirmDialog } from "../../../shared/ui/ConfirmDialog";

interface BackupRestoreTabProps {
  onLogout: () => Promise<void>;
}

export function BackupRestoreTab({ onLogout }: BackupRestoreTabProps) {
  const [backing, setBacking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingRestorePath, setPendingRestorePath] = useState<string | null>(null);

  async function handleBackup() {
    setBacking(true);
    setError(null);
    setSuccess(null);
    try {
      const path = await saveFileDialog({
        title: "Save Backup",
        defaultPath: "corbel-erp-backup.db",
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

  async function handleSelectRestoreFile() {
    setError(null);
    setSuccess(null);

    const path = await openFileDialog({
      title: "Select Backup File",
      filters: [{ name: "SQLite Database", extensions: ["db"] }],
    });
    if (typeof path !== "string" || !path) return;
    setPendingRestorePath(path);
  }

  async function handleConfirmRestore() {
    if (!pendingRestorePath) return;
    const path = pendingRestorePath;
    setPendingRestorePath(null);
    setRestoring(true);
    try {
      const result = await restoreBackup(path);
      setSuccess(result);
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
        <Button color="orange" onClick={handleSelectRestoreFile} loading={restoring}>
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
          📁 Local Database Location
        </Title>
        <Text size="sm" c="dimmed">
          Your active database is stored locally in SQLite WAL mode.
        </Text>
        <Text size="sm" fw={500} ff="monospace" mt={4} c="dimmed">
          AppData / Local Data Directory
        </Text>
        <Text size="sm" c="dimmed" mt="md">
          Backups are saved wherever you choose. We recommend backing up to a
          USB drive or cloud storage regularly.
        </Text>
      </Card>

      <ConfirmDialog
        opened={Boolean(pendingRestorePath)}
        onClose={() => setPendingRestorePath(null)}
        onConfirm={handleConfirmRestore}
        title="Restore Database from Backup"
        message={
          <>
            Are you sure you want to restore the database from{" "}
            <strong>{pendingRestorePath}</strong>?
          </>
        }
        subtitle="This will replace all current database records. An automated safety backup will be created before restoring."
        confirmLabel="Restore & Restart"
        danger
        loading={restoring}
      />
    </Stack>
  );
}
