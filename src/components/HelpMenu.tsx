// ==========================================
// HELP MENU — top-bar entry point for docs & tutorial
// ==========================================

import {
  Button,
  Menu,
  Tooltip,
} from "@mantine/core";
import { BookOpen, CircleHelp, Play } from "lucide-react";

import { useI18n } from "../i18n/I18nProvider";
import { INK } from "../theme";

export default function HelpMenu({
  onOpenDocs,
  onReplayTour,
}: {
  onOpenDocs: () => void;
  onReplayTour: () => void;
}) {
  const { t } = useI18n();

  return (
    <Menu
      shadow="lg"
      width={240}
      position="bottom-end"
      radius="md"
      withinPortal
    >
      <Tooltip label={t("help.menuLabel")}>
        <Menu.Target>
          <Button
            variant="subtle"
            size="sm"
            data-tour="topbar-help"
            leftSection={<CircleHelp size={15} />}
            styles={{ root: { fontWeight: 600 } }}
          >
            {t("help.menuLabel")}
          </Button>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown>
        <Menu.Label>{t("help.menuLabel")}</Menu.Label>
        <Menu.Item
          leftSection={<BookOpen size={15} style={{ color: INK.gold }} />}
          onClick={onOpenDocs}
        >
          {t("help.docs")}
        </Menu.Item>
        <Menu.Item
          leftSection={<Play size={15} style={{ color: INK.gold }} />}
          onClick={onReplayTour}
        >
          {t("help.replay")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
