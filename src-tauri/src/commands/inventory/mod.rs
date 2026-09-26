#![allow(clippy::too_many_arguments)]

// ==========================================
// INVENTORY MODULE
// ==========================================
//
// Modularized inventory management system:
//   - types:       Data models and DTOs (products, categories, suppliers, batches)
//   - helpers:     SKU generation, error mapping, and sanitization
//   - categories:  Category CRUD and hierarchical grouping
//   - suppliers:   Vendor and supplier management
//   - products:    Product catalog, stock adjustments, and movements
//   - batches:     Batch tracking, expiry alerts, and FIFO stock consumption
//   - tests:       Automated regression and lifecycle test suite

pub mod types;
pub mod helpers;
pub mod categories;
pub mod suppliers;
pub mod products;
pub mod batches;

#[cfg(test)]
mod tests;

pub use self::types::*;
pub use self::helpers::*;
pub use self::categories::*;
pub use self::suppliers::*;
pub use self::products::*;
pub use self::batches::*;
