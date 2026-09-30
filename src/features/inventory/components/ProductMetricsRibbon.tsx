import { Badge, Box, Button, Group, SimpleGrid, Text } from "@mantine/core";
import { AlertTriangle, CalendarClock, ChevronRight } from "lucide-react";
import { LEDGER_NUM } from "../utils/inventoryHelpers";

interface ProductMetricsRibbonProps {
  totalProducts: number;
  totalValue: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringBatchesCount: number;
  selectedStatus: string;
  onSelectStatus: (status: string) => void;
}

export function ProductMetricsRibbon({
  totalProducts,
  totalValue,
  inStockCount,
  lowStockCount,
  outOfStockCount,
  expiringBatchesCount,
  selectedStatus,
  onSelectStatus,
}: ProductMetricsRibbonProps) {
  return (
    <>
      {/* ---- Executive Metrics Ribbon (Interactive & Glanceable) ---- */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        {/* Metric 1: Total Catalog */}
        <Box
          p={16}
          onClick={() => onSelectStatus("all")}
          style={{
            background: "var(--app-surface)",
            border:
              selectedStatus === "all"
                ? "2px solid var(--app-accent)"
                : "1px solid var(--app-border)",
            borderRadius: 14,
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 110,
          }}
        >
          <Group justify="space-between" align="center">
            <Text
              size="xs"
              fw={700}
              style={{
                color: "var(--app-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Total Catalog
            </Text>
            <Badge size="xs" variant="light" color="blue">
              All SKUs
            </Badge>
          </Group>
          <Group justify="space-between" align="baseline" mt={6}>
            <Text
              fw={800}
              size="26px"
              style={{
                ...LEDGER_NUM,
                color: "var(--app-text)",
                lineHeight: 1,
              }}
            >
              {totalProducts.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              Valuation:{" "}
              <strong style={{ color: "var(--app-text)", ...LEDGER_NUM }}>
                Rs.{" "}
                {(totalValue / 100).toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                })}
              </strong>
            </Text>
          </Group>
        </Box>

        {/* Metric 2: In Stock (Healthy) */}
        <Box
          p={16}
          onClick={() => onSelectStatus("in_stock")}
          style={{
            background: "var(--app-surface)",
            border:
              selectedStatus === "in_stock"
                ? "2px solid #10b981"
                : "1px solid var(--app-border)",
            borderRadius: 14,
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 110,
          }}
        >
          <Group justify="space-between" align="center">
            <Text
              size="xs"
              fw={700}
              style={{
                color: "var(--app-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              In Stock
            </Text>
            <Badge size="xs" variant="light" color="green">
              Healthy
            </Badge>
          </Group>
          <Group justify="space-between" align="baseline" mt={6}>
            <Text
              fw={800}
              size="26px"
              style={{ ...LEDGER_NUM, color: "#10b981", lineHeight: 1 }}
            >
              {inStockCount.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              Ready for billing
            </Text>
          </Group>
        </Box>

        {/* Metric 3: Low Stock Warning */}
        <Box
          p={16}
          onClick={() => onSelectStatus("low_stock")}
          style={{
            background: "var(--app-surface)",
            border:
              selectedStatus === "low_stock"
                ? "2px solid #f59e0b"
                : "1px solid var(--app-border)",
            borderRadius: 14,
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 110,
          }}
        >
          <Group justify="space-between" align="center">
            <Text
              size="xs"
              fw={700}
              style={{
                color: "var(--app-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Low Stock Warning
            </Text>
            <Badge
              size="xs"
              variant="light"
              color="yellow"
              leftSection={<AlertTriangle size={10} />}
            >
              &lt;10 Units
            </Badge>
          </Group>
          <Group justify="space-between" align="baseline" mt={6}>
            <Text
              fw={800}
              size="26px"
              style={{
                ...LEDGER_NUM,
                color: lowStockCount > 0 ? "#f59e0b" : "var(--app-text)",
                lineHeight: 1,
              }}
            >
              {lowStockCount.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              {lowStockCount > 0 ? "Reorder needed" : "Adequately stocked"}
            </Text>
          </Group>
        </Box>

        {/* Metric 4: Out of Stock */}
        <Box
          p={16}
          onClick={() => onSelectStatus("out_of_stock")}
          style={{
            background: "var(--app-surface)",
            border:
              selectedStatus === "out_of_stock"
                ? "2px solid #ef4444"
                : "1px solid var(--app-border)",
            borderRadius: 14,
            cursor: "pointer",
            transition: "all 0.15s ease",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 110,
          }}
        >
          <Group justify="space-between" align="center">
            <Text
              size="xs"
              fw={700}
              style={{
                color: "var(--app-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Out of Stock
            </Text>
            <Badge size="xs" variant="light" color="red">
              0 Units
            </Badge>
          </Group>
          <Group justify="space-between" align="baseline" mt={6}>
            <Text
              fw={800}
              size="26px"
              style={{
                ...LEDGER_NUM,
                color: outOfStockCount > 0 ? "#ef4444" : "var(--app-text)",
                lineHeight: 1,
              }}
            >
              {outOfStockCount.toLocaleString()}
            </Text>
            <Text size="xs" c="dimmed">
              {outOfStockCount > 0 ? "Unavailable for sale" : "No depleted items"}
            </Text>
          </Group>
        </Box>
      </SimpleGrid>

      {/* ---- Expiring Batches Quick Alert Banner ---- */}
      {expiringBatchesCount > 0 && selectedStatus !== "expiring" && (
        <Box
          p="sm"
          style={{
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <Group gap={8}>
            <CalendarClock size={17} color="#f59e0b" />
            <Text size="xs" fw={600} style={{ color: "var(--app-text)" }}>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                {expiringBatchesCount} batch(es)
              </span>{" "}
              expire within 30 days. Review expiry dates and manage write-offs.
            </Text>
          </Group>
          <Button
            size="xs"
            variant="light"
            color="yellow"
            radius="md"
            onClick={() => onSelectStatus("expiring")}
            rightSection={<ChevronRight size={13} />}
          >
            Review Expiring Batches ({expiringBatchesCount})
          </Button>
        </Box>
      )}
    </>
  );
}
