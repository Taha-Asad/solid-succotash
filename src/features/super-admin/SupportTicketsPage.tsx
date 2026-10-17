import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import {
  Building2,
  CheckCircle2,
  Clock,
  LifeBuoy,
  MessageSquare,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";
import {
  getErrorMessage,
  getTicketDetail,
  listTickets,
  replyTicket,
  updateTicketStatus,
} from "../../api/backend";
import type { PublicTicket, TicketDetail } from "../../types/backend";
import { useSaTheme } from "./saTheme";

function statusColor(status: string): string {
  switch (status) {
    case "open":
      return "blue";
    case "in_progress":
      return "amber";
    case "resolved":
      return "teal";
    case "closed":
      return "gray";
    default:
      return "blue";
  }
}

function priorityColor(priority: string): string {
  switch (priority) {
    case "urgent":
      return "red";
    case "high":
      return "orange";
    case "normal":
      return "blue";
    default:
      return "gray";
  }
}

export default function SupportTicketsPage() {
  const SA = useSaTheme();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tickets, setTickets] = useState<PublicTicket[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listTickets({
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setTickets(list);
      if (list.length > 0) {
        const currentStillExists = selectedDetail
          ? list.some((t) => t.id === selectedDetail.ticket.id)
          : false;
        const targetId = currentStillExists ? selectedDetail!.ticket.id : list[0].id;
        const detail = await getTicketDetail(targetId);
        setSelectedDetail(detail);
      } else {
        setSelectedDetail(null);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, selectedDetail]);

  useEffect(() => {
    void loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function handleSelectTicket(ticketId: string) {
    try {
      const detail = await getTicketDetail(ticketId);
      setSelectedDetail(detail);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleSendReply() {
    if (!selectedDetail || !replyText.trim()) return;
    setReplying(true);
    setError(null);
    try {
      const updated = await replyTicket({
        ticketId: selectedDetail.ticket.id,
        message: replyText.trim(),
      });
      setSelectedDetail(updated);
      setReplyText("");
      const refreshedList = await listTickets({
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setTickets(refreshedList);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setReplying(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!selectedDetail) return;
    try {
      await updateTicketStatus({
        ticketId: selectedDetail.ticket.id,
        status: newStatus,
      });
      const detail = await getTicketDetail(selectedDetail.ticket.id);
      setSelectedDetail(detail);
      const refreshedList = await listTickets({
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setTickets(refreshedList);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Box>
          <Group gap="xs">
            <LifeBuoy size={22} style={{ color: SA.accent }} />
            <Title order={2} style={{ color: SA.text }}>
              Tenant Support & Upgrade Helpdesk
            </Title>
          </Group>
          <Text size="sm" style={{ color: SA.textSoft }} mt={4}>
            Cross-tenant inbox for billing inquiries, 14-day trial upgrade requests, and technical support threads.
          </Text>
        </Box>
        <Group gap="sm">
          <SegmentedControl
            size="xs"
            value={statusFilter}
            onChange={setStatusFilter}
            data={[
              { label: "All", value: "all" },
              { label: "Open", value: "open" },
              { label: "In Progress", value: "in_progress" },
              { label: "Resolved", value: "resolved" },
              { label: "Closed", value: "closed" },
            ]}
          />
          <Button
            size="xs"
            variant="default"
            leftSection={<RefreshCw size={14} />}
            onClick={() => void loadTickets()}
            loading={loading}
          >
            Refresh
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" title="Error" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!loading && tickets.length === 0 ? (
        <Card
          withBorder
          radius="md"
          padding="xl"
          style={{ background: SA.panel, borderColor: SA.border }}
        >
          <Stack align="center" gap="xs" py="xl">
            <MessageSquare size={36} style={{ opacity: 0.4, color: SA.textSoft }} />
            <Text fw={700} size="md" style={{ color: SA.text }}>
              No support tickets matching filter
            </Text>
            <Text size="xs" style={{ color: SA.textSoft }}>
              When tenants open billing, upgrade, or technical support tickets, they appear here in real time.
            </Text>
          </Stack>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {/* Left Column: Ticket Inbox List */}
          <Stack gap="xs">
            {tickets.map((t) => {
              const isSelected = selectedDetail?.ticket.id === t.id;
              return (
                <Card
                  key={t.id}
                  withBorder
                  padding="md"
                  radius="md"
                  onClick={() => void handleSelectTicket(t.id)}
                  style={{
                    cursor: "pointer",
                    background: SA.panel,
                    borderColor: isSelected ? SA.accent : SA.border,
                  }}
                >
                  <Group justify="space-between" mb={4}>
                    <Text fw={700} size="sm" style={{ color: SA.text }} lineClamp={1}>
                      {t.subject}
                    </Text>
                    <Badge size="xs" color={statusColor(t.status)}>
                      {t.status.replace("_", " ")}
                    </Badge>
                  </Group>
                  <Group gap="xs" mb={6}>
                    <Group gap={4}>
                      <Building2 size={12} style={{ color: SA.textSoft }} />
                      <Text size="xs" fw={600} style={{ color: SA.textSoft }}>
                        {t.companyName || t.companyId.slice(0, 8)}
                      </Text>
                    </Group>
                    <Badge size="xs" variant="outline">
                      {t.category}
                    </Badge>
                    <Badge size="xs" variant="light" color={priorityColor(t.priority)}>
                      {t.priority}
                    </Badge>
                  </Group>
                  <Text size="xs" style={{ color: SA.textSoft }}>
                    {t.messageCount} message(s) · Updated {t.updatedAt.slice(0, 16).replace("T", " ")}
                  </Text>
                </Card>
              );
            })}
          </Stack>

          {/* Right Column: Conversation Thread & Governance Controls */}
          {selectedDetail ? (
            <Card
              withBorder
              padding="lg"
              radius="md"
              style={{ background: SA.panel, borderColor: SA.border }}
            >
              <Group justify="space-between" align="flex-start" mb="xs" wrap="wrap">
                <Box>
                  <Text fw={800} size="md" style={{ color: SA.text }}>
                    {selectedDetail.ticket.subject}
                  </Text>
                  <Group gap="xs" mt={4}>
                    <Badge size="xs" color={statusColor(selectedDetail.ticket.status)}>
                      {selectedDetail.ticket.status}
                    </Badge>
                    <Badge size="xs" variant="outline">
                      {selectedDetail.ticket.companyName || selectedDetail.ticket.companyId}
                    </Badge>
                    <Badge size="xs" variant="light" color={priorityColor(selectedDetail.ticket.priority)}>
                      {selectedDetail.ticket.priority}
                    </Badge>
                  </Group>
                </Box>
                <Group gap={6}>
                  {selectedDetail.ticket.status !== "in_progress" && (
                    <Button
                      size="compact-xs"
                      variant="light"
                      color="amber"
                      leftSection={<Clock size={12} />}
                      onClick={() => void handleStatusChange("in_progress")}
                    >
                      In Progress
                    </Button>
                  )}
                  {selectedDetail.ticket.status !== "resolved" && (
                    <Button
                      size="compact-xs"
                      variant="light"
                      color="teal"
                      leftSection={<CheckCircle2 size={12} />}
                      onClick={() => void handleStatusChange("resolved")}
                    >
                      Resolve
                    </Button>
                  )}
                  {selectedDetail.ticket.status !== "closed" && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="gray"
                      leftSection={<XCircle size={12} />}
                      onClick={() => void handleStatusChange("closed")}
                    >
                      Close
                    </Button>
                  )}
                </Group>
              </Group>

              <Divider my="sm" />

              <Stack gap="xs" mah={360} style={{ overflowY: "auto" }} mb="md">
                {selectedDetail.messages.map((m) => {
                  const isSuper = m.senderRole === "super_admin";
                  return (
                    <Box
                      key={m.id}
                      p="sm"
                      style={{
                        borderRadius: 8,
                        background: isSuper
                          ? "rgba(20, 184, 166, 0.12)"
                          : "rgba(59, 130, 246, 0.08)",
                        border: isSuper
                          ? "1px solid rgba(20, 184, 166, 0.35)"
                          : "1px solid rgba(59, 130, 246, 0.25)",
                      }}
                    >
                      <Group justify="space-between" mb={4}>
                        <Group gap={6}>
                          <Text size="xs" fw={700} style={{ color: SA.text }}>
                            {m.senderName || "User"}
                          </Text>
                          <Badge size="xs" color={isSuper ? "teal" : "blue"} variant="light">
                            {isSuper ? "Super Admin" : m.senderRole}
                          </Badge>
                        </Group>
                        <Text size="xs" style={{ color: SA.textSoft }}>
                          {m.createdAt.slice(0, 16).replace("T", " ")}
                        </Text>
                      </Group>
                      <Text size="sm" style={{ color: SA.text, whiteSpace: "pre-wrap" }}>
                        {m.message}
                      </Text>
                    </Box>
                  );
                })}
              </Stack>

              <Group align="flex-end" gap="xs">
                <Textarea
                  placeholder="Reply as Super Admin (auto-moves open tickets to In Progress)..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.currentTarget.value)}
                  autosize
                  minRows={2}
                  maxRows={5}
                  style={{ flex: 1 }}
                />
                <Button
                  size="sm"
                  loading={replying}
                  leftSection={<Send size={14} />}
                  onClick={() => void handleSendReply()}
                >
                  Send Reply
                </Button>
              </Group>
            </Card>
          ) : null}
        </SimpleGrid>
      )}
    </Stack>
  );
}
