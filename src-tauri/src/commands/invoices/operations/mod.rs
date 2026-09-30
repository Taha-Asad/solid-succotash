// ==========================================
// INVOICE OPERATIONS MODULE
// ==========================================
//
// Deconstructed modular monolith components:
//   - settings:  Company invoice configuration & numbering rules
//   - query:     Invoice list and multi-entity detail retrieval
//   - items:     Line item additions, updates, deletions, and total recalculations
//   - lifecycle: Creation, finalization, stock deduction, payment, cancellation, and deletion

pub mod items;
pub mod lifecycle;
pub mod query;
pub mod settings;

pub use items::*;
pub use lifecycle::*;
pub use query::*;
pub use settings::*;
