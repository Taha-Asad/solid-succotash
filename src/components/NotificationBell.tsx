// ==========================================
// NOTIFICATION BELL
// ==========================================
//
// Bell icon with badge count. Click to see alerts:
// low stock, expiring batches, overdue invoices.
// Styled with the INK navy/gold tokens + lucide icons.
//
// Live updates: the backend pushes `notification:updated` after any stock /
// invoice / PO mutation (and from a 30s background ticker for time-based
// alerts). New alerts surface as a styled toast with a close button and stay
// unread until the user clicks them or hits "Mark all as read". The bell badge
// shows the unread count so it ticks up as alerts arrive and clears on read.

import { useEffect, useRef, useState } from "react";

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
import { notifications as toast } from "@mantine/notifications";

import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  Info,
  Package,
  ReceiptText,
  PackageCheck,
} from "lucide-react";

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { getNotifications } from "../api/backend";
import type { AppNotification } from "../api/backend";
import { INK } from "../theme";
import { useI18n } from "../i18n/I18nProvider";

interface NotificationBellProps {
  onNavigate: (view: "inventory" | "invoices") => void;
}

// Matches `commands::notifications::NOTIFICATION_UPDATED_EVENT` in Rust.
const NOTIFICATION_UPDATED_EVENT = "notification:updated";

// Fallback re-sync when an event was missed (e.g. event fired before the
// listeners registered) or the frontend runs outside Tauri during dev.
const POLL_MS = 60_000;

// Toast lifetime (~2.5s) with a manual close button.
const TOAST_AUTO_CLOSE_MS = 2500;

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  critical: <AlertOctagon size={16} style={{ color: INK.danger }} />,
  warning: <AlertTriangle size={16} style={{ color: INK.warning }} />,
  info: <Info size={16} style={{ color: INK.textSoft }} />,
};

// Left-accent border + toast color per severity.
const SEVERITY_ACCENT: Record<string, string> = {
  critical: INK.danger,
  warning: INK.warning,
  info: "#228BE6",
};

const SEVERITY_TOAST_COLOR: Record<string, string> = {
  critical: "red",
  warning: "orange",
  info: "blue",
};

const RESOURCE_ICON: Record<string, React.ReactNode> = {
  product: <Package size={15} style={{ color: INK.textSoft }} />,
  invoice: <ReceiptText size={15} style={{ color: INK.textSoft }} />,
  batch: <PackageCheck size={15} style={{ color: INK.textSoft }} />,
};

// Read/unread state is persisted so a reload never re-toasts alerts the user
// has already seen (and the badge count survives restarts).
const READ_IDS_KEY = "app.notification.readIds";

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_IDS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Corrupt/blocked storage — degrade silently to "nothing read".
  }
  return new Set();
}

function persistReadIds(ids: Set<string>) {
  try {
    localStorage.setItem(READ_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable (private mode, etc.) — degrade silently.
  }
}

export default function NotificationBell({
  onNavigate,
}: NotificationBellProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [opened, setOpened] = useState(false);
  const { t, dir } = useI18n();

  // Ids the user has already seen (click or "mark all read").
  const readIdsRef = useRef<Set<string>>(loadReadIds());
  // Ids that existed when the component mounted — never re-toasted.
  const baselineIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];
    const timers: ReturnType<typeof setInterval>[] = [];

    function showAlertToast(n: AppNotification) {
      const accent = SEVERITY_ACCENT[n.severity] ?? SEVERITY_ACCENT.info;
      toast.show({
        id: `notif-${n.id}`,
        color: SEVERITY_TOAST_COLOR[n.severity] ?? "blue",
        icon: SEVERITY_ICON[n.severity] ?? <Info size={16} />,
        title: n.title,
        message: n.message,
        autoClose: TOAST_AUTO_CLOSE_MS,
        withCloseButton: true,
        onClick: () => {
          if (n.resourceType === "invoice") onNavigate("invoices");
          else onNavigate("inventory");
        },
        styles: {
          root: {
            borderRadius: "var(--mantine-radius-md)",
            border: `1px solid ${INK.border}`,
            borderLeft: `4px solid ${accent}`,
            background: "var(--app-surface)",
            boxShadow: "0 10px 28px rgba(14, 21, 48, 0.22)",
            padding: "12px 14px",
          },
          icon: {
            background: "var(--app-soft)",
            border: "none",
          },
          title: {
            fontWeight: 700,
            color: INK.text,
          },
          description: {
            color: INK.muted,
            fontSize: 13,
          },
          closeButton: {
            color: INK.muted,
            borderRadius: "var(--mantine-radius-sm)",
            "&:hover": { background: "var(--app-soft)", color: INK.text },
          },
        },
      });
    }

    async function refresh() {
      let fresh: AppNotification[] = [];
      try {
        fresh = await getNotifications();
      } catch {
        return;
      }

      // First load = baseline: list everything but show no toasts, so a
      // reload never re-flashes alerts that already existed.
      if (baselineIdsRef.current === null) {
        baselineIdsRef.current = new Set(fresh.map((n) => n.id));
        setNotifications(fresh);
        return;
      }

      const baseline = baselineIdsRef.current;
      const newlyArrived = fresh.filter(
        (n) => !baseline.has(n.id) && !readIdsRef.current.has(n.id),
      );
      for (const n of newlyArrived) {
        baseline.add(n.id);
        showAlertToast(n);
      }

      setNotifications(fresh);
    }

    // Push events from the backend (mutations + background ticker).
    listen<void>(NOTIFICATION_UPDATED_EVENT, refresh).then((un) => {
      unlisteners.push(un);
    });

    // Safety-net poll for missed events / non-Tauri dev.
    timers.push(setInterval(refresh, POLL_MS));

    refresh();

    return () => {
      unlisteners.forEach((un) => un());
      timers.forEach((t) => clearInterval(t));
    };
  }, [onNavigate]);

  const totalCount = notifications.length;
  const unreadCount = notifications.filter(
    (n) => !readIdsRef.current.has(n.id),
  ).length;
  const criticalCount = notifications.filter(
    (n) => n.severity === "critical",
  ).length;

  function markAllRead() {
    readIdsRef.current = new Set(notifications.map((n) => n.id));
    persistReadIds(readIdsRef.current);
    setNotifications((prev) => [...prev]);
  }

  function handleClick(notif: AppNotification) {
    setOpened(false);
    readIdsRef.current.add(notif.id);
    persistReadIds(readIdsRef.current);
    setNotifications((prev) => [...prev]);
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
          disabled={unreadCount === 0}
          label={unreadCount > 99 ? "99+" : unreadCount}
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
                background: "var(--app-surface)",
                color: INK.text,
                "&:hover": { background: "var(--app-soft)" },
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
            <Text fw={700} size="sm" style={{ color: INK.text }}>
              {t("notifications.title")}
            </Text>
            <Group gap="xs">
              {totalCount > 0 && (
                <Text
                  size="xs"
                  fw={600}
                  style={{ color: INK.gold, cursor: "pointer" }}
                  onClick={markAllRead}
                >
                  {t("notifications.markAllRead")}
                </Text>
              )}
              <Badge
                size="sm"
                variant="light"
                color={criticalCount > 0 ? "red" : "orange"}
              >
                {unreadCount}
              </Badge>
            </Group>
          </Group>

          {notifications.length === 0 ? (
            <Text c="dimmed" size="sm" p="lg" ta="center">
              {t("notifications.allClear")}
            </Text>
          ) : (
            <ScrollArea h={300}>
              <Stack gap={0}>
                {notifications.map((notif) => {
                  const isUnread = !readIdsRef.current.has(notif.id);
                  return (
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
                        background: isUnread ? "var(--app-soft)" : "transparent",
                        transition: "background 0.15s ease",
                      }}
                      onClick={() => handleClick(notif)}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--app-soft)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = isUnread
                          ? "var(--app-soft)"
                          : "transparent")
                      }
                    >
                      <Group gap="xs" wrap="nowrap" mt={2}>
                        {SEVERITY_ICON[notif.severity] ?? (
                          <Info size={16} style={{ color: INK.muted }} />
                        )}
                        {RESOURCE_ICON[notif.resourceType]}
                      </Group>
                      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={600} style={{ color: INK.text }} lineClamp={1}>
                          {notif.title}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {notif.message}
                        </Text>
                      </Stack>
                    </Group>
                  );
                })}
              </Stack>
            </ScrollArea>
          )}

          {notifications.length > 0 && (
            <>
              <Divider />
              <Group justify="center" p="xs" style={{ background: INK.paper }}>
                <Text
                  size="xs"
                  fw={600}
                  style={{ color: INK.textSoft, cursor: "pointer" }}
                  onClick={() => {
                    setOpened(false);
                    onNavigate("inventory");
                  }}
                >
                  {t("notifications.viewInventory")} {dir === "rtl" ? "←" : "→"}
                </Text>
              </Group>
            </>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
