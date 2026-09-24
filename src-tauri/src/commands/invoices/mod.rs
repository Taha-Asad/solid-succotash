#![allow(clippy::too_many_arguments)]

// ==========================================
// INVOICE MODULE
// ==========================================
//
// Modularized Pakistani FBR-compliant invoice system:
//   - types:       Data structures & DTOs
//   - math:        Pure calculation, rounding, and formatting logic
//   - customers:   Customer CRUD endpoints
//   - operations:  Invoice lifecycle, payments, settings, and sequence generation
//   - rendering:   HTML/SVG/QR, PDF, and Excel template generators
//   - tests:       Automated regression and lifecycle test suite

pub mod types;
pub mod math;
pub mod customers;
pub mod operations;
pub mod rendering;

#[cfg(test)]
mod tests;

pub use self::types::*;
pub use self::customers::*;
pub use self::operations::*;
pub use self::rendering::*;
