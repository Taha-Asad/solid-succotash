pub fn clean_optional(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Rounds a paisa amount to the nearest whole rupee (100 paisa).
pub fn round_to_rupee(paisa: i64) -> i64 {
    let rem = paisa.rem_euclid(100);
    if rem >= 50 {
        paisa - rem + 100
    } else {
        paisa - rem
    }
}

/// Computes a line item's tax/discount/total from its inputs.
/// Returns (discount_rate_stored, tax_amount, discount_amount, line_total).
///
/// discount_type:
///   "percent" -> discount_value is the percentage * 100 (500 = 5%)
///   "amount"  -> discount_value is a fixed cash amount in paisa
pub fn compute_line_amounts(
    quantity: i64,
    unit_price: i64,
    tax_rate: i64,
    discount_type: &str,
    discount_value: i64,
) -> (i64, i64, i64, i64) {
    let line_subtotal = quantity * unit_price;
    let (discount_rate, discount_amount) = if discount_type == "amount" {
        (0, discount_value.clamp(0, line_subtotal))
    } else {
        let rate = discount_value.max(0);
        (rate, (line_subtotal * rate) / 10000)
    };
    let after_discount = line_subtotal - discount_amount;
    let tax_amount = (after_discount * tax_rate) / 10000;
    let line_total = round_to_rupee(after_discount + tax_amount);
    (discount_rate, tax_amount, discount_amount, line_total)
}

/// Formats a Unix timestamp into a readable date string
#[allow(dead_code)]
pub fn format_timestamp(secs: u64) -> String {
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;

    // Days since epoch to Y-M-D (simplified)
    let mut y = 1970;
    let mut remaining_days = days;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }
    let leap = is_leap(y);
    let month_days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut m = 0;
    for (i, &d) in month_days.iter().enumerate() {
        if remaining_days < d {
            m = i + 1;
            break;
        }
        remaining_days -= d;
    }
    let d = remaining_days + 1;
    format!("{:04}-{:02}-{:02} {:02}:{:02} UTC", y, m, d, hours, minutes)
}

#[allow(dead_code)]
pub fn is_leap(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}
