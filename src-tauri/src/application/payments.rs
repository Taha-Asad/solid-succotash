// ==========================================
// APPLICATION SERVICE: PAYMENTS
// ==========================================
//
// Owns the transaction boundary, domain rules, double-entry ledger allocation,
// and idempotency verification for payment collection.
//
// Separates core business logic from Tauri transport encoding.

use sqlx::SqlitePool;
use crate::commands::auth::PublicUser;
use crate::commands::invoices::math::clean_optional;
use crate::commands::invoices::types::PublicInvoice;
use crate::commands::permissions::check_permission;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

/// Input DTO for recording an invoice payment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPaymentRequest {
    pub invoice_id: String,
    /// Amount in integer minor units (paisa). Must be positive.
    pub amount: i64,
    pub payment_method: String,
    pub payment_date: String,
    pub reference: String,
    pub notes: String,
    pub payment_currency_code: Option<String>,
    pub payment_exchange_rate: Option<f64>,
    /// Optional client-generated idempotency key (prevents double-click / duplicate processing)
    pub idempotency_key: Option<String>,
}

/// Orchestrates the recording of an invoice payment within an atomic transaction.
pub async fn record_invoice_payment(
    pool: &SqlitePool,
    user: &PublicUser,
    req: RecordPaymentRequest,
) -> Result<PublicInvoice, AppError> {
    // 1. Permission check
    check_permission(pool, &user.role, "invoices", "edit").await?;

    let company_id = user
        .company_id
        .as_ref()
        .ok_or_else(|| AppError::forbidden("You are not assigned to a company"))?;

    // 2. Domain validation
    if req.amount <= 0 {
        return Err(AppError::validation("Payment amount must be positive"));
    }

    let valid_methods = ["cash", "bank_transfer", "card", "cheque", "online", "other"];
    if !valid_methods.contains(&req.payment_method.as_str()) {
        return Err(AppError::validation("Invalid payment method"));
    }

    // 3. Begin transaction
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| AppError::database(format!("Failed to start transaction: {e}")))?;

    // 4. Idempotency Check (Duplicate submission prevention)
    let check_key = req.idempotency_key.as_deref().or(if !req.reference.trim().is_empty() {
        Some(req.reference.trim())
    } else {
        None
    });

    if let Some(key) = check_key {
        let existing = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM payment_records WHERE invoice_id = ? AND company_id = ? AND reference = ?",
        )
        .bind(&req.invoice_id)
        .bind(company_id)
        .bind(key)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| AppError::database(format!("Idempotency check error: {e}")))?;

        if existing > 0 {
            // Already processed! Return current invoice state safely without double-charging
            let current = sqlx::query_as::<_, PublicInvoice>(
                "SELECT * FROM invoices WHERE id = ? AND company_id = ?",
            )
            .bind(&req.invoice_id)
            .bind(company_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| AppError::database(format!("Invoice lookup error: {e}")))?;

            tx.rollback().await.ok();
            return Ok(current);
        }
    }

    // 5. Fetch invoice within transaction
    let invoice = sqlx::query_as::<_, (String, i64, i64, String, f64)>(
        "SELECT status, grand_total, amount_paid, COALESCE(currency_code, ''), COALESCE(exchange_rate, 1.0) FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&req.invoice_id)
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::database(format!("Invoice query error: {e}")))?
    .ok_or_else(|| AppError::not_found("Invoice not found"))?;

    let (status, grand_total_paisa, current_amount_paid_paisa, curr_code, exchange_rate) = invoice;

    if status == "draft" || status == "cancelled" {
        return Err(AppError::validation("Cannot record payment for draft or cancelled invoices"));
    }

    // 6. Currency conversion to base currency
    let pay_currency = req.payment_currency_code.clone().unwrap_or(curr_code);
    let pay_rate = req.payment_exchange_rate.unwrap_or(exchange_rate);
    let base_currency_amount = crate::commands::currency::convert_amount(req.amount, pay_rate, 2);

    let new_amount_paid = current_amount_paid_paisa + base_currency_amount;
    let new_balance = grand_total_paisa - new_amount_paid;

    if new_balance < 0 {
        return Err(AppError::validation(format!(
            "Payment ({}) exceeds balance due ({}). Overpayment not allowed.",
            base_currency_amount,
            grand_total_paisa - current_amount_paid_paisa
        )));
    }

    let new_status = if new_balance == 0 { "paid" } else { "finalized" };

    // 7. Insert payment record
    let payment_id = uuid::Uuid::new_v4().to_string();
    let stored_reference = req.idempotency_key.clone().or_else(|| clean_optional(&req.reference));

    sqlx::query(
        r#"
        INSERT INTO payment_records
            (id, invoice_id, company_id, amount, payment_method,
             payment_date, reference, notes, received_by,
             currency_code, exchange_rate, base_currency_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&payment_id)
    .bind(&req.invoice_id)
    .bind(company_id)
    .bind(base_currency_amount)
    .bind(&req.payment_method)
    .bind(&req.payment_date)
    .bind(stored_reference)
    .bind(clean_optional(&req.notes))
    .bind(&user.id)
    .bind(&pay_currency)
    .bind(pay_rate)
    .bind(base_currency_amount)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::database(format!("Failed to insert payment record: {e}")))?;

    // 8. Update invoice amounts and status
    sqlx::query(
        r#"
        UPDATE invoices
        SET amount_paid = ?, balance_due = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(new_amount_paid)
    .bind(new_balance)
    .bind(new_status)
    .bind(&req.invoice_id)
    .bind(company_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::database(format!("Failed to update invoice: {e}")))?;

    // 9. Double-entry ledger: Dr Cash / Cr Accounts Receivable
    let invoice_number =
        sqlx::query_scalar::<_, String>("SELECT invoice_number FROM invoices WHERE id = ?")
            .bind(&req.invoice_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| AppError::database(format!("Failed to get invoice number: {e}")))?;

    crate::commands::ledger::post_payment_collection(
        &mut tx,
        company_id,
        &payment_id,
        &req.payment_date,
        &invoice_number,
        base_currency_amount,
        &user.id,
    )
    .await?;

    // 10. Handle FX adjustment if multi-currency rate differs
    let expected_base = crate::commands::currency::convert_amount(req.amount, exchange_rate, 2);
    let fx_gain_loss = expected_base - base_currency_amount;

    if fx_gain_loss.abs() > 1 {
        let (debit_code, credit_code, description) = if fx_gain_loss > 0 {
            ("7100", "1000", format!("FX loss on payment for invoice {invoice_number}"))
        } else {
            ("1000", "7000", format!("FX gain on payment for invoice {invoice_number}"))
        };
        let abs_diff = fx_gain_loss.abs() as i64;

        crate::commands::ledger::post_journal_entry(
            &mut tx,
            company_id,
            &req.payment_date,
            "fx_adjustment",
            Some(&payment_id),
            &description,
            vec![
                crate::commands::ledger::JournalLineInput {
                    account_code: debit_code.to_string(),
                    debit: abs_diff,
                    credit: 0,
                    description: Some(format!("Payment {payment_id}")),
                },
                crate::commands::ledger::JournalLineInput {
                    account_code: credit_code.to_string(),
                    debit: 0,
                    credit: abs_diff,
                    description: Some(format!("Payment {payment_id}")),
                },
            ],
            Some(&user.id),
        )
        .await?;
    }

    // 11. Commit transaction
    tx.commit()
        .await
        .map_err(|e| AppError::database(format!("Transaction commit failed: {e}")))?;

    // 12. Query updated public invoice
    let updated = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&req.invoice_id)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::database(format!("Failed to fetch updated invoice: {e}")))?;

    crate::commands::notifications::emit_notifications_changed();

    Ok(updated)
}
