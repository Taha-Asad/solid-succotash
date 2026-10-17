// ==========================================
// SETTINGS PAGE
// ==========================================
//
// Master hub coordinating business configuration, invoicing rules,
// branding, backup/restore, audit logs, and hardware printer presets.

import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Group,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { ArrowLeft } from "lucide-react";

import type { PublicUser } from "../../types/backend";
import { useI18n } from "../../i18n/I18nProvider";
import SettingsHub, { type SettingsSection } from "./SettingsHub";
import ProfilePage from "../profile/ProfilePage";

import { LanguageTab } from "./tabs/LanguageTab";
import { CompanyProfileTab } from "./tabs/CompanyProfileTab";
import { InvoiceSettingsTab } from "./tabs/InvoiceSettingsTab";
import { ThemeBrandingTab } from "./tabs/ThemeBrandingTab";
import { BackupRestoreTab } from "./tabs/BackupRestoreTab";
import { RetentionTab } from "./tabs/RetentionTab";
import { FbrSettingsTab } from "./tabs/FbrSettingsTab";
import { ModulesTab } from "./tabs/ModulesTab";
import { AuditLogTab } from "./tabs/AuditLogTab";
import { SupportTicketsTab } from "./tabs/SupportTicketsTab";

interface SettingsPageProps {
  user: PublicUser;
  onLogout: () => Promise<void>;
  initialSection?: SettingsSection | null;
  onSectionChange?: (section: SettingsSection | null) => void;
}

export default function SettingsPage({
  user,
  onLogout,
  initialSection = null,
  onSectionChange,
}: SettingsPageProps) {
  const canEdit = user.role === "owner";
  const isAdmin = user.role === "admin" || canEdit;
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSection | null>(initialSection);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-tour="content"]');
    if (el) {
      el.scrollTop = 0;
      el.scrollTo({ top: 0, behavior: "instant" });
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activeSection]);

  function selectSection(sec: SettingsSection | null) {
    setActiveSection(sec);
    onSectionChange?.(sec);
  }

  if (activeSection === null) {
    return <SettingsHub user={user} onSelectSection={selectSection} />;
  }

  // Handle direct full-page User Profile & Personal Appearance
  if (activeSection === "profile" || activeSection === "personal-theme") {
    return (
      <ProfilePage
        user={user}
        onBack={() => selectSection(null)}
        onLogout={onLogout}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Button
          variant="subtle"
          color="gray"
          size="sm"
          leftSection={<ArrowLeft size={16} />}
          onClick={() => selectSection(null)}
          radius="md"
        >
          All Settings
        </Button>
      </Group>

      {/* POS & Thermal Printer Setup */}
      {activeSection === "pos" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Thermal Receipt & Printer Setup</Title>
            <Text size="sm" c="dimmed">
              Configure receipt paper format (80mm / 58mm / A4), header notes, and bottom greetings.
            </Text>
          </Box>
          <InvoiceSettingsTab />
        </Stack>
      )}

      {/* Legal Business Profile */}
      {activeSection === "company" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Legal Business Profile</Title>
            <Text size="sm" c="dimmed">
              Update your registered shop name, official contacts, and FBR tax registrations.
            </Text>
          </Box>
          <CompanyProfileTab />
        </Stack>
      )}

      {/* Invoicing & FBR */}
      {activeSection === "invoicing" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Invoice Format & FBR Tax Integration</Title>
            <Text size="sm" c="dimmed">
              Configure invoice numbering sequence, paper styles, and official FBR digital POS machine.
            </Text>
          </Box>
          <Tabs defaultValue="invoice">
            <Tabs.List mb="md">
              <Tabs.Tab value="invoice">{t("settings.tab.invoice")}</Tabs.Tab>
              {canEdit && <Tabs.Tab value="fbr">FBR Integration</Tabs.Tab>}
            </Tabs.List>
            <Tabs.Panel value="invoice">
              <InvoiceSettingsTab />
            </Tabs.Panel>
            {canEdit && (
              <Tabs.Panel value="fbr">
                <FbrSettingsTab />
              </Tabs.Panel>
            )}
          </Tabs>
        </Stack>
      )}

      {/* Official Branding & Bill Design */}
      {activeSection === "branding" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Official Store Logo & Bill Design</Title>
            <Text size="sm" c="dimmed">
              Upload your high-resolution store logo and tagline printed on customer receipts and invoices.
            </Text>
          </Box>
          <Tabs defaultValue="branding">
            <Tabs.List mb="md">
              <Tabs.Tab value="branding">Store Logo & Colors</Tabs.Tab>
              <Tabs.Tab value="language">{t("settings.tab.language")}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="branding">
              <ThemeBrandingTab />
            </Tabs.Panel>
            <Tabs.Panel value="language">
              <LanguageTab />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}

      {/* Backups & Data Safety */}
      {activeSection === "backup" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Data Safety & Backups</Title>
            <Text size="sm" c="dimmed">
              Save instant database snapshots or restore your historical records.
            </Text>
          </Box>
          <Tabs defaultValue="backup">
            <Tabs.List mb="md">
              <Tabs.Tab value="backup">{t("settings.tab.backup")}</Tabs.Tab>
              {canEdit && <Tabs.Tab value="retention">{t("settings.tab.retention")}</Tabs.Tab>}
            </Tabs.List>
            <Tabs.Panel value="backup">
              <BackupRestoreTab onLogout={onLogout} />
            </Tabs.Panel>
            {canEdit && (
              <Tabs.Panel value="retention">
                <RetentionTab />
              </Tabs.Panel>
            )}
          </Tabs>
        </Stack>
      )}

      {/* Modules & Audit Log */}
      {activeSection === "advanced" && isAdmin && (
        <Stack gap="md">
          <Box>
            <Title order={4}>System Audit & Feature Modules</Title>
            <Text size="sm" c="dimmed">
              Toggle optional business capabilities and review staff audit events.
            </Text>
          </Box>
          <Tabs defaultValue={canEdit ? "modules" : "audit"}>
            <Tabs.List mb="md">
              {canEdit && <Tabs.Tab value="modules">Feature Modules</Tabs.Tab>}
              <Tabs.Tab value="audit">{t("settings.tab.audit")}</Tabs.Tab>
            </Tabs.List>
            {canEdit && (
              <Tabs.Panel value="modules">
                <ModulesTab companyId={user.companyId ?? ""} />
              </Tabs.Panel>
            )}
            <Tabs.Panel value="audit">
              <AuditLogTab />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}

      {/* Subscription & Support Tickets */}
      {activeSection === "support" && (
        <Stack gap="md">
          <Box>
            <Title order={4}>Subscription Plan & Support Tickets</Title>
            <Text size="sm" c="dimmed">
              Manage your Corbel ERP commercial plan, contact Taha Asadullah, or open a support ticket.
            </Text>
          </Box>
          <SupportTicketsTab />
        </Stack>
      )}
    </Stack>
  );
}
