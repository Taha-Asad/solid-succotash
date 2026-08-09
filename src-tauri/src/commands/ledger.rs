// ==========================================
// ACCOUNTING LEDGER
// ==========================================
//
// Double-entry bookkeeping (spec §19.2).
//
// Lifecycle:
//   - Chart of accounts is seeded per company (ensure_chart_of_accounts)
//   - Business events post balanced journal entries (post_journal_entry)
//   - finalize_invoice -> Dr Accounts Receivable / Cr Sales Revenue
//   - record_payment   -> Dr Cash / Cr Accounts Receivable
//   - Manual adjustments and opening balances reuse post_journal_entry
//
// All amounts are in paisa. Balance is validated in application code:
// every journal entry must have SUM(debit) == SUM(credit) and at least
// one non-zero line on each side.

use crate::commands::auth::{require_current_user, SessionState};
use crate::commands::permissions::check_permission;
use serde::Serialize;
use sqlx::{Sqlite, SqlitePool};
use tauri::State;
use uuid::Uuid;

// Account codes (spec §19.2 default seed).
pub const ACCOUNT_CASH: &str = "1000";
pub const ACCOUNT_AR: &str = "1200";
pub const ACCOUNT_AP: &str = "2000";
pub const ACCOUNT_EQUITY: &str = "3000";
pub const ACCOUNT_SALES: &str = "4000";
pub const ACCOUNT_COGS: &str = "5000";
pub const ACCOUNT_OPEX: &str = "6000";

const DEFAULT_ACCOUNTS: &[(&str, &str, &str)] = &[
    (ACCOUNT_CASH, "Cash", "asset"),
    (ACCOUNT_AR, "Accounts Receivable", "asset"),
    (ACCOUNT_AP, "Accounts Payable", "liability"),
    (ACCOUNT_EQUITY, "Owner's Equity", "equity"),
    (ACCOUNT_SALES, "Sales Revenue", "revenue"),
    (ACCOUNT_COGS, "Cost of Goods Sold", "expense"),
    (ACCOUNT_OPEX, "Operating Expenses", "expense"),
];

// ==========================================
// RETURN TYPES
// ==========================================

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub company_id: String,
    pub code: String,
    pub name: String,
    pub account_type: String,
    pub is_system: bool,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: String,
    pub company_id: String,
    pub entry_date: String,
    pub reference_type: String,
    pub reference_id: Option<String>,
    pub description: Option<String>,
    pub created_by: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct JournalLine {
    pub id: String,
    pub journal_entry_id: String,
    pub account_id: String,
    pub account_code: String,
    pub account_name: String,
    pub debit: i64,
    pub credit: i64,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AccountBalance {
    pub id: String,
    pub code: String,
    pub name: String,
    pub account_type: String,
    pub debit_total: i64,
    pub credit_total: i64,
    pub net: i64, // positive = debit balance, negative = credit balance
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntryWithLines {
    #[serde(flatten)]
    pub entry: JournalEntry,
    pub lines: Vec<JournalLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerSummary {
    pub accounts: Vec<AccountBalance>,
    pub total_debit: i64,
    pub total_credit: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatementRow {
    pub entry_id: String,
    pub entry_date: String,
    pub reference_type: String,
    pub reference_id: Option<String>,
    pub description: Option<String>,
    pub debit: i64,
    pub credit: i64,
    pub running_balance: i64,
}

// ==========================================
// POSTING HELPERS
// ==========================================

/// Seeds the default chart of accounts for a company (idempotent).
pub async fn ensure_chart_of_accounts(pool: &SqlitePool, company_id: &str) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Transaction error: {e}"))?;
    seed_default_accounts(&mut tx, company_id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;
    Ok(())
}

/// INSERT OR IGNORE the default accounts inside an open transaction.
async fn seed_default_accounts(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    company_id: &str,
) -> Result<(), String> {
    for (code, name, account_type) in DEFAULT_ACCOUNTS {
        sqlx::query(
            r#"
            INSERT OR IGNORE INTO accounts (id, company_id, code, name, account_type, is_system)
            VALUES (?, ?, ?, ?, ?, 1)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(company_id)
        .bind(code)
        .bind(name)
        .bind(account_type)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Chart of accounts error: {e}"))?;
    }
    Ok(())
}

/// A single side of a journal entry line (for posting).
#[derive(Debug, Clone)]
pub struct JournalLineInput {
    pub account_code: String,
    pub debit: i64,
    pub credit: i64,
    pub description: Option<String>,
}

/// Posts a balanced journal entry inside the caller's transaction.
/// Validates SUM(debit) == SUM(credit) and that both sides are non-zero.
pub async fn post_journal_entry(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    company_id: &str,
    entry_date: &str,
    reference_type: &str,
    reference_id: Option<&str>,
    description: &str,
    lines: Vec<JournalLineInput>,
    created_by: Option<&str>,
) -> Result<(), String> {
    let mut total_debit: i64 = 0;
    let mut total_credit: i64 = 0;
    for line in &lines {
        total_debit += line.debit;
        total_credit += line.credit;
    }

    if total_debit == 0 && total_credit == 0 {
        return Err("Journal entry must have at least one line".to_string());
    }
    if total_debit != total_credit {
        return Err(format!(
            "Unbalanced journal entry: debit {total_debit} != credit {total_credit}"
        ));
    }

    seed_default_accounts(tx, company_id).await?;

    let entry_id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO journal_entries
            (id, company_id, entry_date, reference_type, reference_id, description, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&entry_id)
    .bind(company_id)
    .bind(entry_date)
    .bind(reference_type)
    .bind(reference_id)
    .bind(description)
    .bind(created_by)
    .execute(&mut **tx)
    .await
    .map_err(|e| format!("Journal entry insert error: {e}"))?;

    for line in lines {
        let account_id = sqlx::query_scalar::<_, String>(
            "SELECT id FROM accounts WHERE company_id = ? AND code = ?",
        )
        .bind(company_id)
        .bind(&line.account_code)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| format!("Account lookup error: {e}"))?
        .ok_or_else(|| format!("Account {} not found", line.account_code))?;

        sqlx::query(
            r#"
            INSERT INTO journal_entry_lines
                (id, journal_entry_id, account_id, debit, credit, description)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&entry_id)
        .bind(&account_id)
        .bind(line.debit)
        .bind(line.credit)
        .bind(line.description)
        .execute(&mut **tx)
        .await
        .map_err(|e| format!("Journal line insert error: {e}"))?;
    }

    Ok(())
}

/// Posts the sale entry for a finalized invoice:
///   Dr Accounts Receivable / Cr Sales Revenue (grand total).
pub async fn post_invoice_sale(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    company_id: &str,
    invoice_id: &str,
    invoice_date: &str,
    invoice_number: &str,
    grand_total: i64,
    created_by: &str,
) -> Result<(), String> {
    post_journal_entry(
        tx,
        company_id,
        invoice_date,
        "invoice",
        Some(invoice_id),
        &format!("Sale invoice {invoice_number}"),
        vec![
            JournalLineInput {
                account_code: ACCOUNT_AR.to_string(),
                debit: grand_total,
                credit: 0,
                description: Some(format!("Invoice {invoice_number}")),
            },
            JournalLineInput {
                account_code: ACCOUNT_SALES.to_string(),
                debit: 0,
                credit: grand_total,
                description: Some(format!("Invoice {invoice_number}")),
            },
        ],
        Some(created_by),
    )
    .await
}

/// Posts the collection entry for a recorded payment:
///   Dr Cash / Cr Accounts Receivable.
pub async fn post_payment_collection(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    company_id: &str,
    payment_id: &str,
    payment_date: &str,
    invoice_number: &str,
    amount: i64,
    created_by: &str,
) -> Result<(), String> {
    post_journal_entry(
        tx,
        company_id,
        payment_date,
        "payment",
        Some(payment_id),
        &format!("Payment received for invoice {invoice_number}"),
        vec![
            JournalLineInput {
                account_code: ACCOUNT_CASH.to_string(),
                debit: amount,
                credit: 0,
                description: Some(format!("Payment for {invoice_number}")),
            },
            JournalLineInput {
                account_code: ACCOUNT_AR.to_string(),
                debit: 0,
                credit: amount,
                description: Some(format!("Payment for {invoice_number}")),
            },
        ],
        Some(created_by),
    )
    .await
}

// ==========================================
// QUERY COMMANDS
// ==========================================

/// Lists the chart of accounts for the current company.
#[tauri::command]
pub async fn get_chart_of_accounts(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<Vec<Account>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    check_permission(pool.inner(), &current_user.role, "ledger", "view").await?;

    ensure_chart_of_accounts(pool.inner(), company_id).await?;

    let accounts =
        sqlx::query_as::<_, Account>("SELECT * FROM accounts WHERE company_id = ? ORDER BY code")
            .bind(company_id)
            .fetch_all(pool.inner())
            .await
            .map_err(|e| format!("Database error: {e}"))?;

    Ok(accounts)
}

/// Trial balance: every account with its debit/credit totals and net.
#[tauri::command]
pub async fn get_ledger_summary(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
) -> Result<LedgerSummary, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    check_permission(pool.inner(), &current_user.role, "ledger", "view").await?;

    ensure_chart_of_accounts(pool.inner(), company_id).await?;

    let rows: Vec<AccountBalance> = sqlx::query_as::<_, AccountBalance>(
        r#"
        SELECT
            a.id,
            a.code,
            a.name,
            a.account_type,
            COALESCE(SUM(l.debit), 0)  AS debit_total,
            COALESCE(SUM(l.credit), 0) AS credit_total,
            COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) AS net
        FROM accounts a
        LEFT JOIN journal_entry_lines l ON l.account_id = a.id
        WHERE a.company_id = ?
        GROUP BY a.id, a.code, a.name, a.account_type
        ORDER BY a.code
        "#,
    )
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Ledger summary error: {e}"))?;

    let total_debit: i64 = rows.iter().map(|r| r.debit_total).sum();
    let total_credit: i64 = rows.iter().map(|r| r.credit_total).sum();

    Ok(LedgerSummary {
        accounts: rows,
        total_debit,
        total_credit,
    })
}

/// Recent journal entries with their lines.
#[tauri::command]
pub async fn get_journal_entries(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    limit: Option<i64>,
) -> Result<Vec<JournalEntryWithLines>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    check_permission(pool.inner(), &current_user.role, "ledger", "view").await?;

    let limit = limit.unwrap_or(50).clamp(1, 500);

    let entries = sqlx::query_as::<_, JournalEntry>(
        r#"
        SELECT * FROM journal_entries
        WHERE company_id = ?
        ORDER BY entry_date DESC, created_at DESC
        LIMIT ?
        "#,
    )
    .bind(company_id)
    .bind(limit)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Database error: {e}"))?;

    let mut result = Vec::with_capacity(entries.len());
    for entry in entries {
        let lines = sqlx::query_as::<_, JournalLine>(
            r#"
            SELECT
                l.id,
                l.journal_entry_id,
                l.account_id,
                a.code AS account_code,
                a.name AS account_name,
                l.debit,
                l.credit,
                l.description
            FROM journal_entry_lines l
            JOIN accounts a ON a.id = l.account_id
            WHERE l.journal_entry_id = ?
            ORDER BY l.rowid
            "#,
        )
        .bind(&entry.id)
        .fetch_all(pool.inner())
        .await
        .map_err(|e| format!("Journal lines error: {e}"))?;

        result.push(JournalEntryWithLines { entry, lines });
    }

    Ok(result)
}

/// Statement (ledger card) for one account with running balance.
#[tauri::command]
pub async fn get_account_statement(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    account_id: String,
) -> Result<Vec<AccountStatementRow>, String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    check_permission(pool.inner(), &current_user.role, "ledger", "view").await?;

    let rows = sqlx::query_as::<_, AccountStatementRow>(
        r#"
        SELECT
            e.id            AS entry_id,
            e.entry_date,
            e.reference_type,
            e.reference_id,
            COALESCE(l.description, e.description) AS description,
            l.debit,
            l.credit,
            0               AS running_balance
        FROM journal_entry_lines l
        JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE l.account_id = ? AND e.company_id = ?
        ORDER BY e.entry_date, e.created_at
        "#,
    )
    .bind(&account_id)
    .bind(company_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| format!("Statement error: {e}"))?;

    let mut running: i64 = 0;
    let mut out = Vec::with_capacity(rows.len());
    for mut row in rows {
        running += row.debit - row.credit;
        row.running_balance = running;
        out.push(row);
    }

    Ok(out)
}

/// Posts a manual adjustment entry (balanced, validated).
#[tauri::command]
pub async fn post_manual_entry(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    entry_date: String,
    description: String,
    lines: Vec<ManualLineInput>,
) -> Result<(), String> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let company_id = current_user
        .company_id
        .as_ref()
        .ok_or("You are not assigned to a company")?;

    check_permission(pool.inner(), &current_user.role, "ledger", "post").await?;

    if lines.len() < 2 {
        return Err("A journal entry needs at least two lines".to_string());
    }

    let mut tx = pool
        .inner()
        .begin()
        .await
        .map_err(|e| format!("Transaction error: {e}"))?;

    let mut total_debit: i64 = 0;
    let mut total_credit: i64 = 0;
    for line in &lines {
        if line.debit < 0 || line.credit < 0 {
            return Err("Amounts cannot be negative".to_string());
        }
        total_debit += line.debit;
        total_credit += line.credit;
    }

    if total_debit != total_credit {
        return Err(format!(
            "Unbalanced journal entry: debit {total_debit} != credit {total_credit}"
        ));
    }

    let inputs = lines
        .into_iter()
        .map(|l| JournalLineInput {
            account_code: l.account_code,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
        })
        .collect();

    post_journal_entry(
        &mut tx,
        company_id,
        &entry_date,
        "adjustment",
        None,
        &description,
        inputs,
        Some(&current_user.id),
    )
    .await?;

    tx.commit()
        .await
        .map_err(|e| format!("Commit error: {e}"))?;

    Ok(())
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualLineInput {
    pub account_code: String,
    pub debit: i64,
    pub credit: i64,
    pub description: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::inventory::create_product;
    use crate::commands::invoices::{
        add_invoice_item, create_customer, create_invoice, finalize_invoice, record_payment,
    };
    use crate::commands::test_helpers::{register_owner, setup_app};
    use tauri::Manager;

    async fn owner_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = setup_app().await;
        register_owner(&app, "owner@test.com").await;
        app
    }

    async fn make_customer(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> crate::commands::invoices::PublicCustomer {
        create_customer(
            app.state(),
            app.state(),
            "Ledger Co".to_string(),
            "cust@test.com".to_string(),
            "0300-111".to_string(),
            "Lahore".to_string(),
            "".to_string(),
            "".to_string(),
            "".to_string(),
            "registered".to_string(),
        )
        .await
        .expect("create customer")
    }

    async fn make_product(
        app: &tauri::App<tauri::test::MockRuntime>,
    ) -> crate::commands::inventory::PublicProduct {
        create_product(
            app.state(),
            app.state(),
            "".to_string(),
            "Widget".to_string(),
            "".to_string(),
            "".to_string(),
            500,
            1000,
            0,
            100,
            "pcs".to_string(),
        )
        .await
        .expect("create product")
    }

    async fn make_invoice(
        app: &tauri::App<tauri::test::MockRuntime>,
        customer_id: &str,
    ) -> crate::commands::invoices::PublicInvoice {
        create_invoice(
            app.state(),
            app.state(),
            customer_id.to_string(),
            "2026-01-10".to_string(),
            "2026-02-10".to_string(),
            "PO-1".to_string(),
            "".to_string(),
        )
        .await
        .expect("create invoice")
    }

    async fn invoice_total_by_code(
        app: &tauri::App<tauri::test::MockRuntime>,
        code: &str,
    ) -> (i64, i64) {
        let company_id: String = sqlx::query_scalar("SELECT id FROM companies LIMIT 1")
            .fetch_one(app.state::<SqlitePool>().inner())
            .await
            .expect("company id");
        let (debit, credit): (i64, i64) = sqlx::query_as(
            "SELECT COALESCE(SUM(l.debit), 0), COALESCE(SUM(l.credit), 0)
             FROM journal_entry_lines l
             JOIN accounts a ON a.id = l.account_id
             WHERE a.company_id = ? AND a.code = ?",
        )
        .bind(&company_id)
        .bind(code)
        .fetch_one(app.state::<SqlitePool>().inner())
        .await
        .expect("ledger totals");
        (debit, credit)
    }

    #[tokio::test]
    async fn finalize_invoice_posts_ar_debit_and_sales_credit() {
        let app = owner_app().await;
        let customer = make_customer(&app).await;
        let product = make_product(&app).await;
        let invoice = make_invoice(&app, &customer.id).await;

        add_invoice_item(
            app.state(),
            app.state(),
            invoice.id.clone(),
            product.id.clone(),
            2,
            1000,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .expect("add item");

        finalize_invoice(app.state(), app.state(), invoice.id.clone())
            .await
            .expect("finalize");

        let (ar_debit, ar_credit) = invoice_total_by_code(&app, ACCOUNT_AR).await;
        assert_eq!(ar_debit, 2000, "AR should be debited grand total");
        assert_eq!(ar_credit, 0);

        let (sales_debit, sales_credit) = invoice_total_by_code(&app, ACCOUNT_SALES).await;
        assert_eq!(sales_debit, 0);
        assert_eq!(sales_credit, 2000, "Sales should be credited grand total");
    }

    #[tokio::test]
    async fn record_payment_posts_cash_debit_and_ar_credit() {
        let app = owner_app().await;
        let customer = make_customer(&app).await;
        let product = make_product(&app).await;
        let invoice = make_invoice(&app, &customer.id).await;

        add_invoice_item(
            app.state(),
            app.state(),
            invoice.id.clone(),
            product.id.clone(),
            1,
            1000,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .expect("add item");

        finalize_invoice(app.state(), app.state(), invoice.id.clone())
            .await
            .expect("finalize");

        record_payment(
            app.state(),
            app.state(),
            invoice.id.clone(),
            600,
            "cash".to_string(),
            "2026-01-12".to_string(),
            "CHQ-1".to_string(),
            "".to_string(),
        )
        .await
        .expect("record payment");

        let (cash_debit, cash_credit) = invoice_total_by_code(&app, ACCOUNT_CASH).await;
        assert_eq!(cash_debit, 600);
        assert_eq!(cash_credit, 0);

        // AR: 1000 debit from sale, 600 credit from payment -> net 400.
        let (ar_debit, ar_credit) = invoice_total_by_code(&app, ACCOUNT_AR).await;
        assert_eq!(ar_debit, 1000);
        assert_eq!(ar_credit, 600);
    }

    #[tokio::test]
    async fn manual_entry_must_be_balanced() {
        let app = owner_app().await;
        let result = post_manual_entry(
            app.state(),
            app.state(),
            "2026-01-15".to_string(),
            "Broken entry".to_string(),
            vec![
                ManualLineInput {
                    account_code: ACCOUNT_CASH.to_string(),
                    debit: 100,
                    credit: 0,
                    description: None,
                },
                ManualLineInput {
                    account_code: ACCOUNT_OPEX.to_string(),
                    debit: 0,
                    credit: 50,
                    description: None,
                },
            ],
        )
        .await;

        assert!(result.is_err(), "unbalanced entry must be rejected");
        assert!(result.unwrap_err().contains("Unbalanced"));
    }

    #[tokio::test]
    async fn manual_entry_rejects_negative_amounts() {
        let app = owner_app().await;
        let result = post_manual_entry(
            app.state(),
            app.state(),
            "2026-01-15".to_string(),
            "Negative".to_string(),
            vec![
                ManualLineInput {
                    account_code: ACCOUNT_CASH.to_string(),
                    debit: 100,
                    credit: 0,
                    description: None,
                },
                ManualLineInput {
                    account_code: ACCOUNT_OPEX.to_string(),
                    debit: -100,
                    credit: 0,
                    description: None,
                },
            ],
        )
        .await;

        assert!(result.is_err(), "negative amounts must be rejected");
    }

    #[tokio::test]
    async fn manual_entry_posts_balanced_adjustment() {
        let app = owner_app().await;
        post_manual_entry(
            app.state(),
            app.state(),
            "2026-01-15".to_string(),
            "Owner contribution".to_string(),
            vec![
                ManualLineInput {
                    account_code: ACCOUNT_CASH.to_string(),
                    debit: 5000,
                    credit: 0,
                    description: Some("Deposit".to_string()),
                },
                ManualLineInput {
                    account_code: ACCOUNT_EQUITY.to_string(),
                    debit: 0,
                    credit: 5000,
                    description: Some("Owner capital".to_string()),
                },
            ],
        )
        .await
        .expect("balanced entry should post");

        let (cash_debit, _) = invoice_total_by_code(&app, ACCOUNT_CASH).await;
        assert_eq!(cash_debit, 5000);
    }

    #[tokio::test]
    async fn ledger_summary_is_balanced() {
        let app = owner_app().await;
        let customer = make_customer(&app).await;
        let product = make_product(&app).await;
        let invoice = make_invoice(&app, &customer.id).await;

        add_invoice_item(
            app.state(),
            app.state(),
            invoice.id.clone(),
            product.id.clone(),
            1,
            1000,
            0,
            "percent".to_string(),
            0,
        )
        .await
        .expect("add item");
        finalize_invoice(app.state(), app.state(), invoice.id.clone())
            .await
            .expect("finalize");

        let summary = get_ledger_summary(app.state(), app.state())
            .await
            .expect("ledger summary");

        assert_eq!(summary.total_debit, summary.total_credit);
        assert!(summary.total_debit > 0);
        assert_eq!(summary.accounts.len(), DEFAULT_ACCOUNTS.len());
    }
}
