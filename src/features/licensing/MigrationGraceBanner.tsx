import { useState } from "react";
import { Badge, Button, Group, Text } from "@mantine/core";
import { AlertTriangle, KeyRound } from "lucide-react";
import type { LicenseStatusResponse } from "../../types/backend";
import { InlineActivationModal } from "./InlineActivationModal";

interface MigrationGraceBannerProps {
  licenseStatus: LicenseStatusResponse;
  onStatusUpdate: (updated: LicenseStatusResponse) => void;
}

export function MigrationGraceBanner({
  licenseStatus,
  onStatusUpdate,
}: MigrationGraceBannerProps) {
  const [modalOpen, setModalOpen] = useState(false);

  if (!licenseStatus.isMigrationGrace) {
    return null;
  }

  const daysLeft = licenseStatus.daysRemaining ?? licenseStatus.graceDaysRemaining ?? 14;

  return (
    <>
      <div
        style={{
          background: "linear-gradient(90deg, rgba(217, 119, 6, 0.15) 0%, rgba(245, 158, 11, 0.08) 100%)",
          borderBottom: "1px solid rgba(245, 158, 11, 0.3)",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          zIndex: 100,
        }}
      >
        <Group gap="sm">
          <AlertTriangle size={16} color="#F59E0B" />
          <Text size="xs" fw={600} style={{ color: "#F59E0B" }}>
            Software License Notice:
          </Text>
          <Text size="xs" c="dimmed">
            Your system is currently running under a 14-day transition grace lease.
          </Text>
          <Badge size="xs" color="yellow" variant="light">
            {daysLeft > 0 ? `${daysLeft} days remaining` : "Grace period expiring"}
          </Badge>
        </Group>

        <Button
          size="compact-xs"
          variant="light"
          color="yellow"
          leftSection={<KeyRound size={12} />}
          onClick={() => setModalOpen(true)}
        >
          Enter License Key
        </Button>
      </div>

      <InlineActivationModal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={(updated) => {
          onStatusUpdate(updated);
        }}
      />
    </>
  );
}
