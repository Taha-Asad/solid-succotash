// ==========================================
// DOMAIN: MONEY & MINOR MONETARY UNITS
// ==========================================
//
// Core domain rules for monetary representations in Corbel ERP.
// Follows strict integer minor units (paisa: 1 PKR = 100 paisa).
// Prevents floating-point precision loss, comma truncation, and
// provides safe string parsing and checked arithmetic.
//
// Pure domain rule: No SQLx, No Tauri dependencies.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Conversion constant: 100 paisa in 1 PKR.
pub const PAISA_PER_RUPEE: i64 = 100;

/// Maximum safe minor units to prevent overflow in calculations (~92 trillion rupees).
pub const MAX_SAFE_PAISA: i64 = i64::MAX / 1000;

/// Represents an exact monetary amount stored as an integer number of minor units (paisa).
/// E.g. PKR 8,400.00 is stored as 840,000 paisa.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Money {
    /// Integer minor units (paisa for PKR).
    pub amount_minor: i64,
}

impl Money {
    /// Zero money constant.
    pub const ZERO: Money = Money { amount_minor: 0 };

    /// Creates a Money instance directly from minor units (paisa).
    pub const fn from_paisa(amount_minor: i64) -> Self {
        Self { amount_minor }
    }

    /// Creates a Money instance from whole currency units (rupees).
    /// Returns error if the amount would overflow safe integer limits.
    pub fn from_rupees(rupees: i64) -> Result<Self, AppError> {
        let amount_minor = rupees
            .checked_mul(PAISA_PER_RUPEE)
            .ok_or_else(|| AppError::validation("Currency value exceeds maximum integer limit"))?;
        Ok(Self { amount_minor })
    }

    /// Returns the raw minor unit value (paisa).
    #[inline]
    pub const fn to_paisa(&self) -> i64 {
        self.amount_minor
    }

    /// Returns the integer whole currency units (rupees), truncating fractional paisa.
    #[inline]
    pub const fn to_rupees_floor(&self) -> i64 {
        self.amount_minor / PAISA_PER_RUPEE
    }

    /// Returns floating-point rupees for preview/display only.
    /// NEVER use this value for database writes or financial mutations.
    #[inline]
    pub fn to_rupees_preview_f64(&self) -> f64 {
        self.amount_minor as f64 / PAISA_PER_RUPEE as f64
    }

    /// Parses a user-entered display string into Money.
    ///
    /// Correctly handles:
    /// - Formatted strings with commas: `"8,400"` -> 840,000 paisa.
    /// - Floating display decimals: `"8,400.50"` -> 840,050 paisa; `"8400.5"` -> 840,050 paisa.
    /// - Currency symbols / prefixes: `"PKR 8,400"`, `"Rs. 8,400"`, `"₨ 8,400"`.
    /// - Negative values: `"-8,400.00"` -> -840,000 paisa.
    ///
    /// Crucially: This parser NEVER truncates at commas (unlike JavaScript `parseFloat`).
    pub fn parse_display(input: &str) -> Result<Self, AppError> {
        let mut clean = input.trim();

        // Strip known currency prefix noise
        for prefix in &["PKR", "pkr", "Rs.", "Rs", "rs.", "rs", "₨", "$"] {
            if let Some(rest) = clean.strip_prefix(prefix) {
                clean = rest.trim();
                break;
            }
        }

        if clean.is_empty() {
            return Ok(Self::ZERO);
        }

        let is_negative = clean.starts_with('-');
        if is_negative {
            clean = clean[1..].trim();
        }

        // Split on decimal separator '.'
        let parts: Vec<&str> = clean.split('.').collect();
        if parts.len() > 2 {
            return Err(AppError::validation(format!(
                "Invalid monetary amount '{input}': multiple decimal points detected"
            )));
        }

        // Parse integer part (stripping thousands separator commas)
        let int_str = parts[0].replace(',', "");
        let int_val: i64 = if int_str.is_empty() {
            0
        } else {
            int_str.parse::<i64>().map_err(|_| {
                AppError::validation(format!(
                    "Invalid monetary amount '{input}': could not parse whole number part"
                ))
            })?
        };

        // Parse fractional part (up to 2 decimal places in minor units)
        let frac_val: i64 = if parts.len() == 2 {
            let frac_str = parts[1].replace(',', "");
            if frac_str.is_empty() {
                0
            } else if frac_str.len() == 1 {
                let d = frac_str.parse::<i64>().map_err(|_| {
                    AppError::validation(format!("Invalid decimal digit in '{input}'"))
                })?;
                d * 10
            } else if frac_str.len() == 2 {
                frac_str.parse::<i64>().map_err(|_| {
                    AppError::validation(format!("Invalid decimal digits in '{input}'"))
                })?
            } else {
                // If more than 2 decimals are provided, parse first 2 and round half-up with 3rd
                let first_two = frac_str[..2].parse::<i64>().map_err(|_| {
                    AppError::validation(format!("Invalid decimal digits in '{input}'"))
                })?;
                let third_digit = frac_str[2..3].chars().next().unwrap_or('0');
                if third_digit >= '5' {
                    first_two + 1
                } else {
                    first_two
                }
            }
        } else {
            0
        };

        let raw_paisa = int_val
            .checked_mul(PAISA_PER_RUPEE)
            .and_then(|p| p.checked_add(frac_val))
            .ok_or_else(|| AppError::validation("Monetary amount exceeds maximum calculation range"))?;

        let amount_minor = if is_negative { -raw_paisa } else { raw_paisa };
        Ok(Self { amount_minor })
    }

    /// Formats the amount into a standardized display string with thousands separators
    /// and two decimal places. E.g. 840,000 paisa -> `"8,400.00"`.
    pub fn format_display(&self) -> String {
        let abs_paisa = self.amount_minor.abs();
        let rupees = abs_paisa / PAISA_PER_RUPEE;
        let paisa = abs_paisa % PAISA_PER_RUPEE;
        let sign = if self.amount_minor < 0 { "-" } else { "" };

        let rupees_str = format_with_commas(rupees);
        format!("{sign}{rupees_str}.{paisa:02}")
    }

    /// Formats with a given currency symbol prefix. E.g. `"PKR 8,400.00"`.
    pub fn format_with_symbol(&self, symbol: &str) -> String {
        format!("{symbol} {}", self.format_display())
    }

    /// Checked addition with overflow detection.
    pub fn checked_add(&self, other: Money) -> Result<Money, AppError> {
        let result = self
            .amount_minor
            .checked_add(other.amount_minor)
            .ok_or_else(|| AppError::validation("Addition would cause monetary overflow"))?;
        Ok(Money { amount_minor: result })
    }

    /// Checked subtraction with overflow detection.
    pub fn checked_sub(&self, other: Money) -> Result<Money, AppError> {
        let result = self
            .amount_minor
            .checked_sub(other.amount_minor)
            .ok_or_else(|| AppError::validation("Subtraction would cause monetary underflow"))?;
        Ok(Money { amount_minor: result })
    }

    /// Multiplies money by an integer quantity (e.g. unit price * quantity).
    pub fn checked_mul_qty(&self, qty: i64) -> Result<Money, AppError> {
        let result = self
            .amount_minor
            .checked_mul(qty)
            .ok_or_else(|| AppError::validation("Quantity multiplication would cause overflow"))?;
        Ok(Money { amount_minor: result })
    }

    /// Calculates tax amount using basis points (1% = 100 bp, 18% = 1,800 bp).
    /// Uses integer arithmetic with half-up rounding:
    /// `tax = (amount_minor * basis_points + 5,000) / 10,000`
    pub fn checked_apply_tax(&self, tax_rate_basis_points: i64) -> Result<Money, AppError> {
        if tax_rate_basis_points < 0 {
            return Err(AppError::validation("Tax rate cannot be negative"));
        }
        let numerator = self
            .amount_minor
            .checked_mul(tax_rate_basis_points)
            .ok_or_else(|| AppError::validation("Tax calculation overflow"))?;
        let rounded = (numerator + 5000) / 10000;
        Ok(Money { amount_minor: rounded })
    }

    /// Applies a discount (either a fixed minor amount or percentage in basis points).
    /// Returns `(discount_amount, final_amount)`.
    pub fn checked_apply_discount(
        &self,
        discount_type: &str,
        discount_val: i64,
    ) -> Result<(Money, Money), AppError> {
        if discount_val < 0 {
            return Err(AppError::validation("Discount value cannot be negative"));
        }

        let discount_amount_minor = match discount_type {
            "fixed" | "amount" => discount_val.min(self.amount_minor),
            "percentage" | "percent" => {
                // discount_val is in basis points (e.g. 1000 bp = 10%)
                let num = self
                    .amount_minor
                    .checked_mul(discount_val)
                    .ok_or_else(|| AppError::validation("Discount calculation overflow"))?;
                ((num + 5000) / 10000).min(self.amount_minor)
            }
            other => {
                return Err(AppError::validation(format!(
                    "Unsupported discount type: '{other}'"
                )));
            }
        };

        let final_minor = self.amount_minor - discount_amount_minor;
        Ok((
            Money { amount_minor: discount_amount_minor },
            Money { amount_minor: final_minor },
        ))
    }

    /// Rounds paisa to the nearest whole rupee (round half-up).
    /// Useful when the merchant policy requires whole-rupee cash billing.
    pub fn round_to_rupee(&self) -> Money {
        let is_neg = self.amount_minor < 0;
        let abs = self.amount_minor.abs();
        let rem = abs % PAISA_PER_RUPEE;
        let rounded = if rem >= 50 {
            abs - rem + PAISA_PER_RUPEE
        } else {
            abs - rem
        };
        Money {
            amount_minor: if is_neg { -rounded } else { rounded },
        }
    }

    /// Invariant check: Ensures amount is non-negative (>= 0).
    pub fn require_non_negative(&self, field_name: &str) -> Result<(), AppError> {
        if self.amount_minor < 0 {
            return Err(AppError::validation(format!(
                "'{field_name}' must be non-negative, got {}",
                self.format_display()
            )));
        }
        Ok(())
    }

    /// Invariant check: Ensures amount is strictly positive (> 0).
    pub fn require_positive(&self, field_name: &str) -> Result<(), AppError> {
        if self.amount_minor <= 0 {
            return Err(AppError::validation(format!(
                "'{field_name}' must be greater than zero, got {}",
                self.format_display()
            )));
        }
        Ok(())
    }
}

impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.format_display())
    }
}

/// Helper function to format an integer with standard 3-digit comma grouping.
fn format_with_commas(val: i64) -> String {
    let s = val.to_string();
    let mut result = String::with_capacity(s.len() + (s.len() / 3));
    let len = s.len();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            result.push(',');
        }
        result.push(c);
    }
    result
}

// ==========================================
// INVARIANT UNIT TESTS
// ==========================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_paisa_round_trip() {
        // Invariant: PKR 8,400.00 must equal exactly 840,000 paisa
        let m = Money::from_rupees(8400).expect("should convert");
        assert_eq!(m.to_paisa(), 840_000);
        assert_eq!(m.to_rupees_floor(), 8400);
        assert_eq!(m.format_display(), "8,400.00");
        assert_eq!(m.format_with_symbol("PKR"), "PKR 8,400.00");
    }

    #[test]
    fn test_parse_display_handles_commas_without_truncation() {
        // Crucial bug prevention: "8,400" must NEVER evaluate to 8!
        let m1 = Money::parse_display("8,400").expect("should parse");
        assert_eq!(m1.to_paisa(), 840_000);

        let m2 = Money::parse_display("8,400.00").expect("should parse");
        assert_eq!(m2.to_paisa(), 840_000);

        let m3 = Money::parse_display("PKR 8,400.50").expect("should parse");
        assert_eq!(m3.to_paisa(), 840_050);

        let m4 = Money::parse_display("Rs. 1,234,567.89").expect("should parse");
        assert_eq!(m4.to_paisa(), 123_456_789);
    }

    #[test]
    fn test_parse_display_fractional_precision() {
        assert_eq!(Money::parse_display("0.05").unwrap().to_paisa(), 5);
        assert_eq!(Money::parse_display("0.5").unwrap().to_paisa(), 50);
        assert_eq!(Money::parse_display("0.50").unwrap().to_paisa(), 50);
        assert_eq!(Money::parse_display(".75").unwrap().to_paisa(), 75);
    }

    #[test]
    fn test_parse_display_rejects_invalid_inputs() {
        assert!(Money::parse_display("8.400.00").is_err());
        assert!(Money::parse_display("invalid").is_err());
        assert!(Money::parse_display("8,400abc").is_err());
    }

    #[test]
    fn test_checked_arithmetic() {
        let m1 = Money::from_paisa(5000); // 50.00
        let m2 = Money::from_paisa(3400); // 34.00

        let sum = m1.checked_add(m2).unwrap();
        assert_eq!(sum.to_paisa(), 8400);

        let diff = m1.checked_sub(m2).unwrap();
        assert_eq!(diff.to_paisa(), 1600);

        let mul = m1.checked_mul_qty(3).unwrap();
        assert_eq!(mul.to_paisa(), 15000);
    }

    #[test]
    fn test_tax_and_discount_calculation() {
        // PKR 1,000.00 @ 18% GST (1,800 basis points)
        let item_price = Money::from_rupees(1000).unwrap(); // 100,000 paisa
        let tax = item_price.checked_apply_tax(1800).unwrap();
        assert_eq!(tax.to_paisa(), 18_000); // 180.00 PKR
        assert_eq!(tax.format_display(), "180.00");

        // 10% discount (1,000 basis points)
        let (disc, total) = item_price
            .checked_apply_discount("percentage", 1000)
            .unwrap();
        assert_eq!(disc.to_paisa(), 10_000); // 100.00 PKR
        assert_eq!(total.to_paisa(), 90_000); // 900.00 PKR
    }

    #[test]
    fn test_round_to_rupee() {
        let m1 = Money::from_paisa(840049); // 8400.49
        assert_eq!(m1.round_to_rupee().to_paisa(), 840000);

        let m2 = Money::from_paisa(840050); // 8400.50
        assert_eq!(m2.round_to_rupee().to_paisa(), 840100);
    }

    #[test]
    fn test_invariants() {
        let zero = Money::ZERO;
        assert!(zero.require_non_negative("amount").is_ok());
        assert!(zero.require_positive("amount").is_err());

        let negative = Money::from_paisa(-500);
        assert!(negative.require_non_negative("amount").is_err());
    }
}
