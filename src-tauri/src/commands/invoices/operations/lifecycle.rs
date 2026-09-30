use sqlx::SqlitePool;
use tauri::State;

use crate::commands::audit::log_audit;
use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use crate::error::AppError;

use super::super::math::clean_optional;
use super::super::types::PublicInvoice;

/// Generates the next invoice number ATOMICALLY inside a transaction.
pub(crate) async fn generate_invoice_number(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    company_id: &str,
) -> Result<String, AppError> {
    // Ensure settings row exists
    let exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| AppError::internal(format!("Settings check error: {e}")))?;

    if !exists {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO company_invoice_settings (id, company_id) VALUES (?, ?)")
            .bind(&id)
            .bind(company_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| AppError::internal(format!("Settings create error: {e}")))?;
    }

    // READ and INCREMENT in the SAME transaction (atomic)
    let (prefix, number): (String, i64) = sqlx::query_as(
        "SELECT invoice_prefix, next_number FROM company_invoice_settings WHERE company_id = ?",
    )
    .bind(company_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| AppError::internal(format!("Settings read error: {e}")))?;

    // Increment immediately (within the same transaction)
    sqlx::query(
        "UPDATE company_invoice_settings SET next_number = next_number + 1, updated_at = CURRENT_TIMESTAMP WHERE company_id = ?"
    )
    .bind(company_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| AppError::internal(format!("Counter update error: {e}")))?;

    Ok(format!("{}-{:04}", prefix, number))
}

/// Creates a new draft invoice
#[tauri::command]
pub async fn create_invoice(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    customer_id: String,
    invoice_date: String,
    due_date: String,
    po_number: String,
    reference_note: String,
    currency_code: Option<String>,
    exchange_rate: Option<f64>,
) -> Result<PublicInvoice, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "create").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Validate customer exists
    sqlx::query_scalar::<_, String>("SELECT name FROM customers WHERE id = ? AND company_id = ?")
        .bind(&customer_id)
        .bind(company_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|_| "Customer not found".to_string())?;

    // Use a transaction for atomic invoice number generation
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Transaction error: {e}")))?;

    let invoice_number = generate_invoice_number(&mut tx, company_id).await?;

    let id = uuid::Uuid::new_v4().to_string();
    let due = clean_optional(&due_date);
    let cur_code = currency_code.unwrap_or_default();
    let ex_rate = exchange_rate.unwrap_or(1.0);

    sqlx::query(
        r#"
        INSERT INTO invoices
            (id, company_id, invoice_number, invoice_date, due_date,
             customer_id, status, po_number, reference_note, created_by,
             currency_code, exchange_rate)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(company_id)
    .bind(&invoice_number)
    .bind(&invoice_date)
    .bind(&due)
    .bind(&customer_id)
    .bind(clean_optional(&po_number))
    .bind(clean_optional(&reference_note))
    .bind(&current_user.id)
    .bind(&cur_code)
    .bind(ex_rate)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| AppError::internal(format!("Commit error: {e}")))?;

    let invoice = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    Ok(invoice)
}

/// Finalizes a draft invoice (locks it and deducts stock)
#[tauri::command]
pub async fn finalize_invoice(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
) -> Result<PublicInvoice, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    check_permission(pool.inner(), &current_user.role, "invoices", "finalize").await?;

    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    // Use a transaction
    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Transaction error: {e}")))?;

    // Verify invoice is draft
    let invoice = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT id, status, grand_total FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?
    .ok_or("Invoice not found")?;

    if invoice.1 != "draft" {
        return Err(AppError::internal("Invoice is not in draft status".to_string()));
    }

    if invoice.2 == 0 {
        return Err(AppError::internal("Cannot finalize an invoice with zero total. Add items first.".to_string()));
    }

    // Get all items and deduct stock
    let items = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT product_id, product_name, quantity FROM invoice_items WHERE invoice_id = ?",
    )
    .bind(&invoice_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Items lookup error: {e}")))?;

    for (product_id, product_name, quantity) in &items {
        // Check stock
        let current_stock = sqlx::query_scalar::<_, i64>(
            "SELECT quantity_in_stock FROM products WHERE id = ? AND company_id = ?",
        )
        .bind(product_id)
        .bind(company_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Stock check error: {e}")))?;

        if current_stock < *quantity {
            return Err(AppError::internal(format!(
                "Insufficient stock for '{}': have {}, need {}",
                product_name, current_stock, quantity
            )));
        }

        // Deduct stock
        sqlx::query(
            "UPDATE products SET quantity_in_stock = quantity_in_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?"
        )
        .bind(quantity)
        .bind(product_id)
        .bind(company_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Stock update error: {e}")))?;

        // Record stock movement
        let movement_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO stock_movements
                (id, company_id, product_id, movement_type, quantity, reference_note, performed_by)
            VALUES (?, ?, ?, 'sale', ?, ?, ?)
            "#,
        )
        .bind(&movement_id)
        .bind(company_id)
        .bind(product_id)
        .bind(-quantity) // negative for stock OUT
        .bind(format!("Invoice {}", invoice_id))
        .bind(&current_user.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Movement record error: {e}")))?;

        // Deduct FIFO from expiry batches (soonest-expiring first).
        // No-op for products that have no batches.
        crate::commands::inventory::deduct_fifo(&mut tx, company_id, product_id, *quantity).await?;
    }

    // Mark invoice as finalized
    sqlx::query(
        r#"
        UPDATE invoices
        SET status = 'finalized', finalized_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
            balance_due = grand_total
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&invoice_id)
    .bind(company_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Finalize error: {e}")))?;

    // Double-entry: Dr Accounts Receivable / Cr Sales Revenue.
    let (invoice_number, invoice_date) = sqlx::query_as::<_, (String, String)>(
        "SELECT invoice_number, invoice_date FROM invoices WHERE id = ?",
    )
    .bind(&invoice_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Invoice lookup error: {e}")))?;

    crate::commands::ledger::post_invoice_sale(
        &mut tx,
        company_id,
        &invoice_id,
        &invoice_date,
        &invoice_number,
        invoice.2,
        &current_user.id,
    )
    .await?;

    // FBR outbox: enqueue for PRAL submission (spec section 17.4).
    // Inserted inside the same transaction so the queue row is committed atomically.
    if let Err(e) = crate::commands::fbr::enqueue_fbr_submission(&mut tx, pool.inner(), company_id, &invoice_id).await {
        // Non-fatal: FBR submission failure should not block invoice finalization.
        // The error is logged but the invoice is still finalized.
        eprintln!("FBR enqueue warning: {e}");
    }

    tx.commit()
        .await
        .map_err(|e| AppError::internal(format!("Commit error: {e}")))?;

    let updated = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&invoice_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "finalize",
        "invoice",
        Some(&invoice_id),
        &format!("Finalized invoice (total {})", invoice.2),
    )
    .await;

    crate::commands::notifications::emit_notifications_changed();

    Ok(updated)
}

/// Records a payment against an invoice (delegates to application service)
#[tauri::command]
pub async fn record_payment(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
    amount: i64,
    payment_method: String,
    payment_date: String,
    reference: String,
    notes: String,
    payment_currency_code: Option<String>,
    payment_exchange_rate: Option<f64>,
    idempotency_key: Option<String>,
) -> Result<PublicInvoice, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let resolved_key = idempotency_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .or_else(|| {
            let trimmed_ref = reference.trim();
            if !trimmed_ref.is_empty() {
                Some(trimmed_ref.to_string())
            } else {
                None
            }
        });

    let req = crate::application::payments::RecordPaymentRequest {
        invoice_id: invoice_id.clone(),
        amount,
        payment_method: payment_method.clone(),
        payment_date,
        reference: reference.clone(),
        notes,
        payment_currency_code,
        payment_exchange_rate,
        idempotency_key: resolved_key,
    };

    let updated = crate::application::payments::record_invoice_payment(
        pool.inner(),
        &current_user,
        req,
    )
    .await?;

    let company_id = current_user.company_id.as_deref().unwrap_or("system");
    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "payment",
        "invoice",
        Some(&invoice_id),
        &format!("Recorded payment of {amount} via {payment_method}"),
    )
    .await;

    Ok(updated)
}

/// Deletes a draft invoice. Only invoices in 'draft' status can be deleted.
#[tauri::command]
pub async fn delete_invoice(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
) -> Result<bool, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    if current_user.role != "owner" {
        let can_del = check_permission(pool.inner(), &current_user.role, "invoices", "delete").await;
        if can_del.is_err() {
            check_permission(pool.inner(), &current_user.role, "invoices", "edit").await?;
        }
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Transaction error: {e}")))?;

    let invoice = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id, invoice_number, status FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?
    .ok_or("Invoice not found")?;

    if invoice.2 != "draft" {
        return Err(AppError::internal(
            "Only draft invoices can be deleted. Finalized or paid invoices must be cancelled/voided to preserve audit and inventory integrity."
                .to_string(),
        ));
    }

    // Delete invoice items
    sqlx::query("DELETE FROM invoice_items WHERE invoice_id = ?")
        .bind(&invoice_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Items deletion error: {e}")))?;

    // Soft-delete or delete invoice
    sqlx::query("UPDATE invoices SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?")
        .bind(&invoice_id)
        .bind(company_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Invoice deletion error: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| AppError::internal(format!("Commit error: {e}")))?;

    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "delete",
        "invoice",
        Some(&invoice_id),
        &format!("Deleted draft invoice {}", invoice.1),
    )
    .await;

    crate::commands::notifications::emit_notifications_changed();

    Ok(true)
}

/// Cancels / voids a finalized or paid invoice:
/// 1. Verifies invoice is not already cancelled.
/// 2. Restores inventory for all items (products.quantity_in_stock += quantity).
/// 3. Restores stock batch quantity if batches exist.
/// 4. Inserts compensating stock_movements ('return', positive quantity).
/// 5. Posts reversing journal entry for the sale (Dr Sales Revenue / Cr Accounts Receivable).
/// 6. Posts reversing journal entry for any paid amount (Dr Accounts Receivable / Cr Cash).
/// 7. Updates invoice status to 'cancelled'.
/// 8. Logs audit event.
#[tauri::command]
pub async fn cancel_invoice(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    invoice_id: String,
    reason: Option<String>,
) -> Result<PublicInvoice, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    if current_user.role != "owner" {
        let can_del = check_permission(pool.inner(), &current_user.role, "invoices", "delete").await;
        if can_del.is_err() {
            check_permission(pool.inner(), &current_user.role, "invoices", "edit").await?;
        }
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| AppError::internal(format!("Transaction error: {e}")))?;

    let invoice = sqlx::query_as::<_, (String, String, String, String, i64, i64, Option<String>)>(
        "SELECT id, invoice_number, invoice_date, status, grand_total, amount_paid, reference_note FROM invoices WHERE id = ? AND company_id = ?",
    )
    .bind(&invoice_id)
    .bind(company_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Database error: {e}")))?
    .ok_or("Invoice not found")?;

    let (inv_id, inv_num, inv_date, status, grand_total, amount_paid, existing_note) = invoice;

    if status == "cancelled" {
        return Err(AppError::internal("Invoice is already cancelled".to_string()));
    }

    let cancel_reason = reason
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Cancelled / Voided by operator");

    // Only finalized or paid invoices had stock deducted and ledger posted
    if status == "finalized" || status == "paid" {
        // 1. Fetch items to restore stock
        let items = sqlx::query_as::<_, (String, String, i64)>(
            "SELECT product_id, product_name, quantity FROM invoice_items WHERE invoice_id = ?",
        )
        .bind(&inv_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| AppError::internal(format!("Items lookup error: {e}")))?;

        for (product_id, product_name, quantity) in items {
            // Restore quantity in stock
            sqlx::query(
                "UPDATE products SET quantity_in_stock = quantity_in_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company_id = ?"
            )
            .bind(quantity)
            .bind(&product_id)
            .bind(company_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Stock restore error for {product_name}: {e}")))?;

            // Restore batch quantity if batch exists
            let batch_id: Option<String> = sqlx::query_scalar(
                "SELECT id FROM stock_batches WHERE company_id = ? AND product_id = ? ORDER BY created_at DESC LIMIT 1"
            )
            .bind(company_id)
            .bind(&product_id)
            .fetch_optional(&mut *tx)
            .await
            .unwrap_or(None);

            if let Some(b_id) = batch_id {
                let _ = sqlx::query("UPDATE stock_batches SET quantity = quantity + ? WHERE id = ?")
                    .bind(quantity)
                    .bind(&b_id)
                    .execute(&mut *tx)
                    .await;
            }

            // Record stock movement (positive quantity = return into stock)
            let movement_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO stock_movements
                    (id, company_id, product_id, movement_type, quantity, reference_note, performed_by)
                VALUES (?, ?, ?, 'return', ?, ?, ?)
                "#,
            )
            .bind(&movement_id)
            .bind(company_id)
            .bind(&product_id)
            .bind(quantity)
            .bind(format!("Voided Invoice {inv_num}: {cancel_reason}"))
            .bind(&current_user.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::internal(format!("Movement record error: {e}")))?;
        }

        // 2. Reverse accounting sale entry (Dr Sales Revenue / Cr Accounts Receivable)
        if grand_total > 0 {
            crate::commands::ledger::post_journal_entry(
                &mut tx,
                company_id,
                &inv_date,
                "invoice",
                Some(&inv_id),
                &format!("Reversal for voided invoice {inv_num}: {cancel_reason}"),
                vec![
                    crate::commands::ledger::JournalLineInput {
                        account_code: crate::commands::ledger::ACCOUNT_SALES.to_string(),
                        debit: grand_total,
                        credit: 0,
                        description: Some(format!("Reversal sale {inv_num}")),
                    },
                    crate::commands::ledger::JournalLineInput {
                        account_code: crate::commands::ledger::ACCOUNT_AR.to_string(),
                        debit: 0,
                        credit: grand_total,
                        description: Some(format!("Reversal sale {inv_num}")),
                    },
                ],
                Some(&current_user.id),
            )
            .await?;
        }

        // 3. Reverse payment entries if any payment was collected (Dr Accounts Receivable / Cr Cash)
        if amount_paid > 0 {
            crate::commands::ledger::post_journal_entry(
                &mut tx,
                company_id,
                &inv_date,
                "payment",
                Some(&inv_id),
                &format!("Reversal of collected payments for voided invoice {inv_num}"),
                vec![
                    crate::commands::ledger::JournalLineInput {
                        account_code: crate::commands::ledger::ACCOUNT_AR.to_string(),
                        debit: amount_paid,
                        credit: 0,
                        description: Some(format!("Reversal payment {inv_num}")),
                    },
                    crate::commands::ledger::JournalLineInput {
                        account_code: crate::commands::ledger::ACCOUNT_CASH.to_string(),
                        debit: 0,
                        credit: amount_paid,
                        description: Some(format!("Reversal payment {inv_num}")),
                    },
                ],
                Some(&current_user.id),
            )
            .await?;
        }
    }

    // Update invoice record to cancelled
    let note_suffix = format!("[VOIDED: {cancel_reason}]");
    let updated_note = match existing_note {
        Some(n) if !n.trim().is_empty() => format!("{n} | {note_suffix}"),
        _ => note_suffix,
    };

    sqlx::query(
        r#"
        UPDATE invoices
        SET status = 'cancelled', balance_due = 0, reference_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND company_id = ?
        "#,
    )
    .bind(&updated_note)
    .bind(&inv_id)
    .bind(company_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::internal(format!("Invoice cancellation error: {e}")))?;

    tx.commit()
        .await
        .map_err(|e| AppError::internal(format!("Commit error: {e}")))?;

    let updated = sqlx::query_as::<_, PublicInvoice>("SELECT * FROM invoices WHERE id = ?")
        .bind(&inv_id)
        .fetch_one(pool.inner())
        .await
        .map_err(|e| AppError::internal(format!("Database error: {e}")))?;

    log_audit(
        pool.inner(),
        company_id,
        &current_user.id,
        &current_user.email,
        &current_user.role,
        "cancel",
        "invoice",
        Some(&inv_id),
        &format!("Cancelled invoice {} - Reason: {}", inv_num, cancel_reason),
    )
    .await;

    crate::commands::notifications::emit_notifications_changed();

    Ok(updated)
}
