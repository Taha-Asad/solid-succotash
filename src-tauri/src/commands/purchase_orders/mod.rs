#![allow(clippy::too_many_arguments)]

// ==========================================
// PURCHASE ORDERS MODULE
// ==========================================
//
// Tracks buying from suppliers.
// Lifecycle: draft → ordered → received → paid
//
// Submodules:
//   - types:       DTOs and serializable data models
//   - helpers:     Sequence numbering and total calculations
//   - orders:      Order creation, listing, retrieval, and submission
//   - items:       Item line CRUD and stock receiving workflow
//   - payments:    Supplier payment recording and balance updates
//   - tests:       Automated test suite

pub mod types;
pub mod helpers;
pub mod orders;
pub mod items;
pub mod payments;

#[cfg(test)]
mod tests;

pub use self::orders::*;
pub use self::items::*;
pub use self::payments::*;
