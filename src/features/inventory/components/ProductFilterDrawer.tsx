import {
  Accordion,
  Badge,
  Box,
  Button,
  Drawer,
  Stack,
  Text,
} from "@mantine/core";
import { Check } from "lucide-react";
import { useI18n } from "../../../i18n/I18nProvider";
import type { PublicCategory } from "../../../types/backend";

interface ProductFilterDrawerProps {
  opened: boolean;
  onClose: () => void;
  selectedStatus: string;
  onSelectStatus: (status: string) => void;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  categories: PublicCategory[];
  totalProductsCount: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  filteredCount: number;
  categoryProductCounts: Map<string, number>;
}

export function ProductFilterDrawer({
  opened,
  onClose,
  selectedStatus,
  onSelectStatus,
  selectedCategory,
  onSelectCategory,
  categories,
  totalProductsCount,
  inStockCount,
  lowStockCount,
  outOfStockCount,
  filteredCount,
  categoryProductCounts,
}: ProductFilterDrawerProps) {
  const { dir } = useI18n();

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position={dir === "rtl" ? "left" : "right"}
      size={380}
      title={
        <Stack gap={2}>
          <Text fw={700} size="md" style={{ color: "var(--app-text)" }}>
            All Filters
          </Text>
          <Text size="xs" c="dimmed">
            Filter products by stock status and category
          </Text>
        </Stack>
      }
      styles={{
        content: {
          background: "var(--app-surface)",
          display: "flex",
          flexDirection: "column",
        },
        body: {
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
        },
        header: {
          borderBottom: "1px solid var(--app-border)",
          padding: "16px 20px",
        },
      }}
    >
      <Box style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        <Accordion
          defaultValue={["status", "category"]}
          multiple
          variant="separated"
          radius="md"
        >
          {/* Stock Condition Accordion */}
          <Accordion.Item
            value="status"
            style={{ background: "transparent", border: "none" }}
          >
            <Accordion.Control style={{ padding: "10px 4px" }}>
              <Text size="sm" fw={600}>
                Stock Condition
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap={4}>
                {[
                  {
                    id: "all",
                    label: "Any Condition",
                    count: totalProductsCount,
                  },
                  {
                    id: "in_stock",
                    label: "In Stock (≥10)",
                    count: inStockCount,
                  },
                  {
                    id: "low_stock",
                    label: "Low Stock (<10)",
                    count: lowStockCount,
                  },
                  {
                    id: "out_of_stock",
                    label: "Out of Stock (0)",
                    count: outOfStockCount,
                  },
                ].map((opt) => {
                  const active = selectedStatus === opt.id;
                  return (
                    <Box
                      key={opt.id}
                      onClick={() => onSelectStatus(opt.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: active
                          ? "var(--app-accent-soft)"
                          : "transparent",
                        color: active
                          ? "var(--app-accent)"
                          : "var(--app-text)",
                        fontWeight: active ? 600 : 500,
                        fontSize: 13,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <Check
                        size={16}
                        style={{
                          opacity: active ? 1 : 0,
                          transition: "opacity 0.15s ease",
                        }}
                      />
                      <Text size="sm" style={{ flex: 1 }}>
                        {opt.label}
                      </Text>
                      <Badge size="xs" variant={active ? "filled" : "outline"}>
                        {opt.count}
                      </Badge>
                    </Box>
                  );
                })}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          {/* Category Accordion */}
          <Accordion.Item
            value="category"
            style={{ background: "transparent", border: "none" }}
          >
            <Accordion.Control style={{ padding: "10px 4px" }}>
              <Text size="sm" fw={600}>
                Category
              </Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap={4}>
                <Box
                  onClick={() => onSelectCategory("all")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background:
                      selectedCategory === "all"
                        ? "var(--app-accent-soft)"
                        : "transparent",
                    color:
                      selectedCategory === "all"
                        ? "var(--app-accent)"
                        : "var(--app-text)",
                    fontWeight: selectedCategory === "all" ? 600 : 500,
                    fontSize: 13,
                  }}
                >
                  <Check
                    size={16}
                    style={{
                      opacity: selectedCategory === "all" ? 1 : 0,
                      transition: "opacity 0.15s ease",
                    }}
                  />
                  <Text size="sm" style={{ flex: 1 }}>
                    All Categories
                  </Text>
                  <Badge
                    size="xs"
                    variant={selectedCategory === "all" ? "filled" : "outline"}
                  >
                    {totalProductsCount}
                  </Badge>
                </Box>
                {categories.map((cat) => {
                  const active = selectedCategory === cat.id;
                  const count = categoryProductCounts.get(cat.id) ?? 0;
                  return (
                    <Box
                      key={cat.id}
                      onClick={() => onSelectCategory(cat.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: active
                          ? "var(--app-accent-soft)"
                          : "transparent",
                        color: active
                          ? "var(--app-accent)"
                          : "var(--app-text)",
                        fontWeight: active ? 600 : 500,
                        fontSize: 13,
                      }}
                    >
                      <Check
                        size={16}
                        style={{
                          opacity: active ? 1 : 0,
                          transition: "opacity 0.15s ease",
                        }}
                      />
                      <Text size="sm" style={{ flex: 1 }}>
                        {cat.name}
                      </Text>
                      <Badge size="xs" variant={active ? "filled" : "outline"}>
                        {count}
                      </Badge>
                    </Box>
                  );
                })}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Box>

      {/* Sticky Bottom Primary Action Button */}
      <Box
        p={16}
        style={{
          borderTop: "1px solid var(--app-border)",
          background: "var(--app-surface)",
        }}
      >
        <Button
          fullWidth
          size="md"
          radius="md"
          onClick={onClose}
          style={{
            background: "var(--app-accent)",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          Show {filteredCount} items
        </Button>
      </Box>
    </Drawer>
  );
}
