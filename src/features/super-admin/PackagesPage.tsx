// ==========================================
// PACKAGES — Super Admin plan management
// ==========================================

import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Group,
  LoadingOverlay,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  Boxes,
  Check,
  ChevronDown,
  ChevronUp,
  Cpu,
  GitBranch,
  HardDrive,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  Zap,
} from "lucide-react";

import {
  createPackage,
  deletePackage,
  getErrorMessage,
  listPackages,
  updatePackage,
} from "../../api/backend";
import type { CreatePackageInput, PublicPackage } from "../../types/backend";
import { useI18n } from "../../i18n/I18nProvider";
import { useSaTheme } from "./saTheme.tsx";

// ==========================================
// STANDARD CAPABILITY TOGGLES
// ==========================================

const STANDARD_FEATURES = [
  { key: "Point of Sale", label: "Point of Sale & Thermal Receipts" },
  { key: "Inventory & Stock", label: "Inventory & Multi-Batch Tracking" },
  { key: "FBR Real-Time Integration", label: "FBR Real-Time Fiscalization" },
  { key: "Multi-Currency", label: "Multi-Currency & Exchange Rates" },
  { key: "Advanced Ledger", label: "Double-Entry Financial Ledger" },
  { key: "Role Permissions", label: "Custom Roles & Permissions" },
  { key: "Full Audit Trail", label: "Immutable Audit Log & Security" },
  { key: "Offline First", label: "Offline-First SQLite Synchronization" },
];

// ==========================================
// PACKAGE EDITOR MODAL (create + edit)
// ==========================================

function PackageEditorModal({
  opened,
  onClose,
  onSaved,
  editing,
}: {
  opened: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: PublicPackage | null;
}) {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState<number>(0);
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [maxUsers, setMaxUsers] = useState<number>(5);
  const [maxBranches, setMaxBranches] = useState<number>(1);
  const [maxStorageMb, setMaxStorageMb] = useState<number>(1024);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [rawModuleLimits, setRawModuleLimits] = useState("{}");
  const [rawFeatures, setRawFeatures] = useState("[]");

  useEffect(() => {
    if (!opened) return;
    setError("");
    setAdvancedOpen(false);

    if (editing) {
      setName(editing.name);
      setDescription(editing.description ?? "");
      setPrice(editing.price);
      setBillingCycle(editing.billingCycle);
      setMaxUsers(editing.maxUsers);
      setMaxBranches(editing.maxBranches);
      setMaxStorageMb(editing.maxStorageMb);

      let feats: string[] = [];
      if (Array.isArray(editing.features)) {
        feats = editing.features.map(String);
      } else if (editing.features && typeof editing.features === "object") {
        feats = Object.keys(editing.features);
      }
      setSelectedFeatures(feats);
      setRawFeatures(JSON.stringify(editing.features ?? []));
      setRawModuleLimits(JSON.stringify(editing.moduleLimits ?? {}));
    } else {
      setName("");
      setDescription("");
      setPrice(3500);
      setBillingCycle("monthly");
      setMaxUsers(5);
      setMaxBranches(1);
      setMaxStorageMb(1024);
      setSelectedFeatures(["Point of Sale", "Inventory & Stock", "Offline First"]);
      setRawFeatures(JSON.stringify(["Point of Sale", "Inventory & Stock", "Offline First"]));
      setRawModuleLimits(
        JSON.stringify({ inventory: true, invoicing: true, reports: true, customers: true }),
      );
    }
  }, [opened, editing]);

  const toggleFeature = (feat: string) => {
    const updated = selectedFeatures.includes(feat)
      ? selectedFeatures.filter((f) => f !== feat)
      : [...selectedFeatures, feat];
    setSelectedFeatures(updated);
    setRawFeatures(JSON.stringify(updated));
  };

  async function handleSave() {
    setError("");
    if (name.trim().length < 2) {
      setError(t("sa.packages.nameRequired"));
      return;
    }
    setLoading(true);

    try {
      // Build features JSON
      let finalFeatures = rawFeatures;
      try {
        JSON.parse(finalFeatures);
      } catch {
        finalFeatures = JSON.stringify(selectedFeatures);
      }

      // Build module limits JSON
      let finalModuleLimits = rawModuleLimits;
      try {
        JSON.parse(finalModuleLimits);
      } catch {
        finalModuleLimits = "{}";
      }

      const base: CreatePackageInput = {
        name: name.trim(),
        description: description.trim() || null,
        price,
        billingCycle,
        maxUsers,
        maxBranches,
        maxStorageMb,
        moduleLimits: finalModuleLimits,
        features: finalFeatures,
      };

      if (editing) {
        await updatePackage({ ...base, packageId: editing.id });
      } else {
        await createPackage(base);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: SA.panelMint,
              color: SA.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Sparkles size={16} />
          </div>
          <Text fw={600} size="md" style={{ color: SA.text, letterSpacing: -0.3 }}>
            {editing ? t("sa.packages.edit") : t("sa.packages.create")}
          </Text>
        </Group>
      }
      size="lg"
      centered
      radius={28}
      overlayProps={{ blur: 6, backgroundOpacity: 0.35 }}
      styles={{
        content: {
          background: SA.panel,
          boxShadow: "none",
          borderRadius: 8,
        },
        header: {
          background: SA.panel,
          borderBottom: `1px solid ${SA.border}`,
          padding: "20px 26px",
        },
        body: { padding: "26px" },
      }}
    >
      <LoadingOverlay visible={loading} />
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <TextInput
            label={t("sa.packages.name")}
            placeholder="e.g. Professional Retail"
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            radius="md"
          />
          <Select
            label={t("sa.packages.billingCycle")}
            data={[
              { value: "monthly", label: "Monthly (30 Days)" },
              { value: "quarterly", label: "Quarterly (90 Days)" },
              { value: "yearly", label: "Yearly (365 Days)" },
              { value: "one_time", label: "One-time Lifetime" },
            ]}
            value={billingCycle}
            onChange={(v) => setBillingCycle(v ?? "monthly")}
            radius="md"
          />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <NumberInput
            label="Plan Price (PKR)"
            description="Recurring billing charge"
            value={price}
            onChange={(v) => setPrice(Number(v) || 0)}
            min={0}
            thousandSeparator=","
            prefix="PKR "
            radius="md"
          />
          <TextInput
            label={t("sa.packages.description")}
            placeholder="e.g. Perfect for multi-counter retailers"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            radius="md"
          />
        </SimpleGrid>

        {/* Quotas */}
        <div
          style={{
            background: SA.panelStrong,
            border: `1px solid ${SA.border}`,
            borderRadius: 14,
            padding: "16px",
          }}
        >
          <Text size="xs" fw={700} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
            Tier Resource Limits
          </Text>
          <SimpleGrid cols={3} spacing="sm">
            <NumberInput
              label={t("sa.packages.maxUsers")}
              value={maxUsers}
              onChange={(v) => setMaxUsers(Number(v) || 1)}
              min={1}
              leftSection={<Users size={14} />}
              radius="md"
            />
            <NumberInput
              label={t("sa.packages.maxBranches")}
              value={maxBranches}
              onChange={(v) => setMaxBranches(Number(v) || 1)}
              min={1}
              leftSection={<GitBranch size={14} />}
              radius="md"
            />
            <NumberInput
              label="Storage Quota (MB)"
              value={maxStorageMb}
              onChange={(v) => setMaxStorageMb(Number(v) || 100)}
              min={50}
              leftSection={<HardDrive size={14} />}
              radius="md"
            />
          </SimpleGrid>
        </div>

        {/* Included Capabilities */}
        <div>
          <Text size="xs" fw={700} style={{ color: SA.text, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
            Included Modules & Features
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            {STANDARD_FEATURES.map((feat) => {
              const active = selectedFeatures.includes(feat.key);
              return (
                <div
                  key={feat.key}
                  onClick={() => toggleFeature(feat.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: active ? `${SA.accent}14` : SA.panelStrong,
                    border: `1px solid ${active ? SA.accent : SA.border}`,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Checkbox
                    checked={active}
                    onChange={() => toggleFeature(feat.key)}
                    color="teal"
                    size="xs"
                    styles={{ root: { pointerEvents: "none" } }}
                  />
                  <Text size="xs" fw={600} style={{ color: active ? SA.text : SA.textSoft }}>
                    {feat.label}
                  </Text>
                </div>
              );
            })}
          </SimpleGrid>
        </div>

        {/* Advanced JSON Toggle */}
        <div>
          <Button
            variant="subtle"
            size="compact-xs"
            color="gray"
            leftSection={advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            {advancedOpen ? "Hide Advanced JSON Schema" : "Show Advanced JSON Schema"}
          </Button>
          <Collapse expanded={advancedOpen}>
            <Stack gap="xs" mt="xs">
              <TextInput
                label="module_limits (JSON)"
                size="xs"
                value={rawModuleLimits}
                onChange={(e) => setRawModuleLimits(e.currentTarget.value)}
                placeholder='{"sales":1,"inventory":1}'
              />
              <Textarea
                label="features (JSON Array)"
                size="xs"
                rows={2}
                value={rawFeatures}
                onChange={(e) => setRawFeatures(e.currentTarget.value)}
                placeholder='["Point of Sale","FBR"]'
              />
            </Stack>
          </Collapse>
        </div>

        {error && (
          <Alert color="red" icon={<Info size={16} />} radius="md" styles={{ root: { color: SA.danger } }}>
            {error}
          </Alert>
        )}

        <Divider style={{ borderColor: SA.border }} />

        <Group justify="flex-end" gap="sm">
          <Button
            variant="subtle"
            onClick={onClose}
            styles={{
              root: {
                borderRadius: 8,
                color: SA.muted,
                fontWeight: 700,
                height: 40,
                paddingInline: 18,
                "&:hover": { background: SA.panelStrong, color: SA.text },
              },
            }}
          >
            {t("sa.common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            loading={loading}
            styles={{
              root: {
                background: SA.accent,
                color: SA.accentOnAccent,
                fontWeight: 750,
                borderRadius: 8,
                height: 40,
                paddingInline: 24,
                boxShadow: "0 2px 8px -1px rgba(194, 65, 12, 0.35)",
                "&:hover": { background: SA.accentHover },
              },
            }}
          >
            {t("sa.common.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ==========================================
// PACKAGES PAGE — Julian Mercer Ergonomics
// ==========================================

export default function PackagesPage() {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<PublicPackage | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    listPackages(true)
      .then(setPackages)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(pkg: PublicPackage) {
    try {
      await updatePackage({ packageId: pkg.id, isActive: !pkg.isActive });
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleDelete(pkg: PublicPackage) {
    if (!window.confirm(t("sa.packages.deleteConfirm"))) return;
    try {
      await deletePackage(pkg.id);
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div style={{ height: "100%", position: "relative", display: "flex", flexDirection: "column", background: "transparent" }}>
      {/* Top Command Toolbar (Single, Airy, Anti-Slop) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "28px 36px 12px",
          background: "transparent",
          flexWrap: "wrap",
        }}
      >
        <div>
          <Text fw={600} size="lg" style={{ color: SA.text, fontSize: 22, letterSpacing: -0.4 }}>
            Subscription Plans & Quotas
          </Text>
          <Text size="xs" mt={3} style={{ color: SA.muted, fontSize: 13 }}>
            Configure commercial pricing tiers, module access limits, and storage quotas for all ERP tenants.
          </Text>
        </div>

        <Group gap="sm">
          <Button
            variant="subtle"
            size="sm"
            loading={loading}
            leftSection={<RefreshCw size={14} />}
            onClick={load}
            styles={{
              root: {
                background: SA.panelStrong,
                color: SA.text,
                fontWeight: 700,
                borderRadius: 8,
                height: 40,
                paddingInline: 18,
                "&:hover": { background: SA.panelHover, color: SA.accent },
              },
            }}
          >
            {t("sa.tenants.refresh")}
          </Button>

          <Button
            size="sm"
            leftSection={<Plus size={15} />}
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
            styles={{
              root: {
                background: SA.accent,
                color: SA.accentOnAccent,
                fontWeight: 750,
                borderRadius: 8,
                height: 40,
                paddingInline: 20,
                boxShadow: "0 2px 8px -1px rgba(194, 65, 12, 0.35)",
                "&:hover": { background: SA.accentHover },
              },
            }}
          >
            {t("sa.packages.create")}
          </Button>
        </Group>
      </div>

      {error && (
        <Alert color="red" mx={36} mt="xs" icon={<Info size={16} />} radius="md">
          {error}
        </Alert>
      )}

      {/* Package Grid Canvas */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 36px 36px" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          {packages.length === 0 ? (
            <div
              style={{
                borderRadius: 8,
                border: `1px dashed ${SA.borderStrong}`,
                padding: "80px 32px",
                textAlign: "center",
                background: SA.panel,
              }}
            >
              <ThemeIcon
                size={60}
                radius="xl"
                styles={{
                  root: {
                    background: SA.panelStrong,
                    color: SA.muted,
                    margin: "0 auto 18px",
                  },
                }}
              >
                <Boxes size={28} />
              </ThemeIcon>
              <Text fw={600} size="lg" style={{ color: SA.text }}>
                {t("sa.packages.empty")}
              </Text>
              <Text size="sm" mt={6} style={{ color: SA.muted }}>
                Click &quot;New Plan&quot; above to create your first pricing tier.
              </Text>
            </div>
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing={28}>
              {packages.map((pkg) => {
                  // Resolve features list
                  let featureList: string[] = [];
                  if (Array.isArray(pkg.features)) {
                    featureList = pkg.features.map(String);
                  } else if (pkg.features && typeof pkg.features === "object") {
                    featureList = Object.keys(pkg.features);
                  }

                  const isEnterprise = pkg.name.toLowerCase().includes("enterprise");
                  const isPro = pkg.name.toLowerCase().includes("pro");

                  return (
                    <div
                      key={pkg.id}
                      style={{
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: 8,
                        background: SA.panel,
                        border: pkg.isActive
                          ? `1px solid ${SA.borderStrong}`
                          : `1px solid ${SA.border}`,
                        padding: "34px 30px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        boxShadow: "none",
                        transition: "all 0.25s ease",
                      }}
                    >
                      {/* Top Header */}
                      <div>
                        <Group justify="space-between" align="flex-start" wrap="nowrap" mb={16}>
                          <Group gap="md" wrap="nowrap">
                            <div
                              style={{
                                width: 52,
                                height: 52,
                                borderRadius: 16,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: SA.accent,
                                color: SA.dockActiveColor,
                                boxShadow: "none",
                                flexShrink: 0,
                              }}
                            >
                              {isEnterprise ? <Zap size={24} /> : isPro ? <Cpu size={24} /> : <Boxes size={24} />}
                            </div>

                            <Stack gap={4}>
                              <Text fw={650} size="lg" style={{ color: SA.text, fontSize: 20, letterSpacing: -0.4 }} truncate>
                                {pkg.name}
                              </Text>

                              <Group gap={6}>
                                <div
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    padding: "3px 10px",
                                    borderRadius: 8,
                                    background: pkg.isActive ? SA.panelMint : "rgba(0,0,0,0.06)",
                                    color: pkg.isActive ? SA.success : SA.muted,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.4,
                                  }}
                                >
                                  {pkg.isActive ? "Active" : "Draft"}
                                </div>
                                <Text size="xs" fw={700} style={{ color: SA.muted, textTransform: "uppercase", letterSpacing: 0.5, fontSize: 11 }}>
                                  · {pkg.billingCycle}
                                </Text>
                              </Group>
                            </Stack>
                          </Group>

                          <Tooltip label={pkg.isActive ? "Deactivate plan" : "Activate plan"}>
                            <Switch
                              size="md"
                              checked={pkg.isActive}
                              onChange={() => toggleActive(pkg)}
                              color="teal"
                            />
                          </Tooltip>
                        </Group>

                        {/* Description */}
                        <Text size="xs" style={{ color: SA.textSoft, fontSize: 13, lineHeight: 1.6, minHeight: 40, marginBlock: "12px 18px" }}>
                          {pkg.description || "Comprehensive ERP suite with point of sale and reporting."}
                        </Text>

                        {/* Price Hero Section (Direct Typographic Hero — No AI Gray Box) */}
                        <div style={{ marginBottom: 20 }}>
                          <Text size="10px" fw={600} style={{ color: SA.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                            Subscription Rate
                          </Text>
                          <Group align="baseline" gap={8} mt={4}>
                            <Text style={{ fontSize: 34, fontWeight: 650, color: SA.text, letterSpacing: -1, fontVariantNumeric: "tabular-nums" }}>
                              PKR {pkg.price.toLocaleString()}
                            </Text>
                            <Text size="xs" style={{ color: SA.muted, fontWeight: 600, fontSize: 13 }}>
                              / {pkg.billingCycle}
                            </Text>
                          </Group>
                        </div>

                        {/* Resource Quota Pills */}
                        <Group gap={8} wrap="wrap" mb={20}>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 14px",
                              borderRadius: 8,
                              background: SA.panelStrong,
                              fontSize: 12,
                              fontWeight: 700,
                              color: SA.text,
                            }}
                          >
                            <Users size={13} style={{ color: SA.accent }} />
                            <span>{pkg.maxUsers} Users</span>
                          </div>

                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 14px",
                              borderRadius: 8,
                              background: SA.panelStrong,
                              fontSize: 12,
                              fontWeight: 700,
                              color: SA.text,
                            }}
                          >
                            <GitBranch size={13} style={{ color: SA.accent }} />
                            <span>{pkg.maxBranches} {pkg.maxBranches === 1 ? "Branch" : "Branches"}</span>
                          </div>

                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 14px",
                              borderRadius: 8,
                              background: SA.panelStrong,
                              fontSize: 12,
                              fontWeight: 700,
                              color: SA.text,
                            }}
                          >
                            <HardDrive size={13} style={{ color: SA.accent }} />
                            <span>
                              {pkg.maxStorageMb >= 1024
                                ? `${(pkg.maxStorageMb / 1024).toFixed(0)} GB`
                                : `${pkg.maxStorageMb} MB`}
                            </span>
                          </div>
                        </Group>

                        {/* Capabilities Checklist */}
                        {featureList.length > 0 && (
                          <Stack gap={10} style={{ borderTop: `1px solid ${SA.border}`, paddingTop: 18, marginBottom: 22 }}>
                            <Text size="10px" fw={600} style={{ color: SA.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                              Included Modules & Features
                            </Text>
                            {featureList.slice(0, 5).map((feat, idx) => (
                              <Group key={idx} gap={10} wrap="nowrap" align="center">
                                <div
                                  style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: "50%",
                                    background: SA.panelMint,
                                    color: SA.accent,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                  }}
                                >
                                  <Check size={11} strokeWidth={3} />
                                </div>
                                <Text size="xs" fw={600} style={{ color: SA.text, fontSize: 13 }} truncate>
                                  {feat}
                                </Text>
                              </Group>
                            ))}
                          </Stack>
                        )}
                      </div>

                      {/* Action Footer Buttons (Continuous Pill afffordances) */}
                      <Group gap="sm" style={{ borderTop: `1px solid ${SA.border}`, paddingTop: 18 }}>
                        <Button
                          fullWidth
                          variant="subtle"
                          size="md"
                          leftSection={<Pencil size={15} />}
                          onClick={() => {
                            setEditing(pkg);
                            setEditorOpen(true);
                          }}
                          styles={{
                            root: {
                              background: SA.panelStrong,
                              color: SA.text,
                              fontWeight: 700,
                              fontSize: 13,
                              borderRadius: 8,
                              height: 42,
                              flex: 1,
                              "&:hover": { background: SA.panelHover, color: SA.accent },
                            },
                          }}
                        >
                          {t("sa.packages.edit")}
                        </Button>
                        <Tooltip label={t("sa.packages.delete")}>
                          <Button
                            variant="subtle"
                            color="red"
                            size="md"
                            onClick={() => handleDelete(pkg)}
                            styles={{
                              root: {
                                borderRadius: 8,
                                height: 42,
                                width: 42,
                                padding: 0,
                                background: "rgba(239,68,68,0.08)",
                                color: SA.danger,
                                "&:hover": { background: "rgba(239,68,68,0.16)" },
                              },
                            }}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </Tooltip>
                      </Group>
                    </div>
                  );
                })}
            </SimpleGrid>
          )}
        </div>
      </div>

      <PackageEditorModal
        opened={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={load}
        editing={editing}
      />
    </div>
  );
}
