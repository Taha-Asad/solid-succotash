#![allow(clippy::too_many_arguments)]

// ==========================================
// IMPORT WIZARD — Schema Discovery Engine
// ==========================================
//
// This is not just "import products from Excel."
// This is the system that ONBOARDS a company by learning
// how they currently organize their business data.
//
// Modular architecture:
//   - types: Structs, enums, constants, quotas, global APP_HANDLE & OCR_BUNDLE
//   - adapters: ERP migration formats (QuickBooks, Odoo, Tally) & heuristic header detection
//   - readers: Multi-format file analyzers (Excel, CSV, DOCX XML, PDF, OCR images)
//   - templates: Reusable per-company column mapping templates & custom field generation
//   - jobs: Quota management, job history, live progress polling & transactional rollback
//   - products: Product catalog & opening stock row validators and importers
//   - parties: Customer and supplier validators, deduplication, and row importers
//   - historical: Sales invoices and purchase bills historical record importers
//   - worker: Background asynchronous streaming import loop & preview dry-run
//   - tests: Comprehensive unit and integration test suite

pub mod types;
pub mod adapters;
pub mod readers;
pub mod templates;
pub mod jobs;
pub mod products;
pub mod parties;
pub mod historical;
pub mod worker;

#[cfg(test)]
mod tests;

#[allow(unused_imports)]
pub use types::*;
#[allow(unused_imports)]
pub use adapters::*;
#[allow(unused_imports)]
pub use readers::*;
#[allow(unused_imports)]
pub use templates::*;
#[allow(unused_imports)]
pub use jobs::*;
#[allow(unused_imports)]
pub use products::*;
#[allow(unused_imports)]
pub use parties::*;
#[allow(unused_imports)]
pub use historical::*;
#[allow(unused_imports)]
pub use worker::*;
