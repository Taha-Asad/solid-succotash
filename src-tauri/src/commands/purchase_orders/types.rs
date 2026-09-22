use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ==========================================
// PURCHASE ORDERS — TYPES & DTOs
// ==========================================

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicPurchaseOrder {
    pub id: String,
    pub company_id: String,
    pub supplier_id: String,
    pub supplier_name: String,
    pub po_number: String,
    pub po_date: String,
    pub expected_date: Option<String>,
    pub status: String,
    pub subtotal: i64,
    pub tax_total: i64,
    pub grand_total: i64,
    pub amount_paid: i64,
    pub balance_due: i64,
    pub reference_note: Option<String>,
    pub created_by: String,
    pub received_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicPOItem {
    pub id: String,
    pub po_id: String,
    pub product_id: String,
    pub product_name: String,
    pub product_sku: String,
    pub quantity_ordered: i64,
    pub quantity_received: i64,
    pub unit_cost: i64,
    pub tax_rate: i64,
    pub tax_amount: i64,
    pub line_total: i64,
    pub expiry_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOrderWithItems {
    pub order: PublicPurchaseOrder,
    pub items: Vec<PublicPOItem>,
}

// Expiry dates entered by the user when RECEIVING goods. The supplier's
// expiry is only known once the physical stock arrives, so it is captured
// at receive time (per item), never when the PO item is first added.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiveItemExpiry {
    pub item_id: String,
    pub expiry_date: Option<String>,
}
