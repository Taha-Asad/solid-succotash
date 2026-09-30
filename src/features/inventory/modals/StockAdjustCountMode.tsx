import {
  Badge,
  Box,
  Divider,
  Group,
  NumberInput,
  Stack,
  Text,
} from "@mantine/core";
import { INK } from "../../../theme";
import { LEDGER_NUM } from "../utils/inventoryHelpers";

interface StockAdjustCountModeProps {
  countedUnits: number | string;
  onCountedUnitsChange: (val: number | string) => void;
  unit: string;
  currentStock: number;
  numCountedUnits: number;
  countDiff: number;
}

export function StockAdjustCountMode({
  countedUnits,
  onCountedUnitsChange,
  unit,
  currentStock,
  numCountedUnits,
  countDiff,
}: StockAdjustCountModeProps) {
  return (
    <Stack gap="sm">
      <Box>
        <Text size="xs" fw={600} style={{ color: INK.text }} mb={4}>
          Actual Physical Count on Shelf
        </Text>
        <Text size="xs" c="dimmed" mb={8}>
          Count the physical items in your shop or storage right now. The system
          will automatically calculate the adjustment.
        </Text>
        <NumberInput
          value={countedUnits}
          onChange={onCountedUnitsChange}
          min={0}
          step={1}
          size="sm"
          placeholder="Enter counted units"
          allowNegative={false}
          rightSection={
            <Text size="xs" c="dimmed" pr="xs" fw={600}>
              {unit}
            </Text>
          }
        />
      </Box>

      {/* Live Comparison Box */}
      <Box
        p="sm"
        style={{
          background:
            countDiff === 0
              ? "var(--app-surface)"
              : countDiff > 0
              ? "rgba(5, 150, 105, 0.08)"
              : "rgba(217, 119, 6, 0.08)",
          border: `1px solid ${
            countDiff === 0
              ? INK.border
              : countDiff > 0
              ? "rgba(5, 150, 105, 0.3)"
              : "rgba(217, 119, 6, 0.3)"
          }`,
          borderRadius: 10,
        }}
      >
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              System Recorded Stock:
            </Text>
            <Text size="xs" fw={700} style={LEDGER_NUM}>
              {currentStock.toLocaleString()} {unit}
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Your Physical Count:
            </Text>
            <Text size="xs" fw={700} style={LEDGER_NUM}>
              {numCountedUnits.toLocaleString()} {unit}
            </Text>
          </Group>
          <Divider />
          <Group justify="space-between" align="center">
            <Text size="xs" fw={700} style={{ color: INK.text }}>
              Adjustment Required:
            </Text>
            {countDiff === 0 ? (
              <Badge color="gray" variant="light">
                0 (Exact Match)
              </Badge>
            ) : countDiff > 0 ? (
              <Badge color="teal" variant="filled">
                +{countDiff} {unit} (Surplus)
              </Badge>
            ) : (
              <Badge color="amber" variant="filled">
                {countDiff} {unit} (Shortage)
              </Badge>
            )}
          </Group>
        </Stack>
      </Box>

      {countDiff === 0 ? (
        <Text size="xs" c="dimmed" ta="center">
          ✨ System records and physical shelf count are already identical. No
          adjustment required.
        </Text>
      ) : countDiff > 0 ? (
        <Text size="xs" c="teal" fw={500}>
          📈 +{countDiff} units will be added to system inventory to match your
          shelf count.
        </Text>
      ) : (
        <Text size="xs" c="orange" fw={500}>
          📉 {Math.abs(countDiff)} units will be deducted from system inventory
          to match your shelf count.
        </Text>
      )}
    </Stack>
  );
}
