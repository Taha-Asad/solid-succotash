import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Select,
  TextInput,
} from "@mantine/core";
import {
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { PublicCategory } from "../../../types/backend";

interface ProductsToolbarProps {
  totalProducts: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringBatchesCount: number;
  selectedStatus: string;
  onSelectStatus: (status: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  categories: PublicCategory[];
  onOpenFilterDrawer: () => void;
  onResetFilters: () => void;
  canManage: boolean;
  canCreate: boolean;
  onOpenImport?: () => void;
  onExportCsv: () => void;
  onAddProduct: () => void;
}

export function ProductsToolbar({
  totalProducts,
  inStockCount,
  lowStockCount,
  outOfStockCount,
  expiringBatchesCount,
  selectedStatus,
  onSelectStatus,
  query,
  onQueryChange,
  selectedCategory,
  onSelectCategory,
  categories,
  onOpenFilterDrawer,
  onResetFilters,
  canManage,
  canCreate,
  onOpenImport,
  onExportCsv,
  onAddProduct,
}: ProductsToolbarProps) {
  const statusTabs = [
    { id: "all", label: "All Items", count: totalProducts },
    { id: "in_stock", label: "In Stock", count: inStockCount, color: "green" },
    { id: "low_stock", label: "Low Stock", count: lowStockCount, color: "yellow" },
    { id: "out_of_stock", label: "Out of Stock", count: outOfStockCount, color: "red" },
    ...(expiringBatchesCount > 0
      ? [{ id: "expiring", label: "Expiring Soon", count: expiringBatchesCount, color: "orange" }]
      : []),
  ];

  const activeFiltersCount =
    (selectedCategory !== "all" ? 1 : 0) + (selectedStatus !== "all" ? 1 : 0);

  return (
    <>
      {/* Segmented Status View Tabs & Action Bar */}
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap={6} wrap="wrap">
          {statusTabs.map((tab) => {
            const active = selectedStatus === tab.id;
            return (
              <Button
                key={tab.id}
                size="xs"
                variant={active ? "filled" : "subtle"}
                color={active ? (tab.color ?? "blue") : "gray"}
                radius="pill"
                onClick={() => onSelectStatus(tab.id)}
                styles={{
                  root: {
                    fontWeight: active ? 700 : 500,
                    fontSize: 12,
                    background: active ? undefined : "transparent",
                    color: active ? "#ffffff" : "var(--app-text)",
                    border: active ? "none" : "1px solid var(--app-border)",
                    "&:hover": {
                      background: active ? undefined : "var(--app-soft)",
                    },
                  },
                }}
              >
                {tab.label}
                <Badge
                  size="xs"
                  variant={active ? "filled" : "outline"}
                  color={active ? "dark" : tab.color ?? "gray"}
                  ml={6}
                  style={{
                    backgroundColor: active ? "rgba(0,0,0,0.25)" : undefined,
                    color: active ? "#ffffff" : undefined,
                  }}
                >
                  {tab.count}
                </Badge>
              </Button>
            );
          })}
        </Group>

        <Group gap="sm">
          {onOpenImport && canManage && (
            <Button
              variant="default"
              radius="md"
              size="sm"
              leftSection={<FileSpreadsheet size={14} />}
              onClick={onOpenImport}
              data-tour="import-button"
              style={{
                borderColor: "var(--app-border)",
                background: "var(--app-surface)",
                color: "var(--app-text)",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Import
            </Button>
          )}

          <Button
            variant="default"
            radius="md"
            size="sm"
            leftSection={<Download size={14} />}
            onClick={onExportCsv}
            style={{
              borderColor: "var(--app-border)",
              background: "var(--app-surface)",
              color: "var(--app-text)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Export CSV
          </Button>

          {canCreate && (
            <Button
              radius="md"
              size="sm"
              onClick={onAddProduct}
              data-tour="add-product"
              leftSection={<Plus size={15} />}
              style={{
                background: "var(--app-accent)",
                color: "#ffffff",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Add Product
            </Button>
          )}
        </Group>
      </Group>

      {/* Toolbar: Search + Category Select + Filter Drawer Trigger */}
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="sm" style={{ flex: 1, minWidth: 280 }}>
          <TextInput
            placeholder="Search by name, SKU, category, supplier..."
            leftSection={<Search size={15} color="var(--app-muted)" />}
            rightSection={
              query ? (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => onQueryChange("")}
                >
                  <X size={12} />
                </ActionIcon>
              ) : null
            }
            value={query}
            onChange={(e) => onQueryChange(e.currentTarget.value)}
            radius="md"
            style={{ flex: 1, minWidth: 220 }}
            styles={{
              input: {
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
                color: "var(--app-text)",
                fontSize: 13,
              },
            }}
          />

          <Select
            placeholder="All Categories"
            data={[
              { value: "all", label: "All Categories" },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
            value={selectedCategory}
            onChange={(val) => onSelectCategory(val ?? "all")}
            radius="md"
            w={180}
            styles={{
              input: {
                background: "var(--app-surface)",
                borderColor: "var(--app-border)",
                color: "var(--app-text)",
                fontSize: 13,
              },
            }}
          />

          <Button
            variant="default"
            radius="md"
            leftSection={<SlidersHorizontal size={14} />}
            onClick={onOpenFilterDrawer}
            style={{
              borderColor:
                activeFiltersCount > 0
                  ? "var(--app-accent)"
                  : "var(--app-border)",
              background:
                activeFiltersCount > 0
                  ? "var(--app-accent-soft)"
                  : "var(--app-surface)",
              color:
                activeFiltersCount > 0
                  ? "var(--app-accent)"
                  : "var(--app-text)",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Filters
            {activeFiltersCount > 0 && (
              <Badge
                size="xs"
                variant="filled"
                ml={6}
                style={{ background: "var(--app-accent)" }}
              >
                {activeFiltersCount}
              </Badge>
            )}
          </Button>

          {(selectedCategory !== "all" ||
            selectedStatus !== "all" ||
            query) && (
            <Button
              variant="subtle"
              size="xs"
              color="gray"
              onClick={onResetFilters}
            >
              Reset All
            </Button>
          )}
        </Group>
      </Group>
    </>
  );
}
