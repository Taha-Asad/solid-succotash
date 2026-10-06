// ==========================================
// TENANTS — Super Admin company management
// ==========================================

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
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
import RegisterTenantDrawer from "./RegisterTenantDrawer";
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
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative", background: "transparent" }}>
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
            Tenant Workspaces
          </Text>
          <Text size="xs" mt={3} style={{ color: SA.muted, fontSize: 13 }}>
            Sovereign commercial organizations, client nodes & cloud database fleet.
          </Text>
        </div>

        <Group gap="sm">
          <TextInput
            placeholder={t("sa.tenants.searchPh")}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            w={240}
            leftSection={<Search size={14} style={{ color: SA.muted }} />}
            styles={{
              input: {
                background: SA.panelStrong,
                border: "none",
                color: SA.text,
                fontWeight: 500,
                borderRadius: 8,
                height: 40,
                fontSize: 13,
              },
            }}
          />

          <Select
            value={status}
            onChange={(v) => setStatus((v as typeof status) ?? "all")}
            data={[
              { value: "all", label: `All (${tenants.length})` },
              { value: "active", label: `Active (${tenants.filter((x) => x.isActive).length})` },
              { value: "archived", label: `Archived (${tenants.filter((x) => !x.isActive).length})` },
            ]}
            w={140}
            styles={{
              input: {
                background: SA.panelStrong,
                border: "none",
                color: SA.text,
                fontWeight: 600,
                borderRadius: 8,
                height: 40,
                fontSize: 13,
              },
            }}
          />

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
            onClick={() => setRegisterOpen(true)}
            styles={{
              root: {
                background: SA.accent,
                color: SA.dockActiveColor,
                fontWeight: 600,
                borderRadius: 8,
                height: 40,
                paddingInline: 20,
                boxShadow: "none",
                "&:hover": { filter: "brightness(1.06)" },
              },
            }}
          >
            {t("sa.tenants.registerButton")}
          </Button>
        </Group>
      </div>

      {error && (
        <Alert color="red" mx={36} mt="xs" icon={<Info size={16} />} radius="md">
          {error}
        </Alert>
      )}

      {/* Directory Canvas */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 36px 36px" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto" }}>
          {/* Fleet Telemetry Hero Bar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                borderRadius: 20,
                padding: "18px 22px",
                background: SA.panelMint,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: SA.accent,
                  color: SA.dockActiveColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Building2 size={20} />
              </div>
              <Stack gap={1}>
                <Text fw={600} size="sm" style={{ color: SA.text, fontSize: 14 }}>
                  {tenants.length} Sovereign Cloud Tenant
                </Text>
                <Text size="xs" style={{ color: SA.muted, fontSize: 12 }}>
                  Active in central Neon DB pool
                </Text>
              </Stack>
            </div>

            <div
              style={{
                borderRadius: 20,
                padding: "18px 22px",
                background: SA.panelStrong,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
              }}
            >
              <Group gap="md">
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    background: "rgba(59, 130, 246, 0.12)",
                    color: SA.accent2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Users size={20} />
                </div>
                <Stack gap={1}>
                  <Text fw={600} size="sm" style={{ color: SA.text, fontSize: 14 }}>
                    5 Distributed Client Deployments
                  </Text>
                  <Text size="xs" style={{ color: SA.muted, fontSize: 12 }}>
                    Distributed desktop instances with local SQLite caches
                  </Text>
                </Stack>
              </Group>

              <Button
                size="xs"
                onClick={() => setRegisterOpen(true)}
                styles={{
                  root: {
                    borderRadius: 8,
                    background: SA.panelHover,
                    color: SA.accent,
                    fontWeight: 700,
                    fontSize: 11,
                    "&:hover": { background: SA.panelMint },
                  },
                }}
              >
                + Provision Node
              </Button>
            </div>
          </div>

          <AnimatePresence mode="popLayout">
            {filtered.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  borderRadius: 8,
                  border: `1px dashed ${SA.borderStrong}`,
                  padding: "60px 24px",
                  textAlign: "center",
                  background: SA.panel,
                }}
              >
                <ThemeIcon
                  size={56}
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
                  <Building2 size={26} />
                </ThemeIcon>
                <Text fw={600} size="md" style={{ color: SA.text }}>
                  {t("sa.tenants.empty")}
                </Text>
                <Text size="sm" mt={4} style={{ color: SA.muted }}>
                  Try adjusting your search query or status filter.
                </Text>
              </motion.div>
            ) : (
              <Stack gap={14}>
                {filtered.map((tenant) => {
                  const initial = (tenant.name || "W").slice(0, 1).toUpperCase();
                  const isSelected = selected?.id === tenant.id;

                  return (
                    <div
                      className="sa-tenant-card"
                      key={tenant.id}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(tenant); } }}
                      onClick={() => setSelected(tenant)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 22,
                        padding: "24px 28px",
                        borderRadius: 8,
                        background: isSelected ? SA.panelHover : SA.panel,
                        border: isSelected
                          ? `1px solid ${SA.accent}`
                          : `1px solid ${SA.border}`,
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        boxShadow: "none",
                      }}
                    >
                      {/* Avatar Mark Squircle */}
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 16,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: tenant.isActive
                            ? SA.panelMint
                            : SA.panelStrong,
                          color: tenant.isActive ? SA.accent : SA.muted,
                          fontWeight: 650,
                          fontSize: 20,
                          flexShrink: 0,
                        }}
                      >
                        {initial}
                      </div>

                      {/* Main Info */}
                      <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                          <Text fw={600} size="md" style={{ color: SA.text, fontSize: 17, letterSpacing: -0.3 }} truncate>
                            {tenant.name}
                          </Text>
                          {tenant.packageName && (
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "3px 10px",
                                borderRadius: 8,
                                background: SA.panelMint,
                                color: SA.success,
                                fontSize: 11,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: 0.4,
                              }}
                            >
                              {tenant.packageName}
                            </div>
                          )}
                        </Group>

                        <Group gap="lg" wrap="wrap">
                          {tenant.email && (
                            <Group gap={6}>
                              <Mail size={13} style={{ color: SA.muted }} />
                              <Text size="xs" style={{ color: SA.textSoft, fontSize: 13 }} truncate>
                                {tenant.email}
                              </Text>
                            </Group>
                          )}
                          {tenant.phone && (
                            <Group gap={6}>
                              <Phone size={13} style={{ color: SA.muted }} />
                              <Text size="xs" style={{ color: SA.textSoft, fontSize: 13 }}>
                                {tenant.phone}
                              </Text>
                            </Group>
                          )}
                          <Group gap={6}>
                            <Users size={13} style={{ color: SA.muted }} />
                            <Text size="xs" style={{ color: SA.muted, fontSize: 13, fontWeight: 600 }}>
                              {tenant.userCount} {tenant.userCount === 1 ? "seat" : "seats"}
                            </Text>
                          </Group>
                        </Group>
                      </Stack>

                      {/* Right Metadata & Statuses */}
                      <Group gap="sm" align="center" style={{ flexShrink: 0 }}>
                        <SubBadge status={tenant.subscriptionStatus} />
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "4px 12px",
                            borderRadius: 8,
                            background: tenant.isActive ? SA.panelMint : SA.panelStrong,
                            color: tenant.isActive ? SA.accent : SA.muted,
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: 0.4,
                          }}
                        >
                          {tenant.isActive ? "Active" : "Archived"}
                        </div>
                        <ChevronRight size={18} style={{ color: SA.muted }} />
                      </Group>
                    </div>
                  );
                })}
              </Stack>
            )}
          </AnimatePresence>
        </div>
      </div>

      <RegisterTenantDrawer
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
