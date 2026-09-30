// ==========================================
// INVOICE RENDERING MODULE
// ==========================================
//
// Deconstructed modular monolith components:
//   - common: Shared invoice document loader, token maps, QR and format utilities
//   - html:   Browser/Print HTML generator with theme styles
//   - excel:  Excel spreadsheet template analyzer and filler
//   - pdf:    Direct PDF invoice compilation

pub mod common;
pub mod excel;
pub mod html;
pub mod pdf;

#[allow(unused_imports)]
pub use common::*;
#[allow(unused_imports)]
pub use excel::*;
#[allow(unused_imports)]
pub use html::*;
#[allow(unused_imports)]
pub use pdf::*;
