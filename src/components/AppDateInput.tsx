// ==========================================
// APP DATE INPUT — shared calendar picker
// ==========================================
//
// Single, consistent date picker for the whole app. This is the exact
// calendar used for expiry dates in Inventory, so every other date field
// (invoice dates, PO dates, payments, journal entries) looks and behaves
// the same — matching branding, first-day-of-week Monday, weekdays as
// weekends, and the styled navy/gold popover.
//
// The component works with plain "YYYY-MM-DD" strings, which is how the
// rest of the app stores dates. The calendar itself needs real Date
// objects, so values are parsed/format with LOCAL date parts — never
// toISOString, to avoid off-by-one-day shifts near midnight.

import { DateInput } from "@mantine/dates";

import type { ReactNode } from "react";

import { INK } from "../theme";

export function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

export function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface AppDateInputProps {
  value?: string;
  onChange?: (value: string) => void;
  label?: ReactNode;
  description?: ReactNode;
  placeholder?: string;
  clearable?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  required?: boolean;
  disabled?: boolean;
  maw?: number | string;
  w?: number | string;
  flex?: number | string;
  style?: React.CSSProperties;
  className?: string;
}

export function AppDateInput({
  value,
  onChange,
  ...props
}: AppDateInputProps) {
  return (
    <DateInput
      placeholder="Select a date"
      valueFormat="DD MMM YYYY"
      clearable
      defaultDate={new Date()}
      firstDayOfWeek={1}
      weekendDays={[0]}
      highlightToday
      hideOutsideDates
      value={value ? parseDateOnly(value) : null}
      onChange={(v) => {
        if (!v) {
          onChange?.("");
          return;
        }
        // Different Mantine versions return either a Date or an already
        // formatted string here — handle both, converting via LOCAL parts.
        const asDate = typeof v === "string" ? parseDateOnly(v) : v;
        onChange?.(formatDateOnly(asDate));
      }}
      popoverProps={{
        withArrow: false,
        radius: "md",
        zIndex: 3000,
        styles: {
          dropdown: {
            border: `1px solid ${INK.border}`,
            padding: 10,
            boxShadow: "0 14px 34px -14px rgba(29,43,84,0.35)",
          },
        },
      }}
      {...props}
    />
  );
}
