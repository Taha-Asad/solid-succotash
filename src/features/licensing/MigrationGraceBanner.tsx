import { useState } from "react";
import { Badge, Button, Group, Text } from "@mantine/core";
import { AlertTriangle, KeyRound, Lock, Mail } from "lucide-react";
import type { LicenseStatusResponse } from "../../types/backend";
import { TAHA_CONTACT } from "../../components/SupportContactCard";
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

  const isTrialOrGrace =
    licenseStatus.isMigrationGrace || licenseStatus.licenseType === "trial";

  if (!isTrialOrGrace) {
    return null;
  }

  const daysLeft =
    licenseStatus.daysRemaining ?? licenseStatus.graceDaysRemaining ?? 14;
  const isExpiredReadOnly = daysLeft <= 0;

  const mailtoHref = `mailto:${TAHA_CONTACT.email}?subject=${encodeURIComponent(
    "Corbel ERP — Renew Subscription / License Key Request",
  )}`;

  return (
    <>
      <div
        style={{
          background: isExpiredReadOnly
            ? "linear-gradient(90deg, rgba(239, 68, 68, 0.22) 0%, rgba(185, 28, 28, 0.12) 100%)"
            : "linear-gradient(90deg, rgba(217, 119, 6, 0.15) 0%, rgba(245, 158, 11, 0.08) 100%)",
          borderBottom: isExpiredReadOnly
            ? "1px solid rgba(239, 68, 68, 0.45)"
            : "1px solid rgba(245, 158, 11, 0.3)",
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
          {isExpiredReadOnly ? (
            <Lock size={16} color="#EF4444" />
          ) : (
            <AlertTriangle size={16} color="#F59E0B" />
          )}
          <Text
            size="xs"
            fw={700}
            style={{ color: isExpiredReadOnly ? "#FCA5A5" : "#F59E0B" }}
          >
            {isExpiredReadOnly
              ? "Read-Only Mode (14-Day Trial Expired):"
              : "14-Day Evaluation Trial:"}
          </Text>
          <Text size="xs" c="dimmed">
            {isExpiredReadOnly
              ? "You can view and export existing records. Creating or editing records is paused until you activate a plan (3,400 / 4,200 / 6,000 PKR)."
              : "Your workspace is running on a 14-day evaluation lease."}
          </Text>
          <Badge
            size="xs"
            color={isExpiredReadOnly ? "red" : "yellow"}
            variant="light"
          >
            {daysLeft > 0 ? `${daysLeft} days remaining` : "Read-Only Mode"}
          </Badge>
        </Group>

        <Group gap="xs">
          <Button
            component="a"
            href={mailtoHref}
            size="compact-xs"
            variant="subtle"
            color={isExpiredReadOnly ? "red" : "yellow"}
            leftSection={<Mail size={12} />}
          >
            Contact {TAHA_CONTACT.name}
          </Button>
          <Button
            size="compact-xs"
            variant="light"
            color={isExpiredReadOnly ? "red" : "yellow"}
            leftSection={<KeyRound size={12} />}
            onClick={() => setModalOpen(true)}
          >
            Enter License Key
          </Button>
        </Group>
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

