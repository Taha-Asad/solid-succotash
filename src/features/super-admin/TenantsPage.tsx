// ==========================================
// TENANTS — Super Admin company management
// ==========================================

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  Alert,
  Badge,
  Button,
  Group,
  LoadingOverlay,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  Building2,
  ChevronRight,
  Info,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";

import {
  getErrorMessage,
  listTenantCompanies,
} from "../../api/backend";
import type {
  PublicCompany,
  TenantCompanySummary,
} from "../../types/backend";
import { useI18n } from "../../i18n/I18nProvider";
import { useSaTheme } from "./saTheme.tsx";
import { SubBadge } from "./TenantComponents";
import RegisterTenantModal from "./RegisterTenantModal";
import EditTenantModal from "./EditTenantModal";
import TenantDetailDrawer from "./TenantDetailDrawer";

export default function TenantsPage() {
  const { t } = useI18n();
  const SA = useSaTheme();
  const [tenants, setTenants] = useState<TenantCompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "archived">("all");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selected, setSelected] = useState<TenantCompanySummary | null>(null);
  const [editCompany, setEditCompany] = useState<PublicCompany | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    listTenantCompanies()
      .then(setTenants)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = tenants.filter((tenant) => {
    const matchesQuery =
      !query ||
      tenant.name.toLowerCase().includes(query.toLowerCase()) ||
      (tenant.email ?? "").toLowerCase().includes(query.toLowerCase()) ||
      (tenant.phone ?? "").includes(query);
    const matchesStatus =
      status === "all" ||
      (status === "active" && tenant.isActive) ||
      (status === "archived" && !tenant.isActive);
    return matchesQuery && matchesStatus;
  });

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      <LoadingOverlay visible={loading} />

      {/* Command Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "20px 28px",
          background: SA.bgSidebar,
          borderBottom: `1px solid ${SA.border}`,
          flexWrap: "wrap",
        }}
      >
        <Group gap="md">
          <TextInput
            placeholder={t("sa.tenants.searchPh")}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={280}
            leftSection={<Search size={15} style={{ color: SA.muted }} />}
            radius="md"
            styles={{
              input: {
                background: SA.panel,
                border: `1px solid ${SA.border}`,
                color: SA.text,
                fontWeight: 500,
              },
            }}
          />
          <Select
            value={status}
            onChange={(v) => setStatus((v as typeof status) ?? "all")}
            data={[
              { value: "all", label: `${t("sa.tenants.filter.all")} (${tenants.length})` },
              { value: "active", label: `${t("sa.tenants.filter.active")} (${tenants.filter((x) => x.isActive).length})` },
              { value: "archived", label: `${t("sa.tenants.filter.archived")} (${tenants.filter((x) => !x.isActive).length})` },
            ]}
            w={160}
            radius="md"
            styles={{
              input: {
                background: SA.panel,
                border: `1px solid ${SA.border}`,
                color: SA.text,
                fontWeight: 600,
              },
            }}
          />
          <Badge
            size="lg"
            variant="filled"
            styles={{
              root: {
                background: SA.panelStrong,
                color: SA.textSoft,
                border: `1px solid ${SA.border}`,
                fontWeight: 700,
              },
            }}
          >
            {filtered.length} {filtered.length === 1 ? "Organization" : "Organizations"}
          </Badge>
        </Group>

        <Group gap="sm">
          <Tooltip label="Refresh directory">
            <Button
              variant="light"
              size="sm"
              leftSection={<RefreshCw size={14} />}
              onClick={load}
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
          </Tooltip>

          <Button
            size="sm"
            leftSection={<Plus size={15} />}
            onClick={() => setRegisterOpen(true)}
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
            {t("sa.tenants.registerButton")}
          </Button>
        </Group>
      </div>

      {error && (
        <Alert color="red" mx={28} mt="md" icon={<Info size={16} />}>
          {error}
        </Alert>
      )}

      {/* Directory List */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <AnimatePresence mode="popLayout">
            {filtered.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  borderRadius: 18,
                  border: `1px dashed ${SA.borderStrong}`,
                  padding: 60,
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
                  <Building2 size={24} />
                </ThemeIcon>
                <Text fw={700} size="md" style={{ color: SA.text }}>
                  {t("sa.tenants.empty")}
                </Text>
                <Text size="sm" mt={4} style={{ color: SA.muted }}>
                  Try adjusting your search query or status filter.
                </Text>
              </motion.div>
            ) : (
              <Stack gap={12}>
                {filtered.map((tenant, i) => {
                  const initial = (tenant.name || "W").slice(0, 1).toUpperCase();
                  const isSelected = selected?.id === tenant.id;

                  return (
                    <motion.div
                      key={tenant.id}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.25 }}
                      whileHover={{ y: -2 }}
                      onClick={() => setSelected(tenant)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        padding: "16px 20px",
                        borderRadius: 16,
                        background: isSelected ? SA.panelStrong : SA.panel,
                        border: `1px solid ${isSelected ? SA.accent : SA.border}`,
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        boxShadow: isSelected
                          ? `0 0 0 1px ${SA.accent}, 0 12px 28px -10px rgba(0,0,0,0.5)`
                          : "0 2px 8px rgba(0,0,0,0.2)",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.borderColor = SA.borderStrong;
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.borderColor = SA.border;
                      }}
                    >
                      {/* Avatar Mark */}
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 14,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: tenant.isActive
                            ? "linear-gradient(135deg, rgba(2,132,199,0.2), rgba(37,99,235,0.12))"
                            : SA.panelStrong,
                          border: `1px solid ${tenant.isActive ? "rgba(2,132,199,0.4)" : SA.border}`,
                          color: tenant.isActive ? SA.accent : SA.muted,
                          fontWeight: 800,
                          fontSize: 18,
                          flexShrink: 0,
                        }}
                      >
                        {initial}
                      </div>

                      {/* Main Info */}
                      <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                          <Text fw={800} size="md" style={{ color: SA.text, letterSpacing: -0.2 }} truncate>
                            {tenant.name}
                          </Text>
                          {tenant.packageName && (
                            <Badge
                              size="xs"
                              variant="filled"
                              styles={{
                                root: {
                                  background: `${SA.accent}1f`,
                                  color: SA.accent,
                                  border: `1px solid ${SA.accent}44`,
                                  fontWeight: 800,
                                },
                              }}
                            >
                              {tenant.packageName}
                            </Badge>
                          )}
                        </Group>

                        <Group gap="md" wrap="wrap">
                          {tenant.email && (
                            <Group gap={4}>
                              <Mail size={12} style={{ color: SA.muted }} />
                              <Text size="xs" style={{ color: SA.textSoft }} truncate>
                                {tenant.email}
                              </Text>
                            </Group>
                          )}
                          {tenant.phone && (
                            <Group gap={4}>
                              <Phone size={12} style={{ color: SA.muted }} />
                              <Text size="xs" style={{ color: SA.textSoft }}>
                                {tenant.phone}
                              </Text>
                            </Group>
                          )}
                          <Group gap={4}>
                            <Users size={12} style={{ color: SA.muted }} />
                            <Text size="xs" style={{ color: SA.muted }}>
                              {tenant.userCount} {tenant.userCount === 1 ? "seat" : "seats"}
                            </Text>
                          </Group>
                        </Group>
                      </Stack>

                      {/* Right Metadata & Statuses */}
                      <Group gap="sm" align="center" style={{ flexShrink: 0 }}>
                        <SubBadge status={tenant.subscriptionStatus} />
                        <Badge
                          size="sm"
                          variant="filled"
                          styles={{
                            root: {
                              background: tenant.isActive ? "#064E3B" : "#1E293B",
                              color: tenant.isActive ? "#6EE7B7" : "#94A3B8",
                              border: `1px solid ${tenant.isActive ? "#059669" : "#475569"}`,
                              fontWeight: 700,
                            },
                          }}
                        >
                          {t(tenant.isActive ? "sa.status.active" : "sa.status.archived")}
                        </Badge>
                        <ChevronRight size={18} style={{ color: SA.muted }} />
                      </Group>
                    </motion.div>
                  );
                })}
              </Stack>
            )}
          </AnimatePresence>
        </div>
      </div>

      <RegisterTenantModal
        opened={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onCreated={load}
      />
      <TenantDetailDrawer
        tenant={selected}
        onClose={() => setSelected(null)}
        onChanged={load}
        onEdit={(company) => {
          setEditCompany(company);
          setEditOpen(true);
        }}
        refreshKey={refreshKey}
      />
      <EditTenantModal
        company={editCompany}
        opened={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          load();
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
