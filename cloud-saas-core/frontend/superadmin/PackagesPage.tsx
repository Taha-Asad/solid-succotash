// ==========================================
// PACKAGES — Super Admin plan management
// ==========================================

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  Alert,
  Badge,
  Button,
  Group,
  LoadingOverlay,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import {
  Boxes,
  GitBranch,
  HardDrive,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
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
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: 0,
    billingCycle: "monthly",
    maxUsers: 5,
    maxBranches: 1,
    maxStorageMb: 100,
    moduleLimits: "{}",
    features: "{}",
  });

  useEffect(() => {
    if (!opened) return;
    setError("");
    setForm(
      editing
        ? {
            name: editing.name,
            description: editing.description ?? "",
            price: editing.price,
            billingCycle: editing.billingCycle,
            maxUsers: editing.maxUsers,
            maxBranches: editing.maxBranches,
            maxStorageMb: editing.maxStorageMb,
            moduleLimits: JSON.stringify(editing.moduleLimits),
            features: JSON.stringify(editing.features),
          }
        : {
            name: "",
            description: "",
            price: 0,
            billingCycle: "monthly",
            maxUsers: 5,
            maxBranches: 1,
            maxStorageMb: 100,
            moduleLimits: "{}",
            features: "{}",
          },
    );
  }, [opened, editing]);

  async function handleSave() {
    setError("");
    if (form.name.trim().length < 2) {
      setError(t("sa.packages.nameRequired"));
      return;
    }
    setLoading(true);
    try {
      const base: CreatePackageInput = {
        name: form.name.trim(),
        description: form.description || null,
        price: form.price,
        billingCycle: form.billingCycle,
        maxUsers: form.maxUsers,
        maxBranches: form.maxBranches,
        maxStorageMb: form.maxStorageMb,
        moduleLimits: form.moduleLimits,
        features: form.features,
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
      title={editing ? t("sa.packages.edit") : t("sa.packages.create")}
      size="lg"
      centered
      overlayProps={{ blur: 4, backgroundOpacity: 0.6 }}
      styles={{ header: { fontWeight: 800 } }}
    >
      <LoadingOverlay visible={loading} />
      <Stack gap="sm">
        <TextInput
          label={t("sa.packages.name")}
          required
          value={form.name}
          onChange={(e) => {
            const name = e.currentTarget.value;
            setForm((f) => ({ ...f, name }));
          }}
        />
        <TextInput
          label={t("sa.packages.description")}
          value={form.description}
          onChange={(e) => {
            const description = e.currentTarget.value;
            setForm((f) => ({ ...f, description }));
          }}
        />
        <SimpleGrid cols={2} spacing="sm">
          <NumberInput
            label={t("sa.packages.price")}
            value={form.price}
            onChange={(v) => setForm((f) => ({ ...f, price: Number(v) || 0 }))}
            min={0}
            decimalScale={2}
          />
          <Select
            label={t("sa.packages.billingCycle")}
            data={["monthly", "yearly", "quarterly", "one_time"]}
            value={form.billingCycle}
            onChange={(v) => setForm((f) => ({ ...f, billingCycle: v ?? "monthly" }))}
          />
        </SimpleGrid>
        <SimpleGrid cols={3} spacing="sm">
          <NumberInput
            label={t("sa.packages.maxUsers")}
            value={form.maxUsers}
            onChange={(v) => setForm((f) => ({ ...f, maxUsers: Number(v) || 0 }))}
            min={0}
            leftSection={<Users size={14} />}
          />
          <NumberInput
            label={t("sa.packages.maxBranches")}
            value={form.maxBranches}
            onChange={(v) => setForm((f) => ({ ...f, maxBranches: Number(v) || 0 }))}
            min={0}
            leftSection={<GitBranch size={14} />}
          />
          <NumberInput
            label={t("sa.packages.maxStorage")}
            value={form.maxStorageMb}
            onChange={(v) => setForm((f) => ({ ...f, maxStorageMb: Number(v) || 0 }))}
            min={0}
            leftSection={<HardDrive size={14} />}
          />
        </SimpleGrid>
        <TextInput
          label="module_limits (JSON)"
          value={form.moduleLimits}
          onChange={(e) => {
            const moduleLimits = e.currentTarget.value;
            setForm((f) => ({ ...f, moduleLimits }));
          }}
          placeholder='{"sales":1,"inventory":1}'
        />
        <TextInput
          label="features (JSON)"
          value={form.features}
          onChange={(e) => {
            const features = e.currentTarget.value;
            setForm((f) => ({ ...f, features }));
          }}
          placeholder='{"fbr":true}'
        />
        {error && (
          <Alert color="red" icon={<Info size={16} />} styles={{ root: { color: "#F87171" } }}>
            {error}
          </Alert>
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="light" onClick={onClose}>
            {t("sa.common.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            loading={loading}
            styles={{
              root: {
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 700,
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
// PACKAGES PAGE
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
    <div style={{ height: "100%", position: "relative" }}>
      <LoadingOverlay visible={loading} />

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "20px 28px",
        }}
      >
        <Text size="sm" style={{ color: SA.textSoft }}>
          {t("sa.packages.subtitle")}
        </Text>
        <Group gap="sm">
          <Button variant="light" size="sm" leftSection={<RefreshCw size={14} />} onClick={load}>
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
                background: SA.gradient,
                color: "#06121F",
                fontWeight: 700,
                boxShadow: "0 10px 26px -10px rgba(56,189,248,0.7)",
                "&:hover": { filter: "brightness(1.08)" },
              },
            }}
          >
            {t("sa.packages.create")}
          </Button>
        </Group>
      </div>

      {error && (
        <Alert color="red" mx={28} mb="sm" icon={<Info size={16} />}>
          {error}
        </Alert>
      )}

      <div style={{ padding: "0 28px 28px", maxWidth: 1180, margin: "0 auto" }}>
        {packages.length === 0 ? (
          <div
            style={{
              borderRadius: 18,
              border: `1px dashed ${SA.borderStrong}`,
              padding: 48,
              textAlign: "center",
              background: SA.panel,
            }}
          >
            <Text size="sm" style={{ color: SA.muted }}>
              {t("sa.packages.empty")}
            </Text>
          </div>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing={16}>
            <AnimatePresence>
              {packages.map((pkg, i) => (
                <motion.div
                  key={pkg.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: Math.min(i * 0.06, 0.4), duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -5 }}
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    borderRadius: 18,
                    background: SA.panel,
                    border: `1px solid ${SA.border}`,
                    padding: "20px 20px 16px",
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: -50,
                      insetInlineEnd: -50,
                      width: 130,
                      height: 130,
                      borderRadius: "50%",
                      background: "radial-gradient(circle, rgba(56,189,248,0.18), transparent 70%)",
                    }}
                  />
                  <Stack gap={10} style={{ position: "relative" }}>
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="sm">
                        <div
                          style={{
                            width: 42,
                            height: 42,
                            borderRadius: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: SA.gradient,
                            color: "#06121F",
                            boxShadow: "0 8px 20px -8px rgba(56,189,248,0.6)",
                          }}
                        >
                          <Boxes size={20} />
                        </div>
                        <Stack gap={0}>
                          <Text fw={800} size="md" style={{ color: SA.text, letterSpacing: -0.2 }}>
                            {pkg.name}
                          </Text>
                          <Text size="xs" style={{ color: SA.muted }}>
                            {pkg.billingCycle}
                          </Text>
                        </Stack>
                      </Group>
                      <Switch
                        size="sm"
                        checked={pkg.isActive}
                        onChange={() => toggleActive(pkg)}
                        color="cyan"
                        label={pkg.isActive ? "ON" : "OFF"}
                        labelPosition="left"
                      />
                    </Group>

                    <Text size="sm" style={{ color: SA.textSoft, lineHeight: 1.55, minHeight: 42 }}>
                      {pkg.description || "—"}
                    </Text>

                    <Text fw={800} size="xl" style={{ color: SA.text, letterSpacing: -0.5 }}>
                      {pkg.price.toLocaleString()}
                      <Text component="span" size="sm" style={{ color: SA.muted, fontWeight: 500 }}>
                        {" "}
                        / {pkg.billingCycle}
                      </Text>
                    </Text>

                    <Group gap={6}>
                      <Badge variant="light" styles={{ root: { background: SA.panelStrong, color: SA.textSoft } }}>
                        <Group gap={4}>
                          <Users size={11} /> {pkg.maxUsers}
                        </Group>
                      </Badge>
                      <Badge variant="light" styles={{ root: { background: SA.panelStrong, color: SA.textSoft } }}>
                        <Group gap={4}>
                          <GitBranch size={11} /> {pkg.maxBranches}
                        </Group>
                      </Badge>
                      <Badge variant="light" styles={{ root: { background: SA.panelStrong, color: SA.textSoft } }}>
                        <Group gap={4}>
                          <HardDrive size={11} /> {pkg.maxStorageMb}MB
                        </Group>
                      </Badge>
                    </Group>

                    <Group justify="flex-end" gap={6} mt={4}>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<Pencil size={13} />}
                        onClick={() => {
                          setEditing(pkg);
                          setEditorOpen(true);
                        }}
                      >
                        {t("sa.packages.edit")}
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        leftSection={<Trash2 size={13} />}
                        onClick={() => handleDelete(pkg)}
                      >
                        {t("sa.packages.delete")}
                      </Button>
                    </Group>
                  </Stack>
                </motion.div>
              ))}
            </AnimatePresence>
          </SimpleGrid>
        )}
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
