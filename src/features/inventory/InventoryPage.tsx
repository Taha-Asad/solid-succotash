import { useState } from "react";
import { Box, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Package, Tags, Truck } from "lucide-react";
import type { PublicUser } from "../../types/backend";
import { ProductsTab } from "./tabs/ProductsTab";
import { CategoriesTab } from "./tabs/CategoriesTab";
import { SuppliersTab } from "./tabs/SuppliersTab";

interface InventoryPageProps {
  user: PublicUser;
  /** Navigate to the standalone Import Wizard module instead of mounting it inline. */
  onOpenImport?: () => void;
}

export default function InventoryPage({ onOpenImport }: InventoryPageProps) {
  const isMobileHeader = useMediaQuery("(max-width: 36em)");
  const [isFormMode, setIsFormMode] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>("products");

  return (
    <Stack gap="lg">
      {!isFormMode && (
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
          <Stack gap={4}>
            <Box
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "var(--app-accent-soft)",
                color: "var(--app-accent)",
                borderRadius: 999,
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.6px",
                textTransform: "uppercase",
                width: "fit-content",
              }}
            >
              <Package size={12} />
              <span>Inventory Workspace</span>
            </Box>
            <Title
              order={2}
              style={{
                color: "var(--app-text)",
                letterSpacing: -0.4,
                fontWeight: 800,
              }}
            >
              Inventory Management
            </Title>
            <Text size="sm" c="dimmed">
              Unified catalog for live stock tracking, batch expirations, pricing
              margins, and supplier records.
            </Text>
          </Stack>
        </Group>
      )}

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        variant="pills"
        radius="md"
        className="inventory-tabs"
      >
        {!isFormMode && (
          <Tabs.List grow={isMobileHeader}>
            <Tabs.Tab value="products" leftSection={<Package size={15} />}>
              Products Catalog
            </Tabs.Tab>
            <Tabs.Tab value="categories" leftSection={<Tags size={15} />}>
              Categories
            </Tabs.Tab>
            <Tabs.Tab value="suppliers" leftSection={<Truck size={15} />}>
              Suppliers
            </Tabs.Tab>
          </Tabs.List>
        )}

        <Tabs.Panel value="products" pt={isFormMode ? 0 : "md"}>
          <ProductsTab
            onFormModeChange={setIsFormMode}
            onOpenImport={onOpenImport}
          />
        </Tabs.Panel>

        <Tabs.Panel value="categories" pt="md">
          <CategoriesTab />
        </Tabs.Panel>

        <Tabs.Panel value="suppliers" pt="md">
          <SuppliersTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
