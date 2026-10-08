import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { CreditCard, Sparkles } from "lucide-react";
import {
  assignCompanySubscription,
  getErrorMessage,
  listPackages,
} from "../../api/backend";
import type { PublicPackage } from "../../types/backend";
import { useSaTheme } from "./saTheme";

interface ChangeSubscriptionModalProps {
  companyId: string;
  companyName: string;
  currentPackageId?: string;
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ChangeSubscriptionModal({
  companyId,
  companyName,
  currentPackageId,
  opened,
  onClose,
  onSuccess,
}: ChangeSubscriptionModalProps) {
  const SA = useSaTheme();
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string>(currentPackageId || "");
  const [status, setStatus] = useState<string>("active");
  const [trialDays, setTrialDays] = useState<number | "">(14);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setLoading(true);
      setError(null);
      listPackages()
        .then((pkgs) => {
          setPackages(pkgs);
          if (!selectedPkg && pkgs.length > 0) {
            setSelectedPkg(currentPackageId || pkgs[0].id);
          }
        })
        .catch((err) => setError(getErrorMessage(err)))
        .finally(() => setLoading(false));
    }
  }, [opened, currentPackageId, selectedPkg]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPkg) {
      setError("Please select a package.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await assignCompanySubscription({
        companyId,
        packageId: selectedPkg,
        status: status || undefined,
        trialDays: typeof trialDays === "number" ? trialDays : undefined,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const packageOptions = packages.map((p) => ({
    value: p.id,
    label: `${p.name} — PKR ${p.price.toLocaleString()}/${p.billingCycle}`,
  }));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <CreditCard size={18} color={SA.accent} />
          <Text fw={700}>Change Subscription Plan</Text>
        </Group>
      }
      radius="md"
      centered
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Assign a new plan and provisioning tier for <strong>{companyName}</strong>.
            This updates both local storage and the central Neon cloud cluster.
          </Text>

          {error && (
            <Alert color="red" title="Error" radius="sm">
              {error}
            </Alert>
          )}

          <Select
            label="Target Package Tier"
            placeholder="Select plan"
            data={packageOptions}
            value={selectedPkg}
            onChange={(val) => val && setSelectedPkg(val)}
            disabled={loading || submitting}
            required
          />

          <Select
            label="Subscription Lifecycle Status"
            value={status}
            onChange={(val) => val && setStatus(val)}
            data={[
              { value: "active", label: "Active (Standard Operations)" },
              { value: "trialing", label: "Trialing (Grace / Evaluation)" },
              { value: "past_due", label: "Past Due (Payment Overdue)" },
              { value: "canceled", label: "Canceled (Terminated)" },
            ]}
            disabled={submitting}
          />

          {status === "trialing" && (
            <NumberInput
              label="Evaluation Trial Days"
              min={1}
              max={365}
              value={trialDays}
              onChange={(val) => setTrialDays(typeof val === "number" ? val : "")}
              disabled={submitting}
            />
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={submitting}
              leftSection={<Sparkles size={14} />}
              style={{
                background: SA.accent,
                color: SA.dockActiveColor,
              }}
            >
              Assign Subscription
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
