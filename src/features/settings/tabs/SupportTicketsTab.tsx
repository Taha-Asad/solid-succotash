import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import {
  CheckCircle2,
  CreditCard,
  LifeBuoy,
  MessageSquare,
  Plus,
  Send,
} from "lucide-react";
import {
  createTicket,
  getCurrentSubscription,
  getErrorMessage,
  getTicketDetail,
  listPackages,
  listTickets,
  replyTicket,
  updateTicketStatus,
} from "../../../api/backend";
import type {
  PublicPackage,
  PublicSubscription,
  PublicTicket,
  TicketDetail,
} from "../../../types/backend";
import SupportContactCard from "../../../components/SupportContactCard";

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

export function SupportTicketsTab() {
  const [subscription, setSubscription] = useState<PublicSubscription | null>(null);
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [tickets, setTickets] = useState<PublicTicket[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create ticket modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<string>("billing");
  const [priority, setPriority] = useState<string>("normal");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reply state
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sub, pkgs, tks] = await Promise.all([
        getCurrentSubscription().catch(() => null),
        listPackages(false).catch(() => []),
        listTickets(),
      ]);
      setSubscription(sub);
      setPackages(pkgs);
      setTickets(tks);
      if (tks.length > 0 && !selectedDetail) {
        const detail = await getTicketDetail(tks[0].id);
        setSelectedDetail(detail);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [selectedDetail]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleSelectTicket(ticketId: string) {
    try {
      const detail = await getTicketDetail(ticketId);
      setSelectedDetail(detail);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleCreateTicket() {
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createTicket({
        subject: subject.trim(),
        category,
        priority,
        message: message.trim(),
      });
      setCreateOpen(false);
      setSubject("");
      setMessage("");
      setSelectedDetail(created);
      const updatedList = await listTickets();
      setTickets(updatedList);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
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
      const updatedList = await listTickets();
      setTickets(updatedList);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setReplying(false);
    }
  }

  async function handleResolveTicket(status: string) {
    if (!selectedDetail) return;
    try {
      await updateTicketStatus({
        ticketId: selectedDetail.ticket.id,
        status,
      });
      const refreshed = await getTicketDetail(selectedDetail.ticket.id);
      setSelectedDetail(refreshed);
      const updatedList = await listTickets();
      setTickets(updatedList);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const currentPkg = packages.find((p) => p.id === subscription?.packageId);

  return (
    <Stack gap="lg">
      {error && (
        <Alert color="red" title="Error" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Active Subscription & Commercial Tiers Summary */}
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap" mb="md">
          <Box>
            <Group gap="xs">
              <CreditCard size={18} />
              <Title order={5}>Subscription Plan & Commercial Tiers</Title>
              {subscription && (
                <Badge color={subscription.status === "active" ? "teal" : subscription.status === "trial" ? "blue" : "red"}>
                  {subscription.status.toUpperCase()}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" mt={4}>
              Current Plan:{" "}
              <Text span fw={700} c="var(--app-text)">
                {currentPkg ? `${currentPkg.name} (PKR ${currentPkg.price.toLocaleString()}/mo)` : "14-Day Evaluation Trial"}
              </Text>
              {subscription?.trialEndsAt && (
                <> · Trial Ends: {subscription.trialEndsAt.slice(0, 10)}</>
              )}
            </Text>
          </Box>
          <Button
            size="xs"
            leftSection={<Plus size={14} />}
            onClick={() => {
              setCategory("billing");
              setSubject("Upgrade / Subscription Plan Request");
              setCreateOpen(true);
            }}
          >
            Request Plan Upgrade
          </Button>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" mb="md">
          {packages.map((pkg) => {
            const isCurrent = pkg.id === subscription?.packageId;
            return (
              <Card
                key={pkg.id}
                withBorder
                padding="sm"
                radius="md"
                style={{
                  borderColor: isCurrent ? "var(--mantine-color-blue-5)" : undefined,
                }}
              >
                <Group justify="space-between" mb={4}>
                  <Text fw={700} size="sm">
                    {pkg.name}
                  </Text>
                  {isCurrent && (
                    <Badge size="xs" color="blue" variant="light">
                      Current
                    </Badge>
                  )}
                </Group>
                <Text fw={800} size="md" c="blue">
                  PKR {pkg.price.toLocaleString()}{" "}
                  <Text span size="xs" fw={500} c="dimmed">
                    / {pkg.billingCycle}
                  </Text>
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  {pkg.description}
                </Text>
              </Card>
            );
          })}
        </SimpleGrid>

        <SupportContactCard />
      </Card>

      {/* Support Tickets & Threaded Messages */}
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="center" mb="md">
          <Box>
            <Group gap="xs">
              <LifeBuoy size={18} />
              <Title order={5}>Support & Helpdesk Tickets</Title>
              <Badge variant="light" color="gray">
                {tickets.length}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              Open a direct support or billing ticket with Super Admin. Remains open even in Day-15 Read-Only mode.
            </Text>
          </Box>
          <Button
            size="sm"
            leftSection={<Plus size={15} />}
            onClick={() => setCreateOpen(true)}
          >
            New Support Ticket
          </Button>
        </Group>

        <Divider mb="md" />

        {!loading && tickets.length === 0 ? (
          <Stack align="center" py="xl" gap="xs">
            <MessageSquare size={32} style={{ opacity: 0.4 }} />
            <Text fw={600} size="sm">
              No support tickets yet
            </Text>
            <Text size="xs" c="dimmed">
              Need help with FBR integration, data import, or upgrading your plan? Create a ticket above.
            </Text>
          </Stack>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {/* Ticket List */}
            <Stack gap="xs">
              {tickets.map((t) => {
                const active = selectedDetail?.ticket.id === t.id;
                return (
                  <Card
                    key={t.id}
                    withBorder
                    padding="sm"
                    radius="md"
                    onClick={() => void handleSelectTicket(t.id)}
                    style={{
                      cursor: "pointer",
                      borderColor: active ? "var(--mantine-color-blue-5)" : undefined,
                    }}
                  >
                    <Group justify="space-between" mb={4}>
                      <Text fw={700} size="sm" lineClamp={1}>
                        {t.subject}
                      </Text>
                      <Badge size="xs" color={statusColor(t.status)}>
                        {t.status.replace("_", " ")}
                      </Badge>
                    </Group>
                    <Group gap="xs">
                      <Badge size="xs" variant="outline" color="gray">
                        {t.category}
                      </Badge>
                      <Badge size="xs" variant="light" color={priorityColor(t.priority)}>
                        {t.priority}
                      </Badge>
                      <Text size="xs" c="dimmed" ml="auto">
                        {t.messageCount} msg · {t.updatedAt.slice(0, 10)}
                      </Text>
                    </Group>
                  </Card>
                );
              })}
            </Stack>

            {/* Selected Ticket Thread */}
            {selectedDetail ? (
              <Card withBorder padding="md" radius="md">
                <Group justify="space-between" align="flex-start" mb="xs">
                  <Box>
                    <Text fw={700} size="md">
                      {selectedDetail.ticket.subject}
                    </Text>
                    <Group gap={6} mt={4}>
                      <Badge size="xs" color={statusColor(selectedDetail.ticket.status)}>
                        {selectedDetail.ticket.status}
                      </Badge>
                      <Badge size="xs" variant="outline">
                        {selectedDetail.ticket.category}
                      </Badge>
                      <Badge size="xs" variant="light" color={priorityColor(selectedDetail.ticket.priority)}>
                        {selectedDetail.ticket.priority}
                      </Badge>
                    </Group>
                  </Box>
                  {selectedDetail.ticket.status !== "resolved" &&
                    selectedDetail.ticket.status !== "closed" && (
                      <Button
                        size="xs"
                        variant="light"
                        color="teal"
                        leftSection={<CheckCircle2 size={13} />}
                        onClick={() => void handleResolveTicket("resolved")}
                      >
                        Mark Resolved
                      </Button>
                    )}
                </Group>

                <Divider my="sm" />

                <Stack gap="xs" mah={320} style={{ overflowY: "auto" }} mb="sm">
                  {selectedDetail.messages.map((m) => {
                    const isSuper = m.senderRole === "super_admin";
                    return (
                      <Box
                        key={m.id}
                        p="xs"
                        style={{
                          borderRadius: 8,
                          background: isSuper
                            ? "rgba(20, 184, 166, 0.10)"
                            : "rgba(59, 130, 246, 0.08)",
                          border: isSuper
                            ? "1px solid rgba(20, 184, 166, 0.30)"
                            : "1px solid rgba(59, 130, 246, 0.20)",
                        }}
                      >
                        <Group justify="space-between" mb={2}>
                          <Group gap={6}>
                            <Text size="xs" fw={700}>
                              {m.senderName || "User"}
                            </Text>
                            <Badge size="xs" color={isSuper ? "teal" : "blue"} variant="light">
                              {isSuper ? "Super Admin" : m.senderRole}
                            </Badge>
                          </Group>
                          <Text size="xs" c="dimmed">
                            {m.createdAt.slice(0, 16).replace("T", " ")}
                          </Text>
                        </Group>
                        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                          {m.message}
                        </Text>
                      </Box>
                    );
                  })}
                </Stack>

                <Group align="flex-end" gap="xs">
                  <Textarea
                    placeholder="Write a reply..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.currentTarget.value)}
                    autosize
                    minRows={2}
                    maxRows={4}
                    style={{ flex: 1 }}
                  />
                  <Button
                    size="sm"
                    loading={replying}
                    leftSection={<Send size={14} />}
                    onClick={() => void handleSendReply()}
                  >
                    Reply
                  </Button>
                </Group>
              </Card>
            ) : (
              <Card withBorder padding="md" radius="md">
                <Text size="sm" c="dimmed">
                  Select a ticket on the left to view its conversation thread.
                </Text>
              </Card>
            )}
          </SimpleGrid>
        )}
      </Card>

      {/* Create Ticket Modal */}
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Open Support / Billing Ticket"
        centered
      >
        <Stack gap="sm">
          <TextInput
            label="Subject"
            placeholder="Brief summary of your request"
            value={subject}
            onChange={(e) => setSubject(e.currentTarget.value)}
            required
          />
          <Group grow>
            <Select
              label="Category"
              value={category}
              onChange={(v) => setCategory(v || "issue")}
              data={[
                { value: "billing", label: "Billing & Plan Upgrade" },
                { value: "issue", label: "Technical Issue" },
                { value: "feature_request", label: "Feature Request" },
                { value: "recommendation", label: "Recommendation" },
                { value: "complaint", label: "Complaint" },
                { value: "other", label: "Other" },
              ]}
            />
            <Select
              label="Priority"
              value={priority}
              onChange={(v) => setPriority(v || "normal")}
              data={[
                { value: "low", label: "Low" },
                { value: "normal", label: "Normal" },
                { value: "high", label: "High" },
                { value: "urgent", label: "Urgent" },
              ]}
            />
          </Group>
          <Textarea
            label="Message"
            placeholder="Describe your question, upgrade request, or issue..."
            minRows={4}
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
            required
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button loading={submitting} onClick={() => void handleCreateTicket()}>
              Submit Ticket
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
