import {
  Box,
  Card,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Check, Languages as LanguagesIcon } from "lucide-react";
import { useI18n } from "../../../i18n/I18nProvider";
import {
  LANGUAGES,
  LANGUAGE_ORDER,
  type Lang,
} from "../../../i18n/translations";
import { INK } from "../../../theme";

export function LanguageTab() {
  const { lang, setLang, t } = useI18n();

  return (
    <Card withBorder padding="lg" maw={620}>
      <Group gap="sm" mb="sm">
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
          }}
        >
          <LanguagesIcon size={18} />
        </span>
        <Title order={5}>{t("lang.title")}</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="lg">
        {t("lang.settingsIntro")}
      </Text>

      <Stack gap="sm">
        {LANGUAGE_ORDER.map((code: Lang) => {
          const meta = LANGUAGES[code];
          const selected = lang === code;
          return (
            <Box
              key={code}
              onClick={() => setLang(code)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 16px",
                borderRadius: 12,
                cursor: "pointer",
                border: `1.5px solid ${
                  selected ? INK.gold : "var(--app-border)"
                }`,
                background: selected ? "rgba(201,149,42,0.08)" : "var(--app-surface)",
                transition: "border-color 0.15s ease, background 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!selected) e.currentTarget.style.background = "var(--app-soft)";
              }}
              onMouseLeave={(e) => {
                if (!selected)
                  e.currentTarget.style.background = "var(--app-surface)";
              }}
            >
              <Group gap="sm">
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: selected
                      ? "linear-gradient(135deg, #C9952A 0%, #E6C965 100%)"
                      : "var(--app-soft)",
                    color: selected ? "#131C39" : INK.muted,
                    fontWeight: 800,
                    fontSize: 14,
                  }}
                >
                  {code === "ur" ? "اردو" : "EN"}
                </span>
                <Box>
                  <Text fw={700} size="sm" style={{ color: INK.text }}>
                    {meta.native}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {meta.label} · {meta.dir === "rtl" ? "RTL" : "LTR"}
                  </Text>
                </Box>
              </Group>
              {selected && <Check size={18} style={{ color: INK.gold }} />}
            </Box>
          );
        })}
      </Stack>

      <Text size="xs" c="dimmed" mt="md">
        {t("lang.note")}
      </Text>
    </Card>
  );
}
