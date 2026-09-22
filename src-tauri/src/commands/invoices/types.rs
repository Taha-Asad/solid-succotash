use serde::Serialize;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicCustomer {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub cnic: Option<String>,
    pub ntn: Option<String>,
    pub strn: Option<String>,
    pub buyer_type: String,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicInvoice {
    pub id: String,
    pub company_id: String,
    pub invoice_number: String,
    pub invoice_date: String,
    pub due_date: Option<String>,
    pub customer_id: String,
    pub status: String,
    pub subtotal: i64,
    pub tax_total: i64,
    pub discount_total: i64,
    pub grand_total: i64,
    pub fbr_invoice_number: Option<String>,
    pub po_number: Option<String>,
    pub reference_note: Option<String>,
    pub amount_paid: i64,
    pub balance_due: i64,
    pub created_by: String,
    pub finalized_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub currency_code: String,
    pub exchange_rate: f64,
    pub irn: Option<String>,
    pub fbr_status: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicInvoiceItem {
    pub id: String,
    pub invoice_id: String,
    pub company_id: String,
    pub product_id: String,
    pub product_name: String,
    pub product_sku: String,
    pub quantity: i64,
    pub unit_price: i64,
    pub tax_rate: i64,
    pub tax_amount: i64,
    pub discount_rate: i64,
    pub discount_amount: i64,
    pub discount_type: String,
    pub line_total: i64,
    pub created_at: String,
    pub original_unit_price: i64,
    pub original_line_total: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PublicPayment {
    pub id: String,
    pub invoice_id: String,
    pub company_id: String,
    pub amount: i64,
    pub payment_method: String,
    pub payment_date: String,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub received_by: String,
    pub created_at: String,
    pub currency_code: String,
    pub exchange_rate: f64,
    pub base_currency_amount: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceWithDetails {
    pub invoice: PublicInvoice,
    pub customer: PublicCustomer,
    pub items: Vec<PublicInvoiceItem>,
    pub payments: Vec<PublicPayment>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceSettings {
    pub company_ntn: Option<String>,
    pub company_strn: Option<String>,
    pub company_cnic: Option<String>,
    pub invoice_prefix: String,
    pub next_number: i64,
    pub default_due_days: i64,
    pub invoice_footer: Option<String>,
    pub terms_conditions: Option<String>,
    pub invoice_design: String,
    pub design_accent_color: String,
    pub show_qr: bool,
    pub excel_template_base64: Option<String>,
    pub disclaimer: Option<String>,
    pub copyright: Option<String>,
    pub bank_details: Option<String>,
}

/// All data required to render an invoice to any output format.
pub struct InvoiceDoc {
    pub invoice: PublicInvoice,
    pub customer: PublicCustomer,
    pub items: Vec<PublicInvoiceItem>,
    pub payments: Vec<PublicPayment>,
    pub company_name: String,
    pub company_email: Option<String>,
    pub company_phone: Option<String>,
    pub company_address: Option<String>,
    pub currency: String,
    pub settings: InvoiceSettings,
    pub logo_base64: Option<String>,
    pub company_tagline: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelTemplateAnalysis {
    pub has_template: bool,
    pub known_tokens: Vec<String>,
    pub unknown_tokens: Vec<String>,
    pub missing_common_tokens: Vec<String>,
}
