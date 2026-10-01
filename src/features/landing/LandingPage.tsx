import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  ArrowRight,
  Check,
  CreditCard,
  Database,
  Download,
  Layers,
  Printer,
  QrCode,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Zap,
} from "lucide-react";

import { CorbelSquircle } from "../../components/CorbelLogo";

interface LandingPageProps {
  onEnterApp?: () => void;
}

export default function LandingPage({ onEnterApp }: LandingPageProps) {
  // ROI Calculator states
  const [dailyInvoices, setDailyInvoices] = useState(60);
  const [branchCount, setBranchCount] = useState(2);

  // Dynamic calculations
  const hoursSavedPerMonth = Math.round((dailyInvoices * 2.5 * 30 * branchCount) / 60);
  const leakagePreventedYearly = dailyInvoices * 450 * 365 * branchCount * 0.03;

  const formatPKR = (amount: number) => {
    return `PKR ${Math.round(amount).toLocaleString("en-PK")}`;
  };

  return (
    <Box
      style={{
        minHeight: "100vh",
        background: "#070B19",
        color: "#F8FAFC",
        fontFamily: "'Outfit', sans-serif",
        overflowX: "hidden",
      }}
    >
      {/* Navigation Header */}
      <Box
        component="header"
        style={{
          borderBottom: "1px solid rgba(201, 149, 42, 0.15)",
          background: "rgba(14, 21, 40, 0.85)",
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 100,
          padding: "16px 32px",
        }}
      >
        <Container size="xl">
          <Group justify="space-between">
            <Group gap="sm">
              <CorbelSquircle size={34} variant="gold" />
              <Stack gap={0}>
                <Group gap={6}>
                  <Text fw={800} size="lg" style={{ letterSpacing: 1, color: "#F8FAFC" }}>
                    CORBEL
                  </Text>
                  <Badge size="xs" color="yellow" variant="light">
                    v1.3.0
                  </Badge>
                </Group>
                <Text size="10px" c="dimmed" style={{ letterSpacing: 0.5 }}>
                  SOVEREIGN FINANCIAL CORE
                </Text>
              </Stack>
            </Group>

            <Group gap="md">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  const el = document.getElementById("features");
                  el?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Capabilities
              </Button>
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  const el = document.getElementById("calculator");
                  el?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                ROI Calculator
              </Button>
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  const el = document.getElementById("pricing");
                  el?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Pricing
              </Button>
              {onEnterApp && (
                <Button
                  onClick={onEnterApp}
                  variant="gradient"
                  gradient={{ from: "#C9952A", to: "#E6C965", deg: 135 }}
                  style={{ color: "#070B19", fontWeight: 700 }}
                  rightSection={<ArrowRight size={16} />}
                >
                  Launch App
                </Button>
              )}
            </Group>
          </Group>
        </Container>
      </Box>

      {/* HERO SECTION */}
      <Box
        style={{
          padding: "80px 16px 60px",
          background: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(201, 149, 42, 0.15), transparent 70%)",
        }}
      >
        <Container size="lg" ta="center">
          <Badge
            size="lg"
            variant="outline"
            color="yellow"
            mb="lg"
            style={{
              borderColor: "rgba(201, 149, 42, 0.4)",
              background: "rgba(201, 149, 42, 0.05)",
              letterSpacing: 0.5,
              textTransform: "uppercase",
            }}
          >
            Offline-First Desktop ERP • FBR PRAL Digital Invoicing Compliant
          </Badge>

          <Title
            order={1}
            style={{
              fontSize: "clamp(36px, 5vw, 60px)",
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: -0.5,
              maxWidth: 900,
              margin: "0 auto",
              background: "linear-gradient(180deg, #FFFFFF 0%, #CBD5E1 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            The Sovereign Financial Core Built for Merchants Who Refuse Cloud Lock-In.
          </Title>

          <Text
            size="lg"
            c="dimmed"
            mt="lg"
            mb="xl"
            maw={740}
            mx="auto"
            style={{ lineHeight: 1.6 }}
          >
            Lightning-fast Point of Sale, automated double-entry ledger, multi-branch inventory, and FBR fiscal compliance — with <strong>0ms local latency</strong> and <strong>100% offline autonomy</strong>.
          </Text>

          <Group justify="center" gap="md" mb={50}>
            {onEnterApp && (
              <Button
                size="lg"
                onClick={onEnterApp}
                variant="gradient"
                gradient={{ from: "#C9952A", to: "#E6C965", deg: 135 }}
                style={{ color: "#070B19", fontWeight: 700, height: 52, padding: "0 32px" }}
                rightSection={<ArrowRight size={18} />}
              >
                Open Corbel Desktop
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              color="yellow"
              style={{
                height: 52,
                padding: "0 28px",
                borderColor: "rgba(201, 149, 42, 0.4)",
                color: "#E6C965",
              }}
              leftSection={<Download size={18} />}
            >
              Download Windows / Linux Installer
            </Button>
          </Group>

          {/* Social Proof Trust Bar */}
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" maw={860} mx="auto">
            <Group justify="center" gap="xs">
              <ShieldCheck size={18} color="#C9952A" />
              <Text size="xs" fw={600} c="#CBD5E1">
                519 Verified Tests
              </Text>
            </Group>
            <Group justify="center" gap="xs">
              <Zap size={18} color="#10B981" />
              <Text size="xs" fw={600} c="#CBD5E1">
                0ms Cloud Latency
              </Text>
            </Group>
            <Group justify="center" gap="xs">
              <QrCode size={18} color="#38BDF8" />
              <Text size="xs" fw={600} c="#CBD5E1">
                FBR SRO 581 Certified
              </Text>
            </Group>
            <Group justify="center" gap="xs">
              <Database size={18} color="#A855F7" />
              <Text size="xs" fw={600} c="#CBD5E1">
                Local SQLite Sovereign
              </Text>
            </Group>
          </SimpleGrid>
        </Container>
      </Box>

      {/* INTERACTIVE INTERFACE SHOWCASE PREVIEW */}
      <Container size="xl" mb={80}>
        <Box
          style={{
            borderRadius: 16,
            border: "1px solid rgba(201, 149, 42, 0.3)",
            background: "#0E1528",
            padding: 8,
            boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 40px rgba(201, 149, 42, 0.1)",
          }}
        >
          {/* Mock Window Top Bar */}
          <Group justify="space-between" px="md" py="xs" style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <Group gap={6}>
              <Box w={10} h={10} style={{ borderRadius: "50%", background: "#EF4444" }} />
              <Box w={10} h={10} style={{ borderRadius: "50%", background: "#F59E0B" }} />
              <Box w={10} h={10} style={{ borderRadius: "50%", background: "#10B981" }} />
            </Group>
            <Text size="xs" c="dimmed" fw={500}>
              Corbel ERP — High-Density Point of Sale & Treasury Engine
            </Text>
            <Badge size="xs" color="green" variant="dot">
              Local Engine Active (WAL)
            </Badge>
          </Group>

          {/* Window Mock Content */}
          <Box p="lg">
            <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" mb="md">
              <Card p="md" style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: 10 }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Today's Cash Flow
                </Text>
                <Text fw={700} size="24px" mt={4} style={{ color: "#E6C965" }}>
                  PKR 482,900
                </Text>
                <Text size="xs" c="green" mt={2}>
                  +18.4% vs yesterday • Cash-in-hand isolated
                </Text>
              </Card>

              <Card p="md" style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: 10 }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  FBR Digital Invoices
                </Text>
                <Text fw={700} size="24px" mt={4} c="#38BDF8">
                  142 Synced
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  0 in retry queue • PRAL QR code attached
                </Text>
              </Card>

              <Card p="md" style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: 10 }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Customer Khata Receivables
                </Text>
                <Text fw={700} size="24px" mt={4} c="#F87171">
                  PKR 1,290,450
                </Text>
                <Text size="xs" c="dimmed" mt={2}>
                  Walk-in cash isolated • 32 credit accounts
                </Text>
              </Card>
            </SimpleGrid>

            {/* Quick Feature Strip */}
            <Group justify="space-between" p="sm" style={{ background: "rgba(201, 149, 42, 0.05)", borderRadius: 8 }}>
              <Group gap="xs">
                <Printer size={16} color="#C9952A" />
                <Text size="xs" fw={600}>
                  Auto 80mm/58mm Thermal ESC/POS Receipt Printing with Urdu/English Subtext
                </Text>
              </Group>
              <Badge color="yellow" variant="light" size="sm">
                Instant F1 Cash Finalize
              </Badge>
            </Group>
          </Box>
        </Box>
      </Container>

      {/* CORE PILLARS / CAPABILITIES */}
      <Box id="features" py={80} style={{ background: "#0A1024" }}>
        <Container size="xl">
          <Stack align="center" ta="center" mb={60}>
            <Badge color="yellow" variant="light">
              ARCHITECTURE & CAPABILITIES
            </Badge>
            <Title order={2} style={{ fontSize: 36, fontWeight: 700 }}>
              Engineered Specifically for Commercial Independence
            </Title>
            <Text c="dimmed" maw={640}>
              Cloud-only ERPs leave you helpless during ISP outages and charge recurring taxes on your own data. Corbel restores your sovereignty.
            </Text>
          </Stack>

          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xl">
            <Card
              p="xl"
              style={{
                background: "#0E1528",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 16,
              }}
            >
              <ThemeIcon color="yellow" variant="light" size={48} mb="md" radius="md">
                <ShoppingCart size={24} color="#C9952A" />
              </ThemeIcon>
              <Title order={4} mb="xs">
                Cash-First POS & Bazaar Khata
              </Title>
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                Designed for bazaar speed. Finalize retail transactions in under 2 seconds. Seamlessly isolate Walk-in cash customers from credit ledger Khata to prevent debt contamination.
              </Text>
            </Card>

            <Card
              p="xl"
              style={{
                background: "#0E1528",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 16,
              }}
            >
              <ThemeIcon color="cyan" variant="light" size={48} mb="md" radius="md">
                <QrCode size={24} color="#38BDF8" />
              </ThemeIcon>
              <Title order={4} mb="xs">
                FBR Fiscal Digital Invoicing
              </Title>
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                Full compliance with Pakistani tax laws (SRO 581). Generates authenticated FBR QR codes, submits JSON payloads to PRAL, and supports atomic credit and debit notes with offline retry queues.
              </Text>
            </Card>

            <Card
              p="xl"
              style={{
                background: "#0E1528",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 16,
              }}
            >
              <ThemeIcon color="green" variant="light" size={48} mb="md" radius="md">
                <Receipt size={24} color="#10B981" />
              </ThemeIcon>
              <Title order={4} mb="xs">
                Double-Entry Accounting Ledger
              </Title>
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                Never guess your true bottom line. Automated reversing journal entries for voided sales, real-time Profit & Loss calculation, Trial Balance, and full customer statement reconciliation.
              </Text>
            </Card>

            <Card
              p="xl"
              style={{
                background: "#0E1528",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 16,
              }}
            >
              <ThemeIcon color="violet" variant="light" size={48} mb="md" radius="md">
                <Layers size={24} color="#A855F7" />
              </ThemeIcon>
              <Title order={4} mb="xs">
                Multi-Branch & Expiry Batches
              </Title>
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                Track inventory across retail counters and godowns. Automated FIFO batch tracking, impending expiration alerts, and certified write-off journals.
              </Text>
            </Card>

            <Card
              p="xl"
              style={{
                background: "#0E1528",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 16,
              }}
            >
              <ThemeIcon color="blue" variant="light" size={48} mb="md" radius="md">
                <ShieldCheck size={24} color="#3B82F6" />
              </ThemeIcon>
              <Title order={4} mb="xs">
                Bank-Grade Local Security
              </Title>
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                Zero plain-text passwords. Hardened with Argon2id cryptographic hashing, parameterized SQL execution preventing SQL injection, and automated encrypted offline backup dumps.
              </Text>
            </Card>

            <Card
              p="xl"
              style={{
                background: "#0E1528",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 16,
              }}
            >
              <ThemeIcon color="orange" variant="light" size={48} mb="md" radius="md">
                <CreditCard size={24} color="#F97316" />
              </ThemeIcon>
              <Title order={4} mb="xs">
                Modular Flexibility
              </Title>
              <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                Core un-deactivatable essentials (Inventory, Invoices, Settings) with toggleable optional modules. Customize your workflow to fit your exact retail counter needs.
              </Text>
            </Card>
          </SimpleGrid>
        </Container>
      </Box>

      {/* ROI & SAVINGS CALCULATOR */}
      <Box id="calculator" py={80}>
        <Container size="md">
          <Card
            p={40}
            style={{
              background: "#0E1528",
              border: "1px solid rgba(201, 149, 42, 0.4)",
              borderRadius: 20,
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            }}
          >
            <Stack align="center" ta="center" mb={30}>
              <Badge color="yellow" variant="light">
                EFFICIENCY & ROI CALCULATOR
              </Badge>
              <Title order={3}>Calculate Your Time & Profit Recovered</Title>
              <Text size="sm" c="dimmed">
                See how much time and money Corbel ERP recovers for your business every single month.
              </Text>
            </Stack>

            <Stack gap="xl" mb={40}>
              <Box>
                <Group justify="space-between" mb="xs">
                  <Text fw={600} size="sm">
                    Daily Invoices / Transactions
                  </Text>
                  <Text fw={700} c="#E6C965">
                    {dailyInvoices} invoices / day
                  </Text>
                </Group>
                <Slider
                  value={dailyInvoices}
                  onChange={setDailyInvoices}
                  min={10}
                  max={500}
                  step={5}
                  color="yellow"
                />
              </Box>

              <Box>
                <Group justify="space-between" mb="xs">
                  <Text fw={600} size="sm">
                    Retail Branches / Registers
                  </Text>
                  <Text fw={700} c="#E6C965">
                    {branchCount} {branchCount === 1 ? "outlet" : "outlets"}
                  </Text>
                </Group>
                <Slider
                  value={branchCount}
                  onChange={setBranchCount}
                  min={1}
                  max={10}
                  step={1}
                  color="yellow"
                />
              </Box>
            </Stack>

            <Divider mb="xl" color="rgba(255, 255, 255, 0.08)" />

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
              <Box ta="center" p="md" style={{ background: "rgba(255, 255, 255, 0.03)", borderRadius: 12 }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Admin Time Saved
                </Text>
                <Text fw={800} size="32px" mt={4} c="#10B981">
                  ~{hoursSavedPerMonth} Hours
                </Text>
                <Text size="xs" c="dimmed">
                  per month in manual bookkeeping
                </Text>
              </Box>

              <Box ta="center" p="md" style={{ background: "rgba(201, 149, 42, 0.05)", borderRadius: 12 }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Estimated Leakage Prevented
                </Text>
                <Text fw={800} size="28px" mt={4} style={{ color: "#E6C965" }}>
                  {formatPKR(leakagePreventedYearly)}
                </Text>
                <Text size="xs" c="dimmed">
                  saved annually via stock & credit controls
                </Text>
              </Box>
            </SimpleGrid>
          </Card>
        </Container>
      </Box>

      {/* PRICING PLANS */}
      <Box id="pricing" py={80} style={{ background: "#0A1024" }}>
        <Container size="xl">
          <Stack align="center" ta="center" mb={50}>
            <Badge color="yellow" variant="light">
              TRANSPARENT COMMERCIAL PRICING
            </Badge>
            <Title order={2} style={{ fontSize: 36, fontWeight: 700 }}>
              Sovereign Pricing. No Hidden Transaction Fees.
            </Title>
            <Text c="dimmed" maw={600}>
              Choose the license that matches your operational scale. All packages include local data ownership.
            </Text>
          </Stack>

          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="xl">
            {/* Basic */}
            <Card
              p="xl"
              style={{
                background: "#0E1528",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 16,
              }}
            >
              <Text fw={700} size="xl" mb="xs">
                Basic
              </Text>
              <Text size="xs" c="dimmed" mb="lg">
                Single outlet, core ERP functionality for small shops.
              </Text>
              <Text fw={800} size="32px" mb="lg" style={{ color: "#F8FAFC" }}>
                PKR 0
                <Text span size="xs" c="dimmed" fw={400} ml={4}>
                  / forever free
                </Text>
              </Text>
              <Divider mb="lg" color="rgba(255, 255, 255, 0.08)" />
              <Stack gap="sm" mb="xl">
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Single retail branch</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Up to 5 operator accounts</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Cash-first POS & Invoicing</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Customer Khata ledger</Text>
                </Group>
              </Stack>
            </Card>

            {/* Standard */}
            <Card
              p="xl"
              style={{
                background: "#0E1528",
                border: "2px solid #C9952A",
                borderRadius: 16,
                position: "relative",
              }}
            >
              <Badge
                color="yellow"
                variant="filled"
                style={{ position: "absolute", top: -12, right: 24, fontWeight: 700 }}
              >
                MOST POPULAR
              </Badge>
              <Text fw={700} size="xl" mb="xs">
                Standard
              </Text>
              <Text size="xs" c="dimmed" mb="lg">
                Growing merchants needing Excel bulk import & multi-branch.
              </Text>
              <Text fw={800} size="32px" mb="lg" style={{ color: "#E6C965" }}>
                PKR 1,499
                <Text span size="xs" c="dimmed" fw={400} ml={4}>
                  / month
                </Text>
              </Text>
              <Divider mb="lg" color="rgba(255, 255, 255, 0.08)" />
              <Stack gap="sm" mb="xl">
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Up to 3 retail branches</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Up to 15 operator accounts</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Full Excel Import Wizard</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Double-Entry Chart of Accounts</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Expiry batch management</Text>
                </Group>
              </Stack>
            </Card>

            {/* Premium */}
            <Card
              p="xl"
              style={{
                background: "#0E1528",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 16,
              }}
            >
              <Text fw={700} size="xl" mb="xs">
                Premium
              </Text>
              <Text size="xs" c="dimmed" mb="lg">
                Enterprise retail chains with FBR compliance & high volume.
              </Text>
              <Text fw={800} size="32px" mb="lg" style={{ color: "#F8FAFC" }}>
                PKR 4,999
                <Text span size="xs" c="dimmed" fw={400} ml={4}>
                  / month
                </Text>
              </Text>
              <Divider mb="lg" color="rgba(255, 255, 255, 0.08)" />
              <Stack gap="sm" mb="xl">
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Unlimited branches & registers</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Unlimited users & custom roles</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">FBR Digital Invoicing & PRAL QR</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Multi-currency exchange rates</Text>
                </Group>
                <Group gap="xs">
                  <Check size={16} color="#10B981" />
                  <Text size="sm">Priority SLA & Database Migration</Text>
                </Group>
              </Stack>
            </Card>
          </SimpleGrid>
        </Container>
      </Box>

      {/* FOOTER */}
      <Box
        component="footer"
        py={50}
        style={{
          borderTop: "1px solid rgba(201, 149, 42, 0.15)",
          background: "#070B19",
        }}
      >
        <Container size="xl">
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <CorbelSquircle size={28} variant="gold" />
              <Text fw={700} size="md" c="#F8FAFC">
                CORBEL ERP
              </Text>
              <Text size="xs" c="dimmed">
                • Built by The Foolish Crow Studio
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              © 2026 Corbel ERP. All rights reserved. Locally verified and sovereign.
            </Text>
          </Group>
        </Container>
      </Box>
    </Box>
  );
}
