// ==========================================
// PACKAGES — Super Admin plan management
// ==========================================

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  Alert,
  Badge,
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
          <ThemeIcon size={32} radius="md" styles={{ root: { background: SA.gradient, color: "#06121F" } }}>
            <Sparkles size={16} />
          </ThemeIcon>
          <Text fw={800} size="md" style={{ color: SA.text, letterSpacing: -0.3 }}>
            {editing ? t("sa.packages.edit") : t("sa.packages.create")}
          </Text>
        </Group>
      }
      size="lg"
      centered
      radius="xl"
      overlayProps={{ blur: 5, backgroundOpacity: 0.6 }}
      styles={{
        content: {
          background: SA.panel,
          border: `1px solid ${SA.border}`,
          boxShadow: "0 24px 60px -15px rgba(0,0,0,0.4)",
        },
        header: {
          background: SA.panel,
          borderBottom: `1px solid ${SA.border}`,
          padding: "18px 24px",
        },
        body: { padding: "24px" },
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
          <Alert color="red" icon={<Info size={16} />} radius="md" styles={{ root: { color: "#F87171" } }}>
            {error}
          </Alert>
        )}

        <Divider style={{ borderColor: SA.border }} />

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" color="gray" onClick={onClose} radius="md">
            {t("sa.common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            loading={loading}
            radius="md"
            styles={{
              root: {
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 800,
                padding: "0 24px",
                "&:hover": { filter: "brightness(1.08)" },
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
    <div style={{ height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
      <LoadingOverlay visible={loading} />

      {/* Top Command Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "20px 32px",
          background: SA.bgSidebar,
          borderBottom: `1px solid ${SA.border}`,
          flexWrap: "wrap",
        }}
      >
        <div>
          <Text fw={800} size="lg" style={{ color: SA.text, letterSpacing: -0.3 }}>
            Subscription Plans & Quotas
          </Text>
          <Text size="xs" mt={2} style={{ color: SA.textSoft }}>
            Configure commercial pricing tiers, module access limits, and storage quotas for all ERP tenants.
          </Text>
        </div>

        <Group gap="sm">
          <Button
            variant="light"
            size="sm"
            leftSection={<RefreshCw size={14} />}
            onClick={load}
            radius="md"
            styles={{
              root: {
                background: SA.panel,
                color: SA.text,
                border: `1px solid ${SA.border}`,
                fontWeight: 600,
                "&:hover": { background: SA.panelHover },
              },
            }}
          >
            {t("sa.tenants.refresh")}
          </Button>

          <Button
            size="sm"
            radius="md"
            leftSection={<Plus size={15} />}
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
            styles={{
              root: {
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 800,
                boxShadow: "0 6px 20px -6px rgba(2,132,199,0.5)",
                "&:hover": { filter: "brightness(1.08)" },
              },
            }}
          >
            {t("sa.packages.create")}
          </Button>
        </Group>
      </div>

      {error && (
        <Alert color="red" mx={32} mt="md" icon={<Info size={16} />} radius="md">
          {error}
        </Alert>
      )}

      {/* Package Grid Canvas */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "28px 32px" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          {packages.length === 0 ? (
            <div
              style={{
                borderRadius: 22,
                border: `1px dashed ${SA.borderStrong}`,
                padding: "60px 24px",
                textAlign: "center",
                background: SA.panel,
              }}
            >
              <ThemeIcon
                size={52}
                radius="xl"
                styles={{
                  root: {
                    background: SA.panelStrong,
                    color: SA.muted,
                    margin: "0 auto 16px",
                    border: `1px solid ${SA.border}`,
                  },
                }}
              >
                <Boxes size={24} />
              </ThemeIcon>
              <Text fw={700} size="md" style={{ color: SA.text }}>
                {t("sa.packages.empty")}
              </Text>
              <Text size="sm" mt={4} style={{ color: SA.muted }}>
                Click &quot;New Plan&quot; above to create your first pricing tier.
              </Text>
            </div>
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing={24}>
              <AnimatePresence>
                {packages.map((pkg, i) => {
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
                    <motion.div
                      key={pkg.id}
                      layout
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      whileHover={{ y: -6, boxShadow: "0 20px 40px -15px rgba(2,132,199,0.2)" }}
                      style={{
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: 22,
                        background: SA.panel,
                        border: `1px solid ${pkg.isActive ? SA.border : SA.borderStrong}`,
                        padding: "26px 28px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        boxShadow: "0 4px 18px rgba(0,0,0,0.06)",
                        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
                      }}
                    >
                      {/* Top Header */}
                      <div>
                        <Group justify="space-between" align="flex-start" wrap="nowrap" mb={14}>
                          <Group gap="sm" wrap="nowrap">
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                borderRadius: 14,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: isEnterprise
                                  ? "linear-gradient(135deg, #10B981, #059669)"
                                  : isPro
                                  ? "linear-gradient(135deg, #0284C7, #2563EB)"
                                  : SA.gradient,
                                color: isEnterprise || isPro ? "#FFFFFF" : "#06121F",
                                boxShadow: "0 8px 20px -6px rgba(2,132,199,0.4)",
                                flexShrink: 0,
                              }}
                            >
                              {isEnterprise ? <Zap size={22} /> : isPro ? <Cpu size={22} /> : <Boxes size={22} />}
                            </div>

                            <Stack gap={2}>
                              <Group gap={6} wrap="nowrap">
                                <Text fw={800} size="md" style={{ color: SA.text, letterSpacing: -0.3 }}>
                                  {pkg.name}
                                </Text>
                                <Badge
                                  size="xs"
                                  variant="filled"
                                  styles={{
                                    root: {
                                      background: pkg.isActive ? "rgba(16,185,129,0.15)" : SA.panelStrong,
                                      color: pkg.isActive ? "#10B981" : SA.muted,
                                      border: `1px solid ${pkg.isActive ? "rgba(16,185,129,0.3)" : SA.border}`,
                                      fontWeight: 800,
                                      textTransform: "uppercase",
                                    },
                                  }}
                                >
                                  {pkg.isActive ? "Active" : "Draft"}
                                </Badge>
                              </Group>

                              <Text size="xs" fw={600} style={{ color: SA.muted }}>
                                {pkg.billingCycle.toUpperCase()}
                              </Text>
                            </Stack>
                          </Group>

                          <Tooltip label={pkg.isActive ? "Deactivate plan" : "Activate plan"}>
                            <Switch
                              size="sm"
                              checked={pkg.isActive}
                              onChange={() => toggleActive(pkg)}
                              color="teal"
                            />
                          </Tooltip>
                        </Group>

                        {/* Description */}
                        <Text size="xs" style={{ color: SA.textSoft, lineHeight: 1.6, minHeight: 40, marginBottom: 16 }}>
                          {pkg.description || "Comprehensive ERP suite with point of sale and reporting."}
                        </Text>

                        {/* Price Hero Section */}
                        <div
                          style={{
                            background: SA.panelStrong,
                            borderRadius: 14,
                            padding: "14px 18px",
                            border: `1px solid ${SA.border}`,
                            marginBottom: 16,
                          }}
                        >
                          <Text size="xs" fw={700} style={{ color: SA.accent, textTransform: "uppercase", letterSpacing: 0.8 }}>
                            Subscription Pricing
                          </Text>
                          <Group align="baseline" gap={6} mt={2}>
                            <Text style={{ fontSize: 28, fontWeight: 900, color: SA.text, letterSpacing: -0.8 }}>
                              PKR {pkg.price.toLocaleString()}
                            </Text>
                            <Text size="xs" style={{ color: SA.muted, fontWeight: 600 }}>
                              / {pkg.billingCycle}
                            </Text>
                          </Group>
                        </div>

                        {/* Resource Quota Pills */}
                        <Group gap={8} wrap="wrap" mb={16}>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 12px",
                              borderRadius: 10,
                              background: SA.panelStrong,
                              border: `1px solid ${SA.border}`,
                              fontSize: 12,
                              fontWeight: 600,
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
                              padding: "6px 12px",
                              borderRadius: 10,
                              background: SA.panelStrong,
                              border: `1px solid ${SA.border}`,
                              fontSize: 12,
                              fontWeight: 600,
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
                              padding: "6px 12px",
                              borderRadius: 10,
                              background: SA.panelStrong,
                              border: `1px solid ${SA.border}`,
                              fontSize: 12,
                              fontWeight: 600,
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
                          <Stack gap={8} style={{ borderTop: `1px solid ${SA.border}`, paddingTop: 14, marginBottom: 18 }}>
                            <Text size="xs" fw={700} style={{ color: SA.muted, textTransform: "uppercase", letterSpacing: 0.8 }}>
                              Key Capabilities
                            </Text>
                            {featureList.slice(0, 4).map((feat, idx) => (
                              <Group key={idx} gap={8} wrap="nowrap" align="center">
                                <ThemeIcon size={18} radius="xl" variant="light" color="teal">
                                  <Check size={11} strokeWidth={3} />
                                </ThemeIcon>
                                <Text size="xs" fw={500} style={{ color: SA.textSoft }} truncate>
                                  {feat}
                                </Text>
                              </Group>
                            ))}
                          </Stack>
                        )}
                      </div>

                      {/* Action Footer Buttons */}
                      <Group gap="sm" style={{ borderTop: `1px solid ${SA.border}`, paddingTop: 16 }}>
                        <Button
                          fullWidth
                          variant="light"
                          size="sm"
                          leftSection={<Pencil size={14} />}
                          onClick={() => {
                            setEditing(pkg);
                            setEditorOpen(true);
                          }}
                          styles={{
                            root: {
                              background: SA.panelStrong,
                              color: SA.text,
                              border: `1px solid ${SA.border}`,
                              fontWeight: 700,
                              borderRadius: 12,
                              flex: 1,
                              "&:hover": { background: SA.panelHover, borderColor: SA.accent },
                            },
                          }}
                        >
                          {t("sa.packages.edit")}
                        </Button>
                        <Tooltip label={t("sa.packages.delete")}>
                          <Button
                            variant="subtle"
                            color="red"
                            size="sm"
                            onClick={() => handleDelete(pkg)}
                            styles={{
                              root: {
                                borderRadius: 12,
                                padding: "0 12px",
                                "&:hover": { background: "rgba(239,68,68,0.12)" },
                              },
                            }}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </Tooltip>
                      </Group>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
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
