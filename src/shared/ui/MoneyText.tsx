// ==========================================
// SHARED UI: MONEY TEXT PRIMITIVE
// ==========================================
//
// Domain-neutral visual primitive for displaying currency values.
// Accepts amounts in integer minor units (paisa).
// Applies tabular-nums font styling to ensure numbers align in columns.

import { Text, type TextProps } from "@mantine/core";
import { formatPaisaWithSymbol, formatPaisa } from "../../utils/currency";
import type { CurrencyConfig } from "../../types/backend";

export interface MoneyTextProps extends Omit<TextProps, "children"> {
  /** The monetary amount in integer minor units (paisa). E.g. 840000 = PKR 8,400.00 */
  paisa: number | null | undefined;
  /** Optional company currency configuration. Falls back to default PKR. */
  currencyConfig?: CurrencyConfig | null;
  /** Whether to hide the currency symbol prefix (default: false). */
  hideSymbol?: boolean;
  /** Automatically color positive values green and negative values red. */
  colorCode?: boolean;
}

export function MoneyText({
  paisa,
  currencyConfig,
  hideSymbol = false,
  colorCode = false,
  className,
  style,
  c,
  ...props
}: MoneyTextProps) {
  const safePaisa = paisa ?? 0;
  const formatted = hideSymbol
    ? formatPaisa(safePaisa, currencyConfig)
    : formatPaisaWithSymbol(safePaisa, currencyConfig);

  let textColor = c;
  if (colorCode) {
    if (safePaisa > 0) textColor = "teal.7";
    else if (safePaisa < 0) textColor = "red.7";
    else textColor = "dimmed";
  }

  return (
    <Text
      component="span"
      c={textColor}
      style={{
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.01em",
        ...style,
      }}
      className={className}
      {...props}
    >
      {formatted}
    </Text>
  );
}

export default MoneyText;
