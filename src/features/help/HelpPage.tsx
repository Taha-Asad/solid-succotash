// ==========================================
// HELP & DOCUMENTATION PAGE
// ==========================================
// A searchable, fully-localized wiki for the whole app.
// Left: table of contents. Right: the selected section.
// Blocks support paragraphs, bullets, numbered steps, tips and warnings.

import { useMemo, useState } from "react";

import {
  Alert,
  Badge,
  Box,
  Card,
  Group,
  List,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import {
  BookOpen,
  Boxes,
  CheckCircle2,
  ChartPie,
  CircleHelp,
  ContactRound,
  DatabaseBackup,
  FileText,
  LayoutDashboard,
  Package,
  ReceiptText,
  Search,
  SearchX,
  Settings2,
  ShoppingCart,
  Users,
} from "lucide-react";

import { getHelpDocs, type HelpSection } from "../../i18n/helpDocs";
import { useI18n } from "../../i18n/I18nProvider";
import { INK } from "../../theme";

const SECTION_ICONS: Record<string, React.ReactNode> = {
  "getting-started": <BookOpen size={18} />,
  dashboard: <LayoutDashboard size={18} />,
  inventory: <Package size={18} />,
  invoices: <ReceiptText size={18} />,
  customers: <ContactRound size={18} />,
  purchasing: <ShoppingCart size={18} />,
  reports: <ChartPie size={18} />,
  accounts: <Boxes size={18} />,
  team: <Users size={18} />,
  settings: <Settings2 size={18} />,
  backups: <DatabaseBackup size={18} />,
  faq: <CircleHelp size={18} />,
};

export default function HelpPage({ companyName }: { companyName: string }) {
  const { t, lang } = useI18n();
  const allSections = useMemo(() => getHelpDocs(lang), [lang]);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>(allSections[0]?.id ?? "");

  const q = query.trim().toLowerCase();

  const filtered: HelpSection[] = useMemo(() => {
    if (!q) return allSections;
    return allSections
      .map((section) => ({
        ...section,
        blocks: section.blocks
          .map((block) => {
            const haystack = [
              (block.type === "list" || block.type === "steps" || block.type === "howto")
                ? (block as { items: string[] }).items.join(" ")
                : (block as { text: string }).text ?? "",
              block.type === "howto" ? (block as { title: string }).title : "",
              section.title,
            ]
              .join(" ")
              .toLowerCase();
            return { block, match: haystack.includes(q) };
          })
          .filter((b) => b.match)
          .map((b) => b.block),
      }))
      .filter((s) => s.blocks.length > 0);
  }, [q, allSections]);

  const active = filtered.find((s) => s.id === activeId) ?? filtered[0];

  function jumpTo(section: HelpSection) {
    setActiveId(section.id);
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Box>
          <Title order={3}>{t("help.title")}</Title>
          <Text c="dimmed" size="sm" mt={2}>
            {t("help.subtitle", { company: companyName })}
          </Text>
        </Box>
        <Badge
          variant="light"
          color="gold"
          size="lg"
          styles={{ label: { letterSpacing: 0.5 } }}
        >
          {lang === "ur" ? "اردو" : "English"}
        </Badge>
      </Group>

      <TextInput
        placeholder={t("help.searchPlaceholder")}
        leftSection={<Search size={16} style={{ color: INK.muted }} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        w={380}
        size="md"
        radius="md"
        styles={{
          input: {
            background: "var(--app-surface)",
            border: `1px solid ${INK.border}`,
            "&:focus": {
              borderColor: INK.gold,
              boxShadow: `0 0 0 1px ${INK.gold}`,
            },
          },
        }}
      />

      {filtered.length === 0 ? (
        <Card withBorder padding="xl" mt="sm">
          <Stack align="center" gap="xs" py="lg">
            <SearchX size={32} style={{ color: INK.muted }} />
            <Text fw={700}>{t("help.noResults")}</Text>
            <Text size="sm" c="dimmed">
              {t("help.tryAnother")}
            </Text>
          </Stack>
        </Card>
      ) : (
        <Group align="flex-start" gap="lg" wrap="nowrap">
          {/* ==================== TABLE OF CONTENTS ==================== */}
          <Card
            withBorder
            padding="md"
            style={{ width: 260, flexShrink: 0, position: "sticky", top: 0 }}
          >
            <Text
              size="xs"
              fw={800}
              style={{
                color: INK.gold,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                padding: "0 8px 8px",
              }}
            >
              {t("help.toc")}
            </Text>
            <ScrollArea.Autosize mah={520} type="scroll">
              <Stack gap={2}>
                {filtered.map((section) => {
                  const isActive = section.id === active?.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => jumpTo(section)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "9px 10px",
                        borderRadius: 10,
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: 13,
                        fontWeight: isActive ? 700 : 500,
                        textAlign: "left",
                        color: isActive ? INK.text : INK.muted,
                        background: isActive
                          ? "var(--app-soft)"
                          : "transparent",
                        transition: "background 0.15s ease, color 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive)
                          e.currentTarget.style.background = "var(--app-soft)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive)
                          e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          flexShrink: 0,
                          background: isActive
                            ? "rgba(201,149,42,0.18)"
                            : "var(--app-soft)",
                          color: isActive ? INK.gold : INK.muted,
                        }}
                      >
                        {SECTION_ICONS[section.id] ?? <FileText size={14} />}
                      </span>
                      {section.title}
                    </button>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          </Card>

          {/* ==================== SECTION CONTENT ==================== */}
          <Box style={{ flex: 1, minWidth: 0 }}>
            {active && <SectionCard section={active} t={t} />}
          </Box>
        </Group>
      )}
    </Stack>
  );
}

// ==========================================
// SINGLE SECTION CARD
// ==========================================

function SectionCard({
  section,
  t,
}: {
  section: HelpSection;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <Card withBorder padding="lg">
      <Group gap="sm" mb="md">
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 38,
            height: 38,
            borderRadius: 12,
            background: "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)",
            color: "#131C39",
            flexShrink: 0,
          }}
        >
          {SECTION_ICONS[section.id] ?? <FileText size={18} />}
        </span>
        <Title order={4} style={{ color: INK.text, letterSpacing: -0.3 }}>
          {section.title}
        </Title>
      </Group>

      <Stack gap="md">
        {section.blocks.map((block, i) => {
          switch (block.type) {
            case "p":
              return (
                <Text key={i} size="sm" style={{ color: INK.textSoft, lineHeight: 1.7 }}>
                  {block.text}
                </Text>
              );
            case "list":
              return (
                <List
                  key={i}
                  spacing="xs"
                  size="sm"
                  styles={{
                    item: { color: INK.textSoft, lineHeight: 1.6 },
                  }}
                >
                  {block.items.map((item, j) => (
                    <List.Item key={j}>{item}</List.Item>
                  ))}
                </List>
              );
            case "steps":
              return (
                <List
                  key={i}
                  type="ordered"
                  spacing="xs"
                  size="sm"
                  withPadding
                  styles={{
                    item: { color: INK.textSoft, lineHeight: 1.6 },
                  }}
                >
                  {block.items.map((item, j) => (
                    <List.Item key={j}>{item}</List.Item>
                  ))}
                </List>
              );
            case "howto":
              return (
                <Card
                  key={i}
                  withBorder
                  padding="md"
                  style={{ background: "var(--app-gold-soft)", borderColor: "var(--app-border)" }}
                >
                  <Text fw={700} size="sm" mb="xs" style={{ color: "var(--app-gold-deep)" }}>
                    {block.title}
                  </Text>
                  <List
                    type="ordered"
                    spacing="xs"
                    size="sm"
                    withPadding
                    styles={{
                      item: { color: INK.textSoft, lineHeight: 1.6 },
                    }}
                  >
                    {block.items.map((item, j) => (
                      <List.Item key={j}>{item}</List.Item>
                    ))}
                  </List>
                </Card>
              );
            case "tip":
              return (
                <Alert
                  key={i}
                  color="gold"
                  icon={<CheckCircle2 size={16} />}
                  variant="light"
                  title={t("help.tip")}
                >
                  <Text size="sm">{block.text}</Text>
                </Alert>
              );
            case "warn":
              return (
                <Alert
                  key={i}
                  color="orange"
                  variant="light"
                  title={t("help.warning")}
                >
                  <Text size="sm">{block.text}</Text>
                </Alert>
              );
            default:
              return null;
          }
        })}
      </Stack>
    </Card>
  );
}
