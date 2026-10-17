import { ActionIcon, Button, CopyButton, Group, Stack, Text, Tooltip } from "@mantine/core";
import { Check, Copy, ExternalLink, Headphones, Mail } from "lucide-react";

export const TAHA_CONTACT = {
  name: "Taha Asadullah",
  handle: "@thefoolishcrow",
  studio: "The Foolish Crow Studio",
  email: "tahaasad709@gmail.com",
  githubUrl: "https://github.com/Taha-Asad",
} as const;

interface SupportContactCardProps {
  variant?: "light" | "dark";
  compact?: boolean;
  contextNote?: string;
}

export default function SupportContactCard({
  variant = "light",
  compact = false,
  contextNote = "Need a license key, plan upgrade (3,400 / 4,200 / 6,000 PKR), or setup help?",
}: SupportContactCardProps) {
  const isDark = variant === "dark";

  const bg = isDark
    ? "rgba(15, 23, 42, 0.72)"
    : "linear-gradient(135deg, rgba(201, 149, 42, 0.08), rgba(15, 23, 42, 0.03))";
  const border = isDark
    ? "1px solid rgba(224, 114, 95, 0.28)"
    : "1px solid rgba(201, 149, 42, 0.28)";
  const titleColor = isDark ? "#F8FAFC" : "#0F172A";
  const subColor = isDark ? "#94A3B8" : "#475569";
  const accentColor = isDark ? "#E0725F" : "#B7811E";

  const mailtoHref = `mailto:${TAHA_CONTACT.email}?subject=${encodeURIComponent(
    "Corbel ERP — License / Subscription Support",
  )}`;

  return (
    <div
      style={{
        width: "100%",
        background: bg,
        border,
        borderRadius: 12,
        padding: compact ? "10px 14px" : "12px 16px",
        textAlign: "left",
      }}
    >
      <Stack gap={6}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap={8} wrap="nowrap">
            <Headphones size={15} color={accentColor} style={{ flexShrink: 0 }} />
            <Text size="xs" fw={700} style={{ color: titleColor }}>
              Direct Developer & Licensing Support
            </Text>
          </Group>
          <Text size="xs" fw={700} style={{ color: accentColor }}>
            {TAHA_CONTACT.name}
          </Text>
        </Group>

        <Text size="xs" style={{ color: subColor, lineHeight: 1.45 }}>
          {contextNote}
        </Text>

        <Group justify="space-between" align="center" gap="xs" mt={2} wrap="wrap">
          <Group gap={6} wrap="nowrap">
            <Mail size={13} color={accentColor} />
            <Text
              size="xs"
              ff="monospace"
              fw={600}
              style={{ color: titleColor, letterSpacing: 0.2 }}
            >
              {TAHA_CONTACT.email}
            </Text>
            <CopyButton value={TAHA_CONTACT.email} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Email copied!" : "Copy email address"}>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color={copied ? "teal" : "gray"}
                    onClick={copy}
                    aria-label="Copy support email"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>

          <Group gap={6}>
            <Button
              component="a"
              href={mailtoHref}
              size="compact-xs"
              variant={isDark ? "light" : "filled"}
              color={isDark ? "orange" : "dark"}
              leftSection={<Mail size={12} />}
              rightSection={<ExternalLink size={11} />}
              styles={{
                root: {
                  fontWeight: 600,
                },
              }}
            >
              Contact Taha
            </Button>
          </Group>
        </Group>
      </Stack>
    </div>
  );
}
