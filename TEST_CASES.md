# TEST CASES

Every test lives in a `#[cfg(test)] mod tests` inside its command file (`src-tauri/src/commands/<module>.rs`)
and runs against a **real SQLite database** with all production migrations (001–009) applied.
Test infra: `src-tauri/src/commands/test_helpers.rs`.

Run everything from `src-tauri/`:

```bash
cargo test --lib          # full suite (366 tests)
cargo check --all-targets # must emit zero warnings
npx tsc --noEmit          # frontend types, run from repo root
```

Key infrastructure facts:

- `setup_app()` builds a mock Tauri app managing a temp-file SQLite pool, the in-memory session and the
  login-rate-limit tracker, exactly like `lib.rs` at runtime.
- `register_owner(app, email)` registers the first company + owner and logs them in.
- `insert_user(pool, company_id, email, name, role, active)` seeds extra users directly.
- `set_session_user(app, user)` switches the current session user.
- `check_permission` short-circuits: role `owner` is **always** allowed (`permissions.rs:21`).
  Employees/admins rely on the seeded `role_permissions` rows.
- No test may depend on `created_at` ordering of rows written in the same second (second-precision timestamps).

---

## Production bugs found & fixed while writing these tests

1. `purchase_orders.rs` — three SQL **literal-misplacement** bugs: quoted literals sat in the wrong
   `VALUES` slot of an INSERT, so the wrong column received the literal.
   - `purchase_orders`: `'draft'` was bound into `expected_date`; the status column got the date/NULL.
     Fixed to `VALUES (?,?,?,?,?,?,'draft',?,?)`.
   - `stock_movements`: `'purchase'` sat at `product_id`, so `movement_type` got a UUID → trigger
     `(code: 1811) Product does not exist`. Fixed to `(?,?,?,'purchase',?,?,?)`.
   - `stock_batches`: `'purchase'` consumed `expiry_date` (6 values for 7 columns). Fixed to `(?,?,?,?,?,?,'purchase')`.
2. `purchase_orders.rs` — `next_po_number` was a read-then-write; two concurrent POs both hit
   `UNIQUE constraint failed: company_po_settings.company_id`. Rewritten as one atomic upsert:
   `INSERT ... VALUES (?, 1) ON CONFLICT(company_id) DO UPDATE SET next_number = next_number + 1 RETURNING next_number`.
   Also eliminated a flaky stale-read failure in tests caused by SQLite pooling.
3. `invoices.rs` — `finalize_invoice` never set `balance_due`, so unpaid finalized invoices reported
   balance 0. The UPDATE now sets `balance_due = grand_total`.
4. `import_wizard.rs` — `detect_field` checked SELL PRICE before TAX, and its broad `"rate"` pattern
   matched `"tax rate"` by substring, so a `Tax Rate` column mapped to `sell_price` and the `tax_rate`
   branch was unreachable. TAX is now checked before SELL PRICE.
5. `backup.rs` — `create_backup`/`restore_backup` hardcoded the production DB path via
   `get_database_path()`, so they ignored the pool's actual DB file (and a restore test would have
   overwritten a developer's real database). Now derived from `pool.connect_options().get_filename()`.

---

## auth.rs — 43 tests

### Pure helpers
- `normalize_email_*` — trims/lowercases; rejects missing `@`, empty parts, too-long (>254) input.
- `person_name_*` — accepts valid; rejects <2 and >100 chars.
- `password_*` — accepts ≥8 chars; rejects <8 and >72 bytes (bcrypt limit).
- `password_hash_roundtrip` — `hash_password` → `verify_password` succeeds.
- `hash_is_never_plaintext` — stored hash ≠ plaintext.
- `user_write_error_map*` — maps sqlite UNIQUE errors to `email already exists`; other errors pass through.
- `tracker_*` (LoginAttemptTracker) — allows below max, blocks at 5, expires old attempts,
  case-insensitive keys, `clear` resets.

### Commands
- `login_succeeds_with_valid_credentials` — wrong/unknown/inactive user/inactive company all fail;
  5 failures then block; `logout_clears_session`.
- `current_user_*` — errors when not logged in, when the user or their company is deactivated.
- `update_profile_*` — success; requires login; rejects short/long names.
- `change_password_*` — success; rejects wrong current, same password, short new password.
- Session persistence: `save_then_load_restores_session`, `load_without_saved_session_fails`,
  `load_clears_stale_session_for_deactivated_user`, `clear_saved_session_removes_row`.

---

## company.rs — 31 tests

### Pure helpers
- `company_name_*`, `currency_code_*` (uppercases, exact 3 letters, rejects digits), `optional_*`
  (None/empty→None, trims, length limit), `optional_email_*` (normalizes, blank→None, invalid rejected).

### Commands
- `register_creates_company_and_owner_and_logs_in` — one shot registers + logs in.
- `register_*` — rejects short name, invalid email, short password, invalid currency;
  `register_allows_only_one_company` (second company rejected).
- `is_company_setup_*` — false before, true after registration.
- `get_company_*` — returns company; requires login.
- `update_company_*` — owner & admin succeed; employee denied; requires login; invalid currency/email rejected.
- `fetch_company_returns_row` — DB row matches the managed company.

---

## users.rs — 38 tests

- Role/company guards: `managed_role_*`, `company_id_*`, `fetch_company_user_*`.
- `list_users_*` — owner sees all ordered by role; employee denied; user without company rejected; login required.
- `create_user_*` — owner creates admin & employee; admin creates employee but **cannot** create admin;
  employee denied; invalid role, duplicate email, short password rejected.
- `change_role_*` — owner promotes/demotes; non-owner denied; owner row protected; invalid role/unknown user rejected.
- `set_active_*` — owner deactivates/reactivates employee; cannot touch self or another owner;
  admin needs `users/update` permission, cannot touch admins; employee denied; unknown user rejected.

---

## inventory.rs — 70 tests

### Pure helpers
- `clean_optional_*`, `sku_prefix_*` (short words, spaces, 6-char cap, category fallback),
  `batch_status_*` (depleted/expired/ok/garbage-date), `expiry_parse*`/`expiry_disambiguate*`/`expiry_reject*`.

### Categories
- `list_categories_*`, `create_category_*` (prefix generated, empty/duplicate rejected, employee denied),
  `update_category_*` (success bumps version, stale-version conflict, not found, empty name),
  `set_category_active_*`, `delete_category_*` (soft delete, not found, employee denied).

### Suppliers
- `supplier_full_crud_cycle`, `create_supplier_rejects_empty_name`, `update_supplier_*` (conflict/not-found).

### Products
- `create_product_*` — auto-SKU sequences (`SKU-1`, …), explicit SKU kept, initial stock movement recorded,
  negative price/stock rejected, duplicate SKU rejected, empty name rejected, employee denied.
- `update_product_*` — success bumps version, blank SKU keeps existing, stale-version conflict,
  negative price rejected, not found.

### Stock movements & batches
- `adjust_stock_purchase_and_sale`; rejects invalid type, positive sale, zero, missing product, bad expiry.
- `expiry_batch_created_on_stock_in`, `fifo_deducts_soonest_batch_first`,
  `list_expiring_batches_*`, `write_off_batch_*` (reduces batch + stock; rejects invalid qty; not found).
- `list_stock_movements_requires_login`, `deduct_fifo_*` noops, `add_batch_inserts_row`.

---

## invoices.rs — 47 tests

### Pure helpers
- `clean_optional_*`, `round_*` (PKR half-up rounding, negative handled via euclid),
  `line_amounts_*` (percent/fixed discounts, clamping to subtotal, no discount/tax),
  `timestamp_epoch_*`, `is_leap_*`, `invoice_numbers_increment`.

### Customers
- `create_customer_succeeds`, empty name / bad buyer type rejected, employee denied,
  `list_customers_and_delete`, `delete_customer_not_found`, `list_customers_requires_login`.

### Invoices
- `create_invoice_draft_with_number`, `create_invoice_customer_not_found`, employee denied.
- `add_item_*` — recalcs totals; rejects zero qty, negative price, missing product, item on finalized invoice,
  invoice not found.
- `update_and_remove_item`, `update_item_not_on_invoice`.
- `finalize_*` — deducts stock + locks; rejects insufficient stock, zero total, double finalize; employee denied.
- `get_invoice_*`, `list_invoices_returns_all`.
- `record_payment_*` — partial & full; rejects overpayment, draft invoice, invalid method, non-positive amount.
- `settings_*` — defaults created, upsert update, employee denied, idempotent `get_or_create`.

---

## purchase_orders.rs — 34 tests

- `po_numbers_increment` — atomic upsert produces sequential `PO-0001…` (stable across repeats).
- `create_po_*` — draft with number; supplier not found; employee denied; login required.
- `add_po_item_*` — recalcs totals; rejects zero qty, missing product, PO not found, item on ordered PO.
- `owner_always_can_edit_po_items` / `employee_cannot_edit_po_items` — owner short-circuit vs permission denial.
- `remove_po_item_*` — removes + recalcs (order-independent assertion); missing item is a no-op.
- `submit_*` — draft→ordered; double submit rejected; not found; employee denied.
- `receive_*` — stock increased + movement recorded; expiry batch created; non-ordered PO rejected;
  PO not found; second receive rejected after received.
- `po_payment_*` — partial & full; rejects overpayment, draft, non-positive amount, PO not found.
- `get_purchase_order_*`, `list_purchase_orders_*`.

---

## permissions.rs — 18 tests

- `check_permission_owner_always_allowed` — owner needs no seed rows.
- `check_permission_admin_*` / `employee_*` — seeded allow/deny paths.
- `check_permission_unknown_role_denied`, `check_permission_disallowed_row_denied`.
- `soft_delete_*` — marks existing row, second delete is a no-op, missing id / wrong company affect 0 rows,
  invalid table rejected.
- `check_version_*` — matching passes, stale conflict fails, deleted record fails, invalid table fails.
- `bump_version_*` — increments; invalid table rejected.

---

## audit.rs — 11 tests

- `log_audit_writes_one_row`; `log_audit_failure_does_not_panic`.
- `list_*` — requires login; employee denied; only own company's logs; newest first; honors limit;
  clamps a low limit up; honors offset; negative offset treated as 0; admin can view.

---

## reports.rs — 22 tests

- `sales_summary_*` — empty; aggregates finalized + paid; counts draft invoices; login required.
- `sales_by_month_*` — empty; groups by month; excludes cancelled.
- `top_products_*` — empty; orders by revenue.
- `top_customers_*` — empty; aggregates invoice totals; includes customers with no invoices.
- `stock_report_*` — empty; flags low/out-of-stock; threshold defaults to 10.
- `profit_loss_*` — empty; computes margin; ignores drafts.
- `customer_ledger_*` — empty; lists balances.
- `product_movements_*` — empty; sums purchases vs sales.

---

## export.rs — 12 tests

- `escape_csv_*` — plain unchanged; comma/quotes wrapped + inner quotes doubled; newlines quoted.
- `export_stock_csv` — header + row with computed value 2500; empty company → header only;
  login required; employee denied (`reports/export`); invalid path → `Write error`.
- `export_customer_ledger_csv` — header + `invoiced 2000, paid 0, balance 2000`; login required.
- `export_sales_csv` — header + row with invoice number and totals; employee denied.

---

## import_wizard.rs — 27 tests

### Pure helpers
- `normalize_header_*`, `propose_mappings_*` (core fields, custom fallback `custom:flavor`, index echo),
  `parse_price_*` (paisa conversion: `15.00`→1500, `1500`→1500, `1,500.00`→150000; 2-decimal truncation),
  `cell_to_string_*`, `parse_docx_table_*` (extracts first table, joins multi-paragraph cells; malformed XML errors),
  `looks_like_date_*`, `detect_field_type_*` (numeric vs text columns).

### analyze_import_file
- `analyze_csv_*` — headers/rows/mappings; header-only file → 0 total rows.
- Rejects empty bytes, unsupported type, missing login.
- `analyze_docx_*` — real in-memory ZIP/.docx table parsed; docx without a table rejected.

### execute_import
- `execute_import_creates_products_relations_and_batches` — end-to-end: 2 products, category + supplier
  shared/created, stock movement `Imported from file`, expiry batch (`source = 'import'`),
  custom field setting (`flavor`, type `text`), template saved, audit `import` row.
- Duplicate SKU → row error `Duplicate SKU 'A-1'`.
- Missing name mapping → every row errors with the "no product NAME" guidance.
- Blank rows skipped. Bad expiry → row error, other rows still import.
- `import_data = false` → custom field created, zero products.
- 50-error cap → 50 counted + a `Stopped after 50 errors` cap entry.
- Login required.

---

## backup.rs — 13 tests

- `format_timestamp_*` — 0 → `1970-01-01 00:00`; 86400 → `1970-01-02 00:00`.
- `create_backup_*` — copies the pool's live DB to the save path (SQLite header, size > 0) + audit row;
  login required; unwritable path → `Backup failed`.
- `restore_backup_*` — login required; owner-only; missing file; non-SQLite file rejected;
  success path writes the `.<db>.before_restore` safety copy + audit `restore` row.
- `list_backups_*` — lists only `.db` files with name/size/created_at; missing dir → empty; login required.
