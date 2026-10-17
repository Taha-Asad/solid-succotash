use super::helpers::{audit_for, resolve_company_id};
use super::types::{
    PublicTicket, PublicTicketMessage, TicketDetail, TicketMessageRow, TicketRow,
};
use crate::commands::auth::{require_current_user, SessionState};
use crate::db::neon::NeonCloudDb;
use crate::error::AppError;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

// ==========================================
// SUPPORT TICKETS & THREADED MESSAGES (§3.4, §5.1, §6.1, §9.2)
// ==========================================
//
// Intentionally accessible even when a tenant's 14-day trial or subscription
// has expired (Day-15 Read-Only + Support Access mode) so the business owner
// can reach Super Admin (Taha Asadullah) to upgrade or resolve billing.

fn clean_required_text(raw: &str, label: &str, max_len: usize) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation(format!("{label} cannot be empty")));
    }
    if trimmed.chars().count() > max_len {
        return Err(AppError::validation(format!(
            "{label} cannot exceed {max_len} characters"
        )));
    }
    Ok(trimmed.to_string())
}

const VALID_CATEGORIES: &[&str] = &[
    "complaint",
    "recommendation",
    "issue",
    "feature_request",
    "billing",
    "other",
];

const VALID_PRIORITIES: &[&str] = &["low", "normal", "high", "urgent"];

const VALID_STATUSES: &[&str] = &["open", "in_progress", "resolved", "closed"];

fn validate_category(raw: Option<String>) -> Result<String, AppError> {
    let cat = raw
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "issue".to_string());
    if !VALID_CATEGORIES.contains(&cat.as_str()) {
        return Err(AppError::validation(format!(
            "Invalid ticket category '{cat}'. Must be one of: {}",
            VALID_CATEGORIES.join(", ")
        )));
    }
    Ok(cat)
}

fn validate_priority(raw: Option<String>) -> Result<String, AppError> {
    let prio = raw
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "normal".to_string());
    if !VALID_PRIORITIES.contains(&prio.as_str()) {
        return Err(AppError::validation(format!(
            "Invalid ticket priority '{prio}'. Must be one of: {}",
            VALID_PRIORITIES.join(", ")
        )));
    }
    Ok(prio)
}

fn validate_status(raw: &str) -> Result<String, AppError> {
    let st = raw.trim().to_lowercase();
    if !VALID_STATUSES.contains(&st.as_str()) {
        return Err(AppError::validation(format!(
            "Invalid ticket status '{st}'. Must be one of: {}",
            VALID_STATUSES.join(", ")
        )));
    }
    Ok(st)
}

async fn fetch_ticket_by_id(pool: &SqlitePool, ticket_id: &str) -> Result<PublicTicket, AppError> {
    let row = sqlx::query_as::<_, TicketRow>(
        r#"
        SELECT
            t.id,
            t.company_id,
            c.name AS company_name,
            t.created_by,
            t.subject,
            t.category,
            t.priority,
            t.status,
            t.assigned_to,
            (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count,
            t.created_at,
            t.updated_at,
            t.resolved_at
        FROM tickets t
        LEFT JOIN companies c ON c.id = t.company_id
        WHERE t.id = ?
        "#,
    )
    .bind(ticket_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::database(format!("Database error: {e}")))?
    .ok_or_else(|| AppError::not_found("Support ticket not found"))?;

    Ok(row.to_public())
}

async fn fetch_ticket_messages(
    pool: &SqlitePool,
    ticket_id: &str,
) -> Result<Vec<PublicTicketMessage>, AppError> {
    let rows = sqlx::query_as::<_, TicketMessageRow>(
        r#"
        SELECT
            id,
            ticket_id,
            user_id,
            sender_name,
            sender_role,
            message,
            attachments,
            created_at
        FROM ticket_messages
        WHERE ticket_id = ?
        ORDER BY created_at ASC, rowid ASC
        "#,
    )
    .bind(ticket_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::database(format!("Database error: {e}")))?;

    Ok(rows.into_iter().map(|r| r.to_public()).collect())
}

#[tauri::command]
pub async fn create_ticket(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    subject: String,
    category: Option<String>,
    priority: Option<String>,
    message: String,
    company_id: Option<String>,
) -> Result<TicketDetail, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let target_company_id = resolve_company_id(&current_user, company_id)?;

    let subject = clean_required_text(&subject, "Subject", 200)?;
    let message = clean_required_text(&message, "Message", 4000)?;
    let category = validate_category(category)?;
    let priority = validate_priority(priority)?;

    let ticket_id = Uuid::new_v4().to_string();
    let msg_id = Uuid::new_v4().to_string();

    sqlx::query(
        r#"
        INSERT INTO tickets (
            id, company_id, created_by, subject, category, priority, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'open')
        "#,
    )
    .bind(&ticket_id)
    .bind(&target_company_id)
    .bind(&current_user.id)
    .bind(&subject)
    .bind(&category)
    .bind(&priority)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::database(format!("Failed to create ticket: {e}")))?;

    sqlx::query(
        r#"
        INSERT INTO ticket_messages (
            id, ticket_id, user_id, sender_name, sender_role, message, attachments
        ) VALUES (?, ?, ?, ?, ?, ?, '[]')
        "#,
    )
    .bind(&msg_id)
    .bind(&ticket_id)
    .bind(&current_user.id)
    .bind(&current_user.full_name)
    .bind(&current_user.role)
    .bind(&message)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::database(format!("Failed to create ticket message: {e}")))?;

    audit_for(
        pool.inner(),
        &current_user,
        &target_company_id,
        "create",
        "ticket",
        Some(&ticket_id),
        &format!("Created support ticket '{subject}' ({category}/{priority})"),
    )
    .await;

    // Best-effort sync to Neon Cloud so Super Admin sees the ticket remotely
    let cloud = NeonCloudDb::global();
    if let Some(pg) = cloud.pool() {
        let _ = sqlx::query(
            r#"
            INSERT INTO tickets (
                id, company_id, created_by, subject, category, priority, status
            ) VALUES ($1, $2, $3, $4, $5, $6, 'open')
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(&ticket_id)
        .bind(&target_company_id)
        .bind(&current_user.id)
        .bind(&subject)
        .bind(&category)
        .bind(&priority)
        .execute(pg)
        .await;

        let _ = sqlx::query(
            r#"
            INSERT INTO ticket_messages (
                id, ticket_id, user_id, sender_name, sender_role, message
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(&msg_id)
        .bind(&ticket_id)
        .bind(&current_user.id)
        .bind(&current_user.full_name)
        .bind(&current_user.role)
        .bind(&message)
        .execute(pg)
        .await;
    }

    let ticket = fetch_ticket_by_id(pool.inner(), &ticket_id).await?;
    let messages = fetch_ticket_messages(pool.inner(), &ticket_id).await?;

    Ok(TicketDetail { ticket, messages })
}

#[tauri::command]
pub async fn list_tickets(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    company_id: Option<String>,
    status: Option<String>,
) -> Result<Vec<PublicTicket>, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;

    let status_filter = match status {
        Some(ref s) if !s.trim().is_empty() && s.trim() != "all" => Some(validate_status(s)?),
        _ => None,
    };

    if current_user.is_super_admin {
        let rows = match (&company_id, &status_filter) {
            (Some(cid), Some(st)) => {
                sqlx::query_as::<_, TicketRow>(
                    r#"
                    SELECT
                        t.id, t.company_id, c.name AS company_name, t.created_by,
                        t.subject, t.category, t.priority, t.status, t.assigned_to,
                        (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count,
                        t.created_at, t.updated_at, t.resolved_at
                    FROM tickets t
                    LEFT JOIN companies c ON c.id = t.company_id
                    WHERE t.company_id = ? AND t.status = ?
                    ORDER BY t.updated_at DESC, t.created_at DESC
                    "#,
                )
                .bind(cid)
                .bind(st)
                .fetch_all(pool.inner())
                .await
            }
            (Some(cid), None) => {
                sqlx::query_as::<_, TicketRow>(
                    r#"
                    SELECT
                        t.id, t.company_id, c.name AS company_name, t.created_by,
                        t.subject, t.category, t.priority, t.status, t.assigned_to,
                        (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count,
                        t.created_at, t.updated_at, t.resolved_at
                    FROM tickets t
                    LEFT JOIN companies c ON c.id = t.company_id
                    WHERE t.company_id = ?
                    ORDER BY t.updated_at DESC, t.created_at DESC
                    "#,
                )
                .bind(cid)
                .fetch_all(pool.inner())
                .await
            }
            (None, Some(st)) => {
                sqlx::query_as::<_, TicketRow>(
                    r#"
                    SELECT
                        t.id, t.company_id, c.name AS company_name, t.created_by,
                        t.subject, t.category, t.priority, t.status, t.assigned_to,
                        (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count,
                        t.created_at, t.updated_at, t.resolved_at
                    FROM tickets t
                    LEFT JOIN companies c ON c.id = t.company_id
                    WHERE t.status = ?
                    ORDER BY t.updated_at DESC, t.created_at DESC
                    "#,
                )
                .bind(st)
                .fetch_all(pool.inner())
                .await
            }
            (None, None) => {
                sqlx::query_as::<_, TicketRow>(
                    r#"
                    SELECT
                        t.id, t.company_id, c.name AS company_name, t.created_by,
                        t.subject, t.category, t.priority, t.status, t.assigned_to,
                        (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count,
                        t.created_at, t.updated_at, t.resolved_at
                    FROM tickets t
                    LEFT JOIN companies c ON c.id = t.company_id
                    ORDER BY t.updated_at DESC, t.created_at DESC
                    "#,
                )
                .fetch_all(pool.inner())
                .await
            }
        }
        .map_err(|e| AppError::database(format!("Database error: {e}")))?;

        return Ok(rows.into_iter().map(|r| r.to_public()).collect());
    }

    let own_company_id = resolve_company_id(&current_user, None)?;
    if let Some(requested_cid) = company_id {
        if requested_cid != own_company_id {
            return Err(AppError::forbidden(
                "Cannot view support tickets belonging to another company",
            ));
        }
    }

    let rows = match status_filter {
        Some(st) => {
            sqlx::query_as::<_, TicketRow>(
                r#"
                SELECT
                    t.id, t.company_id, c.name AS company_name, t.created_by,
                    t.subject, t.category, t.priority, t.status, t.assigned_to,
                    (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count,
                    t.created_at, t.updated_at, t.resolved_at
                FROM tickets t
                LEFT JOIN companies c ON c.id = t.company_id
                WHERE t.company_id = ? AND t.status = ?
                ORDER BY t.updated_at DESC, t.created_at DESC
                "#,
            )
            .bind(&own_company_id)
            .bind(st)
            .fetch_all(pool.inner())
            .await
        }
        None => {
            sqlx::query_as::<_, TicketRow>(
                r#"
                SELECT
                    t.id, t.company_id, c.name AS company_name, t.created_by,
                    t.subject, t.category, t.priority, t.status, t.assigned_to,
                    (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = t.id) AS message_count,
                    t.created_at, t.updated_at, t.resolved_at
                FROM tickets t
                LEFT JOIN companies c ON c.id = t.company_id
                WHERE t.company_id = ?
                ORDER BY t.updated_at DESC, t.created_at DESC
                "#,
            )
            .bind(&own_company_id)
            .fetch_all(pool.inner())
            .await
        }
    }
    .map_err(|e| AppError::database(format!("Database error: {e}")))?;

    Ok(rows.into_iter().map(|r| r.to_public()).collect())
}

#[tauri::command]
pub async fn get_ticket_detail(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    ticket_id: String,
) -> Result<TicketDetail, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let ticket = fetch_ticket_by_id(pool.inner(), &ticket_id).await?;

    if !current_user.is_super_admin {
        let own_company_id = resolve_company_id(&current_user, None)?;
        if ticket.company_id != own_company_id {
            return Err(AppError::forbidden(
                "You do not have permission to view this support ticket",
            ));
        }
    }

    let messages = fetch_ticket_messages(pool.inner(), &ticket_id).await?;
    Ok(TicketDetail { ticket, messages })
}

#[tauri::command]
pub async fn reply_ticket(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    ticket_id: String,
    message: String,
) -> Result<TicketDetail, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let message = clean_required_text(&message, "Message", 4000)?;
    let ticket = fetch_ticket_by_id(pool.inner(), &ticket_id).await?;

    if !current_user.is_super_admin {
        let own_company_id = resolve_company_id(&current_user, None)?;
        if ticket.company_id != own_company_id {
            return Err(AppError::forbidden(
                "You do not have permission to reply to this support ticket",
            ));
        }
    }

    let msg_id = Uuid::new_v4().to_string();
    let sender_role = if current_user.is_super_admin {
        "super_admin"
    } else {
        current_user.role.as_str()
    };

    sqlx::query(
        r#"
        INSERT INTO ticket_messages (
            id, ticket_id, user_id, sender_name, sender_role, message, attachments
        ) VALUES (?, ?, ?, ?, ?, ?, '[]')
        "#,
    )
    .bind(&msg_id)
    .bind(&ticket_id)
    .bind(&current_user.id)
    .bind(&current_user.full_name)
    .bind(sender_role)
    .bind(&message)
    .execute(pool.inner())
    .await
    .map_err(|e| AppError::database(format!("Failed to add ticket reply: {e}")))?;

    // If Super Admin replies to an 'open' ticket, automatically move it to 'in_progress'
    if current_user.is_super_admin && ticket.status == "open" {
        sqlx::query(
            r#"
            UPDATE tickets
            SET status = 'in_progress',
                assigned_to = COALESCE(assigned_to, ?),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(&current_user.id)
        .bind(&ticket_id)
        .execute(pool.inner())
        .await
        .map_err(|e| AppError::database(format!("Failed to update ticket status: {e}")))?;
    } else {
        sqlx::query("UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(&ticket_id)
            .execute(pool.inner())
            .await
            .map_err(|e| AppError::database(format!("Failed to touch ticket timestamp: {e}")))?;
    }

    let cloud = NeonCloudDb::global();
    if let Some(pg) = cloud.pool() {
        let _ = sqlx::query(
            r#"
            INSERT INTO ticket_messages (
                id, ticket_id, user_id, sender_name, sender_role, message
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
            "#,
        )
        .bind(&msg_id)
        .bind(&ticket_id)
        .bind(&current_user.id)
        .bind(&current_user.full_name)
        .bind(sender_role)
        .bind(&message)
        .execute(pg)
        .await;
    }

    let updated_ticket = fetch_ticket_by_id(pool.inner(), &ticket_id).await?;
    let messages = fetch_ticket_messages(pool.inner(), &ticket_id).await?;

    Ok(TicketDetail {
        ticket: updated_ticket,
        messages,
    })
}

#[tauri::command]
pub async fn update_ticket_status(
    pool: State<'_, SqlitePool>,
    session: State<'_, SessionState>,
    ticket_id: String,
    status: String,
) -> Result<PublicTicket, AppError> {
    let current_user = require_current_user(pool.inner(), session.inner()).await?;
    let new_status = validate_status(&status)?;
    let ticket = fetch_ticket_by_id(pool.inner(), &ticket_id).await?;

    if !current_user.is_super_admin {
        let own_company_id = resolve_company_id(&current_user, None)?;
        if ticket.company_id != own_company_id {
            return Err(AppError::forbidden(
                "You do not have permission to update this support ticket",
            ));
        }
    }

    let is_resolved = matches!(new_status.as_str(), "resolved" | "closed");
    if is_resolved {
        sqlx::query(
            r#"
            UPDATE tickets
            SET status = ?,
                resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(&new_status)
        .bind(&ticket_id)
        .execute(pool.inner())
        .await
        .map_err(|e| AppError::database(format!("Failed to update ticket status: {e}")))?;
    } else {
        sqlx::query(
            r#"
            UPDATE tickets
            SET status = ?,
                resolved_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            "#,
        )
        .bind(&new_status)
        .bind(&ticket_id)
        .execute(pool.inner())
        .await
        .map_err(|e| AppError::database(format!("Failed to update ticket status: {e}")))?;
    }

    audit_for(
        pool.inner(),
        &current_user,
        &ticket.company_id,
        "update",
        "ticket",
        Some(&ticket_id),
        &format!("Updated ticket status to '{new_status}'"),
    )
    .await;

    let cloud = NeonCloudDb::global();
    if let Some(pg) = cloud.pool() {
        let _ = sqlx::query(
            r#"
            UPDATE tickets
            SET status = $1,
                resolved_at = CASE WHEN $1 IN ('resolved', 'closed') THEN NOW() ELSE NULL END,
                updated_at = NOW()
            WHERE id = $2
            "#,
        )
        .bind(&new_status)
        .bind(&ticket_id)
        .execute(pg)
        .await;
    }

    fetch_ticket_by_id(pool.inner(), &ticket_id).await
}
