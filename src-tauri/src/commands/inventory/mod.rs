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

#[allow(unused_imports)]
pub use self::types::*;
#[allow(unused_imports)]
pub use self::helpers::*;
#[allow(unused_imports)]
pub use self::categories::*;
#[allow(unused_imports)]
pub use self::suppliers::*;
#[allow(unused_imports)]
pub use self::products::*;
#[allow(unused_imports)]
pub use self::batches::*;
