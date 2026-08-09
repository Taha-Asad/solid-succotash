// ==========================================
// NOTIFICATION BELL
// ==========================================
//
// Bell icon with badge count. Click to see alerts:
// low stock, expiring batches, overdue invoices.
// Styled with the INK navy/gold tokens + lucide icons.

import { useEffect, useState } from "react";

import {
  ActionIcon,
  Badge,
  Divider,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";

import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  Info,
  Package,
  ReceiptText,
  PackageCheck,
} from "lucide-react";

import { getNotifications } from "../api/backend";
import type { AppNotification } from "../api/backend";
import { INK } from "../theme";

interface NotificationBellProps {
  onNavigate: (view: "inventory" | "invoices") => void;
}

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  critical: <AlertOctagon size={16} style={{ color: INK.danger }} />,
  warning: <AlertTriangle size={16} style={{ color: INK.warning }} />,
  info: <Info size={16} style={{ color: INK.muted }} />,
};

const RESOURCE_ICON: Record<string, React.ReactNode> = {
  product: <Package size={15} style={{ color: INK.navySoft }} />,
  invoice: <ReceiptText size={15} style={{ color: INK.navySoft }} />,
  batch: <PackageCheck size={15} style={{ color: INK.navySoft }} />,
};

export default function NotificationBell({
  onNavigate,
}: NotificationBellProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    getNotifications()
      .then(setNotifications)
      .catch(() => {});
  }, []);

  const criticalCount = notifications.filter(
    (n) => n.severity === "critical",
  ).length;
  const totalCount = notifications.length;

  function handleClick(notif: AppNotification) {
    setOpened(false);
    if (notif.resourceType === "invoice") onNavigate("invoices");
    else onNavigate("inventory");
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      width={380}
      shadow="lg"
      withArrow
      styles={{ dropdown: { padding: 0, overflow: "hidden" } }}
    >
      <Popover.Target>
        <Indicator
          disabled={totalCount === 0}
          label={totalCount > 99 ? "99+" : totalCount}
          color={criticalCount > 0 ? "red" : "orange"}
          size={16}
          offset={4}
        >
          <ActionIcon
            variant="light"
            radius="md"
            size="lg"
            onClick={() => setOpened((o) => !o)}
            styles={{
              root: {
                border: `1px solid ${INK.border}`,
                background: "#fff",
                color: INK.navy,
                "&:hover": { background: INK.paper },
              },
            }}
          >
            <Bell size={17} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>

      <Popover.Dropdown>
        <Stack gap={0}>
          <Group
            justify="space-between"
            px="md"
            py="sm"
            style={{ borderBottom: `1px solid ${INK.border}`, background: INK.paper }}
          >
            <Text fw={700} size="sm" style={{ color: INK.navy }}>
              Notifications
            </Text>
            <Badge
              size="sm"
              variant="light"
              color={criticalCount > 0 ? "red" : "orange"}
            >
              {totalCount}
            </Badge>
          </Group>

          {totalCount === 0 ? (
            <Text c="dimmed" size="sm" p="lg" ta="center">
              All clear — no alerts
            </Text>
          ) : (
            <ScrollArea h={300}>
              <Stack gap={0}>
                {notifications.map((notif) => (
                  <Group
                    key={notif.id}
                    px="md"
                    py="sm"
                    gap="sm"
                    wrap="nowrap"
                    align="flex-start"
                    style={{
                      cursor: "pointer",
                      borderBottom: `1px solid ${INK.border}`,
                      transition: "background 0.15s ease",
                    }}
                    onClick={() => handleClick(notif)}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#EEF2FA")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <Group gap="xs" wrap="nowrap" mt={2}>
                      {SEVERITY_ICON[notif.severity] ?? (
                        <Info size={16} style={{ color: INK.muted }} />
                      )}
                      {RESOURCE_ICON[notif.resourceType]}
                    </Group>
                    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600} style={{ color: INK.navy }} lineClamp={1}>
                        {notif.title}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {notif.message}
                      </Text>
                    </Stack>
                  </Group>
                ))}
              </Stack>
            </ScrollArea>
          )}

          {totalCount > 0 && (
            <>
              <Divider />
              <Group justify="center" p="xs" style={{ background: INK.paper }}>
                <Text
                  size="xs"
                  fw={600}
                  style={{ color: INK.navySoft, cursor: "pointer" }}
                  onClick={() => {
                    setOpened(false);
                    onNavigate("inventory");
                  }}
                >
                  View Inventory →
                </Text>
              </Group>
            </>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
