import {
  Badge,
  Button,
  ColorInput,
  Divider,
  Group,
  Modal,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { Check, Palette, RotateCcw, Sliders, Sparkles } from "lucide-react";
import {
  ACCENT_PRESETS,
  type CanvasToneKey,
  type DensityMode,
  useSaCustomizer,
  useSaTheme,
} from "./saTheme";

interface CockpitCustomizerModalProps {
  opened: boolean;
  onClose: () => void;
}

export function CockpitCustomizerModal({
  opened,
  onClose,
}: CockpitCustomizerModalProps) {
  const { config, updateConfig, toggleWidget, resetDefaults } = useSaCustomizer();
  const tokens = useSaTheme();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Palette size={20} color={tokens.accent} />
          <Text fw={700}>Cockpit Customization Suite</Text>
          <Badge size="xs" variant="light" color="blue">
            Super Admin
          </Badge>
        </Group>
      }
      size="lg"
      radius="md"
      centered
    >
      <Stack gap="lg">
        {/* Accent Selection */}
        <div>
          <Group justify="space-between" mb="xs">
            <Text size="sm" fw={600}>
              Executive Accent Color
            </Text>
            <Text size="xs" c="dimmed">
              Current: {config.customHex || ACCENT_PRESETS.find(p => p.key === config.accentKey)?.name}
            </Text>
          </Group>
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs" mb="sm">
            {ACCENT_PRESETS.map((preset) => {
              const selected = config.accentKey === preset.key && !config.customHex;
              return (
                <UnstyledButton
                  key={preset.key}
                  onClick={() =>
                    updateConfig({ accentKey: preset.key, customHex: undefined })
                  }
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: `1.5px solid ${selected ? preset.hex : "var(--sa-border, #27272a)"}`,
                    background: selected ? "var(--sa-panelStrong, #181c26)" : "var(--sa-panel, #12151c)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 6,
                      background: preset.hex,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {selected && <Check size={12} color={preset.onAccent} />}
                  </span>
                  <Text size="xs" fw={selected ? 700 : 500} truncate>
                    {preset.name.split(" ")[1] ?? preset.name}
                  </Text>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>

          <ColorInput
            label="Custom Accent Hex"
            placeholder="#C9952A"
            value={config.customHex || ""}
            onChange={(val) => updateConfig({ customHex: val })}
            size="xs"
          />
        </div>

        <Divider />

        {/* Canvas Tone */}
        <div>
          <Text size="sm" fw={600} mb="xs">
            Dark Canvas Tone
          </Text>
          <SegmentedControl
            fullWidth
            size="xs"
            value={config.canvasTone}
            onChange={(val) => updateConfig({ canvasTone: val as CanvasToneKey })}
            data={[
              { label: "Pitch Obsidian", value: "pitch" },
              { label: "Charcoal Graphite", value: "charcoal" },
              { label: "Deep Steel", value: "steel" },
            ]}
          />
        </div>

        {/* Density Mode */}
        <div>
          <Text size="sm" fw={600} mb="xs">
            Interface Density Mode
          </Text>
          <SegmentedControl
            fullWidth
            size="xs"
            value={config.density}
            onChange={(val) => updateConfig({ density: val as DensityMode })}
            data={[
              { label: "Comfortable (Standard)", value: "comfortable" },
              { label: "Compact Operations (High Density)", value: "compact" },
            ]}
          />
        </div>

        <Divider />

        {/* Cockpit Widgets */}
        <div>
          <Group gap="xs" mb="xs">
            <Sliders size={16} />
            <Text size="sm" fw={600}>
              Overview Widget Layout
            </Text>
          </Group>
          <Stack gap="xs">
            <Switch
              label="Quick Action Launchpad"
              description="Top bar fast actions for new tenant, backup, and license issue"
              checked={config.widgets.showQuickActions}
              onChange={() => toggleWidget("showQuickActions")}
              size="sm"
            />
            <Switch
              label="System Telemetry Cards"
              description="Real-time latency, PostgreSQL pools, and storage health metrics"
              checked={config.widgets.showSystemTelemetry}
              onChange={() => toggleWidget("showSystemTelemetry")}
              size="sm"
            />
            <Switch
              label="Recent Tenants Table"
              description="Quick access list of newest registered organizations"
              checked={config.widgets.showRecentTenants}
              onChange={() => toggleWidget("showRecentTenants")}
              size="sm"
            />
            <Switch
              label="Cross-Tenant Audit Stream"
              description="Live audit event feed across all company operations"
              checked={config.widgets.showAuditStream}
              onChange={() => toggleWidget("showAuditStream")}
              size="sm"
            />
          </Stack>
        </div>

        <Divider />

        {/* Brand Personalization */}
        <div>
          <Group gap="xs" mb="xs">
            <Sparkles size={16} />
            <Text size="sm" fw={600}>
              Console Branding
            </Text>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <TextInput
              label="Cockpit Title"
              value={config.brandTitle}
              onChange={(e) => updateConfig({ brandTitle: e.currentTarget.value })}
              size="xs"
            />
            <TextInput
              label="Studio Subtitle"
              value={config.brandSubtitle}
              onChange={(e) => updateConfig({ brandSubtitle: e.currentTarget.value })}
              size="xs"
            />
          </SimpleGrid>
        </div>

        <Group justify="space-between" mt="md">
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<RotateCcw size={14} />}
            onClick={resetDefaults}
          >
            Reset to Defaults
          </Button>
          <Button
            size="xs"
            onClick={onClose}
            style={{
              background: tokens.accent,
              color: tokens.accentOnAccent,
            }}
          >
            Apply & Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
