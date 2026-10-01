#![allow(clippy::too_many_arguments)]

// ==========================================
// SAAS MODULE — Multi-Tenant Management Layer
// ==========================================
//
// Modular architecture:
//   - types:         Packages, subscriptions, modules, flags, and analytics models
//   - helpers:       Validation, queries, and audit log helpers
//   - packages:      Plan definition and packaging CRUD
//   - subscriptions: Company plan assignments and lifecycle
//   - modules:       Module enablement per company
//   - flags:         Feature toggles per company
//   - tenants:       Company registration, archival, and lifecycle
//   - analytics:     Cross-company metrics and usage analytics
//   - tests:         Suite of automated regression tests

pub mod types;
pub mod helpers;
pub mod packages;
pub mod subscriptions;
pub mod flags;
pub mod tenants;
pub mod analytics;

#[cfg(test)]
mod tests;

pub use packages::*;
pub use subscriptions::*;
pub use flags::*;
pub use tenants::*;
pub use analytics::*;
