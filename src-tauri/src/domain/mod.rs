// ==========================================
// DOMAIN LAYER — PURE BUSINESS INVARIANTS
// ==========================================
//
// Rules in this layer contain NO SQLx queries and NO Tauri runtime dependencies.
// They enforce pure business rules: monetary calculations, minor units,
// tax calculations, and status transitions.

pub mod money;

pub use money::Money;
