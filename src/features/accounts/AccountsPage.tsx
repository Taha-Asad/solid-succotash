// ==========================================
// ACCOUNTING LEDGER PAGE
// ==========================================
// Tabs:
//   1. Chart of Accounts — trial balance view
//   2. Journal — recent double-entry postings
//   3. New Entry — post a manual adjustment (owner)
//
// All amounts are paisa (Rs 15.00 = 1500).

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";

import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Alert,
} from "@mantine/core";

import {
  getChartOfAccounts,
  getLedgerSummary,
  getJournalEntries,
  getAccountStatement,
  postManualEntry,
  getErrorMessage,
} from "../../api/backend";

import type {
  AccountBalance,
  AccountStatementRow,
  JournalEntryWithLines,
  LedgerAccount,
  ManualLineInput,
} from "../../types/backend";

import { INK } from "../../theme";
import { AppDateInput } from "../../components/AppDateInput";

const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

function p(paisa: number): string {
  return `Rs ${(paisa / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expense",
};

const TYPE_COLOR: Record<string, string> = {
  asset: "blue",
  liability: "orange",
  equity: "grape",
  revenue: "green",
  expense: "red",
};

export default function AccountsPage() {
  return (
    <Stack gap="lg">
      <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
        <Stack gap={2}>
          <Text
            size="xs"
            fw={700}
            style={{ color: INK.gold, letterSpacing: 1.4, textTransform: "uppercase" }}
          >
            Accounting
          </Text>
          <Text fw={800} size="xl" style={{ color: INK.text, letterSpacing: -0.4 }}>
            Ledger & Accounts
          </Text>
          <Text  c="dimmed">
            Chart of accounts and double-entry journal for every business event.
          </Text>
        </Stack>
      </motion.div>

      <Tabs defaultValue="accounts" variant="pills">
        <Tabs.List>
          <Tabs.Tab value="accounts">Chart of Accounts</Tabs.Tab>
          <Tabs.Tab value="journal">Journal</Tabs.Tab>
          <Tabs.Tab value="new">New Entry</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="accounts" pt="md">
          <TrialBalance />
        </Tabs.Panel>
        <Tabs.Panel value="journal" pt="md">
          <JournalList />
        </Tabs.Panel>
        <Tabs.Panel value="new" pt="md">
          <ManualEntryForm />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

// ==========================================
// TRIAL BALANCE / CHART OF ACCOUNTS
// ==========================================

function TrialBalance() {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [summary, setSummary] = useState<AccountBalance[]>([]);
  const [totals, setTotals] = useState<{ debit: number; credit: number }>({
    debit: 0,
    credit: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AccountBalance | null>(null);
  const [statement, setStatement] = useState<AccountStatementRow[]>([]);
  const [stmtOpen, setStmtOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [acc, sum] = await Promise.all([getChartOfAccounts(), getLedgerSummary()]);
      setAccounts(acc);
      setSummary(sum.accounts);
      setTotals({ debit: sum.totalDebit, credit: sum.totalCredit });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openStatement(acc: AccountBalance) {
    setSelected(acc);
    setStmtOpen(true);
    setStatement([]);
    try {
      setStatement(await getAccountStatement(acc.id));
    } catch (err) {
      setStatement([]);
    }
  }

  const balanceCell = (a: AccountBalance) => {
    if (a.net === 0) return <Text c="dimmed" >—</Text>;
    const debit = a.net > 0;
    return (
      <Text  fw={600} c={debit ? "blue" : "green"}>
        {debit ? "Dr " : "Cr "} {p(Math.abs(a.net))}
      </Text>
    );
  };

  return (
    <>
      <Card withBorder shadow="sm" p="lg">
        <Group justify="space-between" mb="md">
          <Stack gap={0}>
            <Text fw={700} style={{ color: INK.text }}>Trial Balance</Text>
            <Text size="xs" c="dimmed">
              Sum of debits must equal sum of credits
            </Text>
          </Stack>
          <Group>
            <Badge color={totals.debit === totals.credit ? "green" : "red"} variant="light">
              {totals.debit === totals.credit ? "Balanced" : "Unbalanced"}
            </Badge>
          </Group>
        </Group>

        {error && <Alert color="red" mb="md">{error}</Alert>}

        <ScrollArea style={{ maxHeight: 520 }}>
          <Table highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Code</Table.Th>
                <Table.Th>Account</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th ta="right">Debit</Table.Th>
                <Table.Th ta="right">Credit</Table.Th>
                <Table.Th ta="right">Balance</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {summary.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td>
                    <Badge size="xs" variant="light" color="gray">{a.code}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text fw={600}  style={{ color: INK.text }}>{a.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color={TYPE_COLOR[a.accountType] ?? "gray"}>
                      {TYPE_LABEL[a.accountType] ?? a.accountType}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right" >{a.debitTotal > 0 ? p(a.debitTotal) : "—"}</Table.Td>
                  <Table.Td ta="right" >{a.creditTotal > 0 ? p(a.creditTotal) : "—"}</Table.Td>
                  <Table.Td ta="right">{balanceCell(a)}</Table.Td>
                  <Table.Td ta="right">
                    <Button size="compact-xs" variant="subtle" onClick={() => openStatement(a)}>
                      Ledger
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
              {!loading && summary.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7} ta="center">
                    <Text c="dimmed"  py="lg">
                      No activity yet. Finalize an invoice to see postings.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr>
                <Table.Th colSpan={3} ta="right">Totals</Table.Th>
                <Table.Th ta="right">{p(totals.debit)}</Table.Th>
                <Table.Th ta="right">{p(totals.credit)}</Table.Th>
                <Table.Th />
                <Table.Th />
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </ScrollArea>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
        <Card withBorder shadow="sm" p="lg">
          <Text fw={700}  style={{ color: INK.text }} mb="xs">
            Account Types
          </Text>
          <Stack gap={6}>
            {Object.entries(TYPE_LABEL).map(([key, label]) => {
              const count = accounts.filter((a) => a.accountType === key).length;
              return (
                <Group key={key} justify="space-between">
                  <Text  c="dimmed">{label}</Text>
                  <Text  fw={600} style={{ color: INK.text }}>{count}</Text>
                </Group>
              );
            })}
          </Stack>
        </Card>
        <Card withBorder shadow="sm" p="lg">
          <Text fw={700}  style={{ color: INK.text }} mb="xs">
            Health
          </Text>
          <Stack gap={6}>
            <Group justify="space-between">
              <Text  c="dimmed">Total debits</Text>
              <Text  fw={600}>{p(totals.debit)}</Text>
            </Group>
            <Group justify="space-between">
              <Text  c="dimmed">Total credits</Text>
              <Text  fw={600}>{p(totals.credit)}</Text>
            </Group>
            <Group justify="space-between">
              <Text  c="dimmed">Difference</Text>
              <Text  fw={600} c={totals.debit === totals.credit ? "green" : "red"}>
                {p(totals.debit - totals.credit)}
              </Text>
            </Group>
          </Stack>
        </Card>
      </SimpleGrid>

      <Modal
        opened={stmtOpen}
        onClose={() => setStmtOpen(false)}
        title={selected ? `${selected.code} · ${selected.name}` : "Account Ledger"}
        size="lg"
        centered
        styles={{ title: { fontWeight: 800, color: INK.text } }}
      >
        <ScrollArea style={{ maxHeight: 440 }}>
          <Table highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Reference</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th ta="right">Debit</Table.Th>
                <Table.Th ta="right">Credit</Table.Th>
                <Table.Th ta="right">Balance</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {statement.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6} ta="center">
                    <Text c="dimmed"  py="lg">No entries for this account.</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {statement.map((row, i) => (
                <Table.Tr key={i}>
                  <Table.Td >{row.entryDate}</Table.Td>
                  <Table.Td >
                    <Badge size="xs" variant="light" color="gray">{row.referenceType}</Badge>
                  </Table.Td>
                  <Table.Td >{row.description ?? "—"}</Table.Td>
                  <Table.Td ta="right" >{row.debit > 0 ? p(row.debit) : "—"}</Table.Td>
                  <Table.Td ta="right" >{row.credit > 0 ? p(row.credit) : "—"}</Table.Td>
                  <Table.Td ta="right">
                    <Text  fw={600} c={row.runningBalance >= 0 ? "blue" : "green"}>
                      {p(row.runningBalance)}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Modal>
    </>
  );
}

// ==========================================
// JOURNAL
// ==========================================

function JournalList() {
  const [entries, setEntries] = useState<JournalEntryWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJournalEntries(100)
      .then(setEntries)
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card withBorder shadow="sm" p="lg">
      <Group justify="space-between" mb="md">
        <Stack gap={0}>
          <Text fw={700} style={{ color: INK.text }}>Journal Entries</Text>
          <Text size="xs" c="dimmed">Latest {entries.length} postings</Text>
        </Stack>
        {error && <Badge color="red" variant="light">{error}</Badge>}
      </Group>

      <ScrollArea style={{ maxHeight: 560 }}>
        <Stack gap="md">
          {!loading && entries.length === 0 && (
            <Text c="dimmed"  ta="center" py="lg">
              No journal entries yet.
            </Text>
          )}
          {entries.map(({ entry, lines }) => {
            const debit = lines.reduce((s, l) => s + l.debit, 0);
            const credit = lines.reduce((s, l) => s + l.credit, 0);
            return (
              <Box
                key={entry.id}
                style={{
                  border: `1px solid ${INK.border}`,
                  borderRadius: 12,
                  padding: 14,
                  background: INK.paper,
                }}
              >
                <Group justify="space-between" mb="xs">
                  <Group gap="xs">
                    <Badge  variant="filled" color="gray" style={{ textTransform: "capitalize" }}>
                      {entry.referenceType}
                    </Badge>
                    <Text size="xs" fw={600} style={{ color: INK.text }}>
                      {entry.entryDate}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {p(debit)} = {p(credit)}
                  </Text>
                </Group>
                <Text  fw={600} mb="xs" style={{ color: INK.text }}>
                  {entry.description ?? "Journal entry"}
                </Text>
                <Table withTableBorder>
                  <Table.Tbody>
                    {lines.map((l, i) => (
                      <Table.Tr key={i}>
                        <Table.Td  w="40%">
                          <Text >
                            <b>{l.accountCode}</b> · {l.accountName}
                          </Text>
                        </Table.Td>
                        <Table.Td  ta="right">
                          {l.debit > 0 ? p(l.debit) : ""}
                        </Table.Td>
                        <Table.Td  ta="right">
                          {l.credit > 0 ? `(${p(l.credit)})` : ""}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Box>
            );
          })}
        </Stack>
      </ScrollArea>
    </Card>
  );
}

// ==========================================
// MANUAL ENTRY
// ==========================================

function ManualEntryForm() {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [entryDate, setEntryDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<
    { accountCode: string; debitRs: number; creditRs: number; description: string | null }[]
  >([
    { accountCode: "", debitRs: 0, creditRs: 0, description: null },
    { accountCode: "", debitRs: 0, creditRs: 0, description: null },
  ]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getChartOfAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  function updateLine(index: number, patch: Partial<{ accountCode: string; debitRs: number; creditRs: number }>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { accountCode: "", debitRs: 0, creditRs: 0, description: null },
    ]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  const totalDebit = lines.reduce((s, l) => s + (l.debitRs ?? 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.creditRs ?? 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  async function submit() {
    setSaving(true);
    setMsg(null);
    try {
      const payload: ManualLineInput[] = lines
        .filter((l) => l.accountCode)
        .map((l) => ({
          accountCode: l.accountCode,
          debit: Math.round((l.debitRs ?? 0) * 100),
          credit: Math.round((l.creditRs ?? 0) * 100),
          description: l.description,
        }));
      await postManualEntry({
        entryDate,
        description: description.trim() || "Manual adjustment",
        lines: payload,
      });
      setMsg({ ok: true, text: "Journal entry posted." });
      setLines([
        { accountCode: "", debitRs: 0, creditRs: 0, description: null },
        { accountCode: "", debitRs: 0, creditRs: 0, description: null },
      ]);
      setDescription("");
    } catch (err) {
      setMsg({ ok: false, text: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SimpleGrid cols={{ base: 1, lg: 3 }}>
      <Card withBorder shadow="sm" p="lg">
        <Text fw={700} style={{ color: INK.text }} mb="md">New Journal Entry</Text>
        <Stack gap="sm">
          <AppDateInput
            label="Date"
            value={entryDate}
            onChange={setEntryDate}
          />
          <TextInput
            label="Description"
            placeholder="e.g. Owner capital contribution"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <Group justify="space-between" pt="xs">
            <Text  c="dimmed">Debit total</Text>
            <Text  fw={700} style={{ color: INK.text }}>Rs {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
          </Group>
          <Group justify="space-between">
            <Text  c="dimmed">Credit total</Text>
            <Text  fw={700} style={{ color: INK.text }}>Rs {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
          </Group>
          <Badge color={balanced ? "green" : "red"} variant="light" size="lg">
            {balanced
              ? "Balanced — ready to post"
              : `Unbalanced (diff Rs ${(totalDebit - totalCredit).toFixed(2)})`}
          </Badge>
          <Button
            fullWidth
            disabled={!balanced || lines.filter((l) => l.accountCode).length < 2}
            loading={saving}
            onClick={submit}
            styles={{ root: { fontWeight: 700 } }}
          >
            Post Entry
          </Button>
          {msg && (
            <Alert color={msg.ok ? "green" : "red"} variant="light">
              {msg.text}
            </Alert>
          )}
        </Stack>
      </Card>

      <Card withBorder shadow="sm" p="lg" style={{ gridColumn: "span 2" }}>
        <Group justify="space-between" mb="md">
          <Text fw={700} style={{ color: INK.text }}>Entry Lines</Text>
          <Button size="xs" variant="light" onClick={addLine}>
            Add line
          </Button>
        </Group>
        <ScrollArea style={{ maxHeight: 480 }}>
          <Stack gap="sm">
            {lines.map((line, index) => (
              <Box
                key={index}
                style={{
                  border: `1px solid ${INK.border}`,
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <Group align="flex-end" gap="sm">
                  <Select
                    label={index === 0 ? "Debit account" : "Account"}
                    placeholder="Select account"
                    data={accounts.map((a) => ({
                      value: a.code,
                      label: `${a.code} — ${a.name}`,
                    }))}
                    searchable
                    w={220}
                    value={line.accountCode || null}
                    onChange={(v) => updateLine(index, { accountCode: v ?? "" })}
                  />
                  <NumberInput
                    label="Debit (Rs)"
                    w={130}
                    min={0}
                    value={line.debitRs}
                    onChange={(v) => updateLine(index, { debitRs: typeof v === "number" ? v : 0 })}
                  />
                  <NumberInput
                    label="Credit (Rs)"
                    w={130}
                    min={0}
                    value={line.creditRs}
                    onChange={(v) => updateLine(index, { creditRs: typeof v === "number" ? v : 0 })}
                  />
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    color="red"
                    disabled={lines.length <= 2}
                    onClick={() => removeLine(index)}
                  >
                    Remove
                  </Button>
                </Group>
              </Box>
            ))}
          </Stack>
        </ScrollArea>
      </Card>
    </SimpleGrid>
  );
}
