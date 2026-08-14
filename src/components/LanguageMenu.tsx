// ==========================================
// LANGUAGE MENU — top-bar language switcher
// ==========================================

import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { Check, Languages } from "lucide-react";

import { useI18n } from "../i18n/I18nProvider";
import { LANGUAGES, LANGUAGE_ORDER, type Lang } from "../i18n/translations";
import { INK } from "../theme";

export default function LanguageMenu() {
  const { lang, setLang, t } = useI18n();

  return (
    <Menu
      shadow="lg"
      width={220}
      position="bottom-end"
      radius="md"
      withinPortal
    >
      <Tooltip label={t("topbar.language")}>
        <Menu.Target>
          <ActionIcon
            variant="light"
            size="lg"
            radius="md"
            aria-label={t("topbar.language")}
            style={{
              color: INK.gold,
              background: "rgba(201,149,42,0.10)",
              border: `1px solid rgba(201,149,42,0.25)`,
            }}
          >
            <Languages size={17} />
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown>
        <Menu.Label>{t("topbar.language")}</Menu.Label>
        {LANGUAGE_ORDER.map((code: Lang) => (
          <Menu.Item
            key={code}
            onClick={() => setLang(code)}
            rightSection={
              lang === code ? (
                <Check size={14} style={{ color: INK.gold }} />
              ) : undefined
            }
            style={{ fontWeight: lang === code ? 700 : 500 }}
          >
            {LANGUAGES[code].native}
            <span style={{ color: "var(--app-muted)", fontSize: 12, marginInlineStart: 6 }}>
              {LANGUAGES[code].label}
            </span>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
