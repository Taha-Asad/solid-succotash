import React from "react";
import { Badge, Box, Stack, Text } from "@mantine/core";
import { parseDateOnly } from "../../../components/AppDateInput";
import { INK } from "../../../theme";
import type { PublicProduct } from "../../../types/backend";

// Monospace, tabular numerals for anything that is a quantity of money or units
export const LEDGER_NUM: React.CSSProperties = {
  fontFamily:
    'ui-monospace, "SF Mono", "Roboto Mono", "JetBrains Mono", Menlo, monospace',
  fontVariantNumeric: "tabular-nums",
};

// Convert paisa to display string: 1500 → "15.00"
export function paisaToDisplay(paisa: number): string {
  return (paisa / 100).toFixed(2);
}

// Convert display string to paisa: "15.00" → 1500
export function displayToPaisa(display: string | number): number {
  if (typeof display === "number") return Math.round(display * 100);
  const cleaned = String(display).replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

// Format date for display
export function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

// Days from today until the given date-only string (negative = already past).
export function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round(
    (parseDateOnly(dateStr).getTime() - today.getTime()) / 86400000
  );
}

// Reusable empty state component
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Stack align="center" gap={4} py={48}>
      <Box
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: INK.goldSoft,
          color: INK.gold,
        }}
      >
        {icon}
      </Box>
      <Text fw={600} size="sm" mt={8} style={{ color: INK.text }}>
        {title}
      </Text>
      <Text size="xs" c="dimmed" ta="center" maw={320}>
        {description}
      </Text>
    </Stack>
  );
}

// Reusable product visual avatar initial generator
export function getProductInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "PR";
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

// Consistent subtle hue based on product name hash
export function getProductColor(name: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hues = [
    { bg: "rgba(59, 130, 246, 0.12)", text: "#3b82f6" }, // blue
    { bg: "rgba(16, 185, 129, 0.12)", text: "#10b981" }, // green
    { bg: "rgba(139, 92, 246, 0.12)", text: "#8b5cf6" }, // purple
    { bg: "rgba(245, 158, 11, 0.12)", text: "#f59e0b" }, // amber
    { bg: "rgba(236, 72, 153, 0.12)", text: "#ec4899" }, // pink
    { bg: "rgba(14, 165, 233, 0.12)", text: "#0ea5e9" }, // sky
    { bg: "rgba(99, 102, 241, 0.12)", text: "#6366f1" }, // indigo
  ];
  return hues[Math.abs(hash) % hues.length];
}

// Financial profit and margin calculator
export function calculateMargin(costPricePaisa: number, sellPricePaisa: number) {
  const cost = costPricePaisa / 100;
  const sell = sellPricePaisa / 100;
  const profit = sell - cost;
  const marginPercent = sell > 0 ? (profit / sell) * 100 : 0;
  return { profit, marginPercent };
}

// Expiry status badge
export function ExpiryBadge({ date }: { date: string }) {
  const days = daysUntil(date);
  const color = days < 0 ? "red" : days <= 30 ? "yellow" : "teal";
  const label =
    days < 0
      ? "Expired"
      : days <= 30
      ? `Expires in ${days} ${days === 1 ? "day" : "days"}`
      : `Expires ${formatDate(date)}`;
  return (
    <Badge color={color} variant="light" radius="sm" size="sm">
      {label}
    </Badge>
  );
}

// Helper to export products to CSV
export function exportProductsToCsv(
  products: PublicProduct[],
  categoryMap: Map<string, string>,
  supplierMap: Map<string, string>
) {
  const headers = [
    "SKU",
    "Product Name",
    "Category",
    "Supplier",
    "Cost Price",
    "Sell Price",
    "Stock Quantity",
    "Unit",
  ];
  const rows = products.map((p) => [
    `"${p.sku.replace(/"/g, '""')}"`,
    `"${p.name.replace(/"/g, '""')}"`,
    `"${(p.categoryId ? categoryMap.get(p.categoryId) ?? "" : "").replace(/"/g, '""')}"`,
    `"${(p.supplierId ? supplierMap.get(p.supplierId) ?? "" : "").replace(/"/g, '""')}"`,
    (p.costPrice / 100).toFixed(2),
    (p.sellPrice / 100).toFixed(2),
    p.quantityInStock,
    `"${(p.unit ?? "").replace(/"/g, '""')}"`,
  ]);
  const csvContent =
    "data:text/csv;charset=utf-8," +
    [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `products_export_${new Date().toISOString().slice(0, 10)}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
