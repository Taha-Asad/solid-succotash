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

#[allow(unused_imports)]
pub use self::types::*;
#[allow(unused_imports)]
pub use self::math::*;
#[allow(unused_imports)]
pub use self::customers::*;
#[allow(unused_imports)]
pub use self::operations::*;
#[allow(unused_imports)]
pub use self::rendering::*;
