import { useEffect, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Card,
  ColorInput,
  Divider,
  Group,
  Image,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { Check, Trash2, Upload } from "lucide-react";
import {
  getErrorMessage,
  getTheme,
  openFileDialog,
  readFileBase64,
  updateTheme,
  type CompanyTheme,
} from "../../../api/backend";
import { useAppTheme } from "../../../theme/AppThemeProvider";
import { INK } from "../../../theme";

const DEFAULT_THEME: CompanyTheme = {
  primaryColor: "#1D2B54",
  secondaryColor: "#2E4178",
  accentColor: "#C9952A",
  colorScheme: "light",
  logoBase64: null,
  companyTagline: null,
  erpWatermark: "Powered by Ijaz & Company ERP",
};

export function ThemeBrandingTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { colorScheme, setColorScheme, setUserAccent } = useAppTheme();

  const form = useForm({
    initialValues: DEFAULT_THEME,
    validate: {
      primaryColor: (v: string) =>
        /^#[0-9a-fA-F]{6}$/.test(v) ? null : "Enter a valid hex color",
      secondaryColor: (v: string) =>
        /^#[0-9a-fA-F]{6}$/.test(v) ? null : "Enter a valid hex color",
      accentColor: (v: string) =>
        /^#[0-9a-fA-F]{6}$/.test(v) ? null : "Enter a valid hex color",
    },
  });

  useEffect(() => {
    getTheme()
      .then((t) => {
        form.setValues({ ...t, colorScheme });
        setLoading(false);
      })
      .catch((err) => {
        setError(getErrorMessage(err));
        setLoading(false);
      });
  }, []);

  async function handleSave(values: CompanyTheme) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { erpWatermark: _watermark, ...tenantFields } = values;
      const saved = await updateTheme(tenantFields);
      form.setValues(saved);
      if (saved.accentColor) {
        setUserAccent(saved.accentColor);
        if (typeof document !== "undefined") {
          document.documentElement.style.setProperty("--app-accent", saved.accentColor);
        }
        window.dispatchEvent(
          new CustomEvent("corbel_theme_updated", { detail: saved }),
        );
      }
      setSuccess("Theme & branding updated.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePickLogo() {
    const result = await openFileDialog({
      title: "Choose a Logo",
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg"] },
      ],
    });
    const path = Array.isArray(result) ? result[0] : result;
    if (!path) return;
    try {
      const dataUri = await readFileBase64(path);
      form.setFieldValue("logoBase64", dataUri);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (loading) return <Text c="dimmed">Loading...</Text>;

  return (
    <Card withBorder padding="lg" maw={760}>
      <Title order={5} mb="md">
        Theme & Branding
      </Title>
      <Text size="sm" c="dimmed" mb="lg">
        Customize the colors and branding used across the ERP — invoices, logo
        and watermark.
      </Text>
      <form onSubmit={form.onSubmit(handleSave)}>
        <Stack gap="md">
          {/* Brand colors */}
          <SimpleGrid cols={3}>
            <ColorInput
              label="Primary Color"
              format="hex"
              swatches={[INK.navy, INK.navySoft, "#283A6B", "#45619F"]}
              {...form.getInputProps("primaryColor")}
            />
            <ColorInput
              label="Secondary Color"
              format="hex"
              swatches={[INK.navySoft, "#354C85", "#6480BB", "#8FA4D1"]}
              {...form.getInputProps("secondaryColor")}
            />
            <ColorInput
              label="Accent Color"
              format="hex"
              swatches={[
                "#C9952A", // Corbel Gold
                "#2563EB", // Sapphire Blue
                "#059669", // Emerald Teal
                "#7C3AED", // Amethyst Purple
                "#DC2626", // Crimson Red
                "#D97706", // Amber Ochre
                "#06B6D4", // Sovereign Cyan
                "#71717A", // Zinc Slate
              ]}
              {...form.getInputProps("accentColor")}
            />
          </SimpleGrid>

          <SimpleGrid cols={2}>
            <Select
              label="Color Scheme"
              data={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "auto", label: "Auto (follow system)" },
              ]}
              {...form.getInputProps("colorScheme")}
              onChange={(value) => {
                form.setFieldValue("colorScheme", value ?? "light");
                if (value) setColorScheme(value);
              }}
            />
            <TextInput
              label="Company Tagline"
              placeholder="Your tagline here"
              {...form.getInputProps("companyTagline")}
            />
          </SimpleGrid>

          <Divider label="Logo" labelPosition="left" />

          <Group align="flex-start" gap="lg">
            <Box
              style={{
                width: 120,
                height: 120,
                borderRadius: 16,
                border: `1px dashed ${INK.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                background: INK.paper,
                position: "relative",
              }}
            >
              {form.values.logoBase64 ? (
                <Image
                  src={form.values.logoBase64}
                  alt="Company logo"
                  fit="contain"
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <Text size="xs" c="dimmed" ta="center" px="xs">
                  No logo set
                </Text>
              )}
              {form.values.logoBase64 && (
                <ActionIcon
                  size="sm"
                  color="red"
                  variant="filled"
                  style={{ position: "absolute", top: 6, right: 6 }}
                  onClick={() => form.setFieldValue("logoBase64", null)}
                >
                  <Trash2 size={14} />
                </ActionIcon>
              )}
            </Box>
            <Stack gap="xs">
              <Button
                variant="light"
                leftSection={<Upload size={15} />}
                onClick={handlePickLogo}
              >
                Upload Logo
              </Button>
              <Text size="xs" c="dimmed">
                PNG, JPG, SVG or GIF. Shown on invoices and reports.
              </Text>
            </Stack>
          </Group>

          {/* Live preview */}
          <Divider label="Preview" labelPosition="left" />
          <Box
            style={{
              borderRadius: 16,
              padding: 16,
              background:
                "linear-gradient(135deg, #10183A 0%, #16214A 55%, #1D2B54 100%)",
              color: "#fff",
            }}
          >
            <Group gap="sm">
              {form.values.logoBase64 ? (
                <Image
                  src={form.values.logoBase64}
                  alt="logo"
                  height={32}
                  fit="contain"
                />
              ) : (
                <Box
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: 13,
                    color: form.values.accentColor,
                    background: "rgba(255,255,255,0.08)",
                  }}
                >
                  I&
                </Box>
              )}
              <Box>
                <Text fw={700} size="sm">
                  Ijaz &amp; Company
                </Text>
                {form.values.companyTagline && (
                  <Text size="xs" style={{ color: "#A9B6D6" }}>
                    {form.values.companyTagline}
                  </Text>
                )}
              </Box>
              <Box
                style={{
                  marginLeft: "auto",
                  padding: "4px 10px",
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  background: form.values.accentColor,
                  color: "#ffffff",
                }}
              >
                INVOICE
              </Box>
            </Group>
            <Box
              mt="md"
              style={{
                height: 6,
                borderRadius: 3,
                background: form.values.accentColor,
                opacity: 0.9,
              }}
            />
            <Text size="xs" mt="md" style={{ color: "#A9B6D6" }}>
              {form.values.erpWatermark}
            </Text>
          </Box>

          {error && (
            <Text c="red" size="sm">
              {error}
            </Text>
          )}
          {success && (
            <Group gap={6} c="green">
              <Check size={14} />
              <Text c="green" size="sm">
                {success}
              </Text>
            </Group>
          )}
          <Group justify="flex-end">
            <Button type="submit" loading={saving}>
              Save Theme
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}
