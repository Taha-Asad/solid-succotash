use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicCategory {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub description: Option<String>,
    pub sku_prefix: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicSupplier {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub contact_person: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub tax_number: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicProduct {
    pub id: String,
    pub company_id: String,
    pub sku: String,
    pub name: String,
    pub category_id: Option<String>,
    pub supplier_id: Option<String>,
    pub cost_price: i64,
    pub sell_price: i64,
    pub tax_rate: i64,
    pub quantity_in_stock: i64,
    pub unit: String,
    pub custom_fields: Option<String>, // JSON blob for company-specific fields
    /// Expiry date of the soonest-expiring live batch (if any).
    /// None = this product has no expiry batches.
    #[sqlx(default)]
    pub next_expiry_date: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicStockMovement {
    pub id: String,
    pub company_id: String,
    pub product_id: String,
    pub movement_type: String,
    pub quantity: i64,
    pub reference_note: Option<String>,
    pub performed_by: Option<String>,
    pub created_at: String,
}



#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicStockBatch {
    pub id: String,
    pub company_id: String,
    pub product_id: String,
    pub product_name: String,
    pub product_sku: String,
    pub batch_number: Option<String>,
    pub quantity: i64,
    pub unit_cost: i64,
    pub expiry_date: String,
    pub source: String,
    pub status: String,
    pub created_at: String,
}
