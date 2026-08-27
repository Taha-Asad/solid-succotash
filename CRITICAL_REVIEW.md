# Ijaz & Company ERP — Critical Code Review & Structural Improvement Plan

> **Date:** 2026-08-27 · **Branch reviewed:** `arena/01a042e8-solid-succotash` @ `b207a29` ("Fbr Compliance")
> **Scope:** full repository — Rust backend (~34,070 LOC), React/TS frontend (~25,074 LOC), 19 SQLite migrations, CI, docs.
> **Verification:** `tsc --noEmit` passes clean. All findings below cite exact files/lines verified in this checkout.

---

## 0. Executive Summary

This is a genuinely solid desktop ERP: bcrypt + `spawn_blocking`, per-request session revalidation, optimistic versioning, soft deletes, FTS5, transactional invoice finalization, audit logging, permission-gated SaaS commands, and **492 in-tree Rust tests** with real DB fixtures. The frontend has near-zero `as any`, strict TS, and a disciplined single invoke bridge.

That said, the project has **three tiers of problems**:

1. **Correctness/security bugs that can bite real users today** — the migration runner re-executes *every* migration on *every* startup and the FTS5 migration is not idempotent (search results duplicate and the index bloats forever); the auto-updater ships a `latest.json` whose version is read from a file that is **3 versions out of sync**; saved sessions survive password changes; `read_file_base64` is an unrestricted arbitrary-file-read command; any logged-in employee can back up (i.e. exfiltrate) the entire company DB; the FBR "sandbox" posts to the production URL.
2. **Structural debt that will throttle the SaaS phase** — 7,800-line and 4,600-line god modules, 145 `#[tauri::command]` fns with hand-rolled auth/audit boilerplate replicated 148×, a 1,104-line API bridge with a hand-maintained 879-line type mirror, 3,152-line page components with 55 `useState`s, no lint/CI gates, no data-fetching layer.
3. **Hygiene** — versions in 5 places, README/analysis docs claiming stale numbers, unused dependencies (`tauri-plugin-sql`, `postgres` feature, `playwright-core`), no ESLint, no `.prettierrc`, `CSP: null`, no `[profile.release]` tuning.

Severity legend: 🔴 critical · 🟠 high · 🟡 medium · 🔵 structural · ⚪ nit

---

## 1. Findings — Correctness & Security (fix first)

### 1.1 🔴 Migration runner re-executes every migration on every startup; FTS5 backfill is not idempotent

`src-tauri/src/db/sqlite_migrate.rs:131-176`: the applied-version list is fetched, **ignored** (`let _ = applied;`), and all 19 embedded migration files are re-executed unconditionally at every launch, under a comment claiming "every migration file is idempotent".

That claim is false for `010_fts5_search.sql:16` and `:49`:

```sql
INSERT INTO products_fts(rowid, name, sku, custom_fields)
SELECT rowid, name, sku, COALESCE(custom_fields, '') FROM products WHERE deleted_at IS NULL;
```

Re-inserting the same rowids into an external-content FTS5 table (without the required `DELETE`/`'rebuild'` step) appends duplicate index entries. Because this runs **every app start**, the FTS index grows linearly with launches and `search_all` (which joins `products_fts ON fts.rowid = p.rowid`, `search.rs:52`) returns **duplicate search hits** for every product/customer, plus a permanently bloated `.db`. Any future migration containing a plain `INSERT` (seed data) or a bare `ALTER TABLE` will corrupt or crash startup on existing installs the same way.

**Fix:** skip already-applied versions (`if applied.contains(&version) { continue }`); keep a *small, explicit* self-heal list for the specific past bug instead of re-running everything; and rewrite the FTS backfill as `INSERT INTO products_fts(products_fts) VALUES('rebuild')` guarded to run once. Add a startup assertion or `PRAGMA integrity_check` + `INSERT INTO products_fts(products_fts) VALUES('integrity-check')` (guarded) if you want self-healing.

### 1.2 🔴 Updater version source is out of sync → updates silently break

- `package.json` = **1.0.6**, `package-lock.json` = **1.0.7**, `src-tauri/Cargo.toml` + `tauri.conf.json` = **1.0.8**, README says "v1.0.5", `PROJECT_ANALYSIS.md` claims "105 commands / 16 migrations / 437 tests" (actual: **~145 commands / 19 migrations / 492 tests** — `grep -rc '#\[tauri::command\]'` counts).
- `.github/workflows/release.yml:134` builds `latest.json` with `$version = (Get-Content package.json | ConvertFrom-Json).version`, while the tag/assets (`v__VERSION__`) come from the Tauri version.

Result: on the next release, `latest.json` advertises the *older* package.json version against the *newer* installer. Clients already on 1.0.8 will treat an update to "1.0.6" as no-update (or downgrade), and Notes.txt's manual "bump in all 5 places" process guarantees this class of drift will keep recurring.

**Fix:** single source of truth — keep the version in `tauri.conf.json` only (Tauri already syncs it to `Cargo.toml` at build; tauri-action's `__VERSION__` uses it), have CI take `latest.json`'s version from the tag (`${{ github.ref_name }}` stripped), and delete the manual version step from `Notes.txt`. Add a CI job that fails if versions mismatch.

### 1.3 🔴 "Remember me" survives password change; no session TTL; `token_version` is write-only

- `app_session` (`005_persistent_session.sql`) stores just `user_id` with a `saved_at` that is **never checked** — the auto-login row is valid forever.
- `require_current_user` (`auth.rs:238+`) revalidates existence/active/company (good), but never looks at `token_version`.
- `token_version` is incremented in three places (`auth.rs:464` password change, `users.rs:271`, `saas.rs:1440`) **and read nowhere**.
- `change_my_password` does **not** delete `app_session`, and `logout_user` (`auth.rs:365`) clears only the in-memory state — the persisted row is only removed by the *frontend* calling `clearSavedSession` (`App.tsx:148`), i.e. logout is UI-enforced.

Practical consequences: steal a laptop with an unlocked-but-locked-app session, change nothing — reboot → still logged in; if a password is rotated after a suspected compromise, the persisted session remains valid. On a machine with DB-file access, an attacker (or the webview via a trivial `invoke("load_saved_session")`) gets an instant authenticated owner session.

**Fix:** make persistence explicit — a random session token stored hashed in both the DB row and in-memory state, validated on restore with a TTL (e.g. 30 days) and rotated on every login; **delete `app_session` server-side** in `change_my_password`, `logout_user`, `set_company_user_active(false)` and account deletion. If you want revocation to be real, actually compare `token_version`: store it in `SessionState`/`app_session` and check it in `require_current_user`.

### 1.4 🔴 `read_file_base64` — unrestricted arbitrary file read command

`src-tauri/src/commands/theme.rs:142-152`: no auth, no path confinement, no size cap; the extension only picks the MIME *string* — reading `C:\Users\me\.ssh\id_rsa` returns it as `data:image/png;base64,…`. Any XSS in the webview (or any future code path that renders untrusted HTML) becomes full filesystem exfiltration. It's also a synchronous `#[tauri::command] pub fn`, blocking on reads of arbitrarily large files.

**Fix:** delete the command and let the dialog plugin read the selected file, or harden it: require `require_current_user`, whitelist only `png/jpg/jpeg/gif/svg` by *magic bytes*, reject paths outside the app-data/uploads dir after `canonicalize()`, cap size (~5 MB), make it `async` with `spawn_blocking`.

### 1.5 🟠 Backup/restore is not crash-safe and backup is not owner-gated

`backup.rs`:
- `create_backup` = `std::fs::copy` of the live DB file. With a rollback journal (sqlx leaves `journal_mode` unset → `DELETE`, and `synchronous=FULL`), copying the main file mid-commit can capture a torn state — backups are neither guaranteed consistent nor compact. Any *authenticated user* can invoke it (only `require_current_user`, no `settings` permission check): an `employee` can snapshot the entire company database — every password hash, PRAL token, and financial record — to any path.
- `restore_backup` writes over the DB file **while the pool holds it open**, then asks the user to restart; the audit write after restore lands on the swapped file handle. The header check reads the *entire* backup into memory (`std::fs::read`).
- Both commands accept arbitrary paths from the renderer (paired with 1.4, that's read+write primitives anywhere).

**Fix:** back up with `VACUUM INTO ?` (SQLite ≥3.27, atomic and consistent) or sqlx's `Connection::backup`; gate both behind `check_permission(…, "settings", "edit")` or owner-only like restore; confine paths to a registered backups directory (canonicalize + prefix check); for restore: `pool.close()` → copy → `app.exit()` with auto-relaunch, and stream-check the header (first 16 bytes) instead of reading the whole file.

### 1.6 🟠 FBR integration: "sandbox" is production, environment is ignored, token in plaintext

- `fbr.rs:592-593`: `sandbox_url` and `production_url` are set to the **same production endpoint** (`gw.fbr.gov.pk`), so sandbox mode posts real invoices; and `process_fbr_queue` (`fbr.rs:472`) always selects `sandbox_url` while `let _ = env_type;` (`fbr.rs:494`) proves the environment was meant to be honored.
- `pral_token` is stored in cleartext in `fbr_config` — and therefore also in every backup (1.5), on disk, in plain sight. `submit_to_fbr` builds a fresh `reqwest::Client` per call, has no timeout (hangs the queue), and response-status matching is stringly-typed (`"valid" || "Valid" || "success"`, `fbr.rs:499`).
- Queue "at-least-once" resend after a crash between send and status-update will **double-submit invoices** (no idempotency key on the payload).

**Fix:** use the actual FBR sandbox host per environment and select `sandbox_url`/`production_url` based on `environment`; move the token to the OS credential store (e.g. `keyring` crate) or encrypt at rest (see §1.9); one `reqwest::Client` (lazy static) with `.timeout(30s)`; parse the response into a serde struct; dedupe submissions with a client-generated invoice UUID as idempotency key.

### 1.7 🟠 At-rest data protection is the elephant for a "PECA-compliant" financial app

Everything — financial records, CNIC/NTN/STRN, bcrypt hashes, FBR tokens — sits in an unencrypted SQLite file in `%APPDATA%`. The README sells compliance; compliance reviewers will ask this question. **Recommendation:** decide explicitly between (a) accepting the threat model and documenting it, or (b) `sqlx` + SQLCipher (fork or `sqflite-cipher`-style build) / per-company key in OS keychain applied via an encryption layer for the truly sensitive columns (at minimum: `pral_token`). Don't half-do this; pick and document.

### 1.8 🟠 Webview hardening: `csp: null` + `withGlobalTauri: true`

`tauri.conf.json` disables CSP **and** exposes `window.__TAURI__` globally. The frontend imports `@tauri-apps/api` via bundler imports (verified: `invoke` only from `src/api/*.ts` via ESM), so the global isn't needed. With 128 commands reachable from any injected script (including `restore_backup`, `install_update`, `execute_import`), CSP is your only blast-radius control. **Fix:** `"withGlobalTauri": false`, and set a real CSP (`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'`; Mantine needs the inline-style allowance — scope it via `style-src-attr` if possible).

### 1.9 🟡 Misc correctness nits worth queuing

- `lib.rs:17-23` `write_error_log` **overwrites** (`fs::write`) — first error after a good run destroys the log; use append + timestamps, or adopt `tauri-plugin-log`.
- Startup failures `panic!` after `sleep(10s)` "so the user can read it" (`lib.rs:92-113`) — a dialog (plugin already present) is the UX-correct path; panics in `run()` also skip cleanup.
- `greet` command is still registered (`lib.rs:142`) — remove.
- `db/mod.rs` is `pub mod sqlite_migrate;` with CRLF while every other file is… mixed CRLF/LF — add `.gitattributes` + Prettier/editorconfig to stop churn.
- `search.rs:104` FTS query builds `"word"*` tokens by string interpolation after whitespace split; embedded `"` in a term breaks FTS syntax (query is *safe* from injection but can error out); strip `"` too.
- `post_manual_entry` accepts lines with both debit and credit positive (or both zero) — a journal line should be exactly one side > 0; add the check.
- `LoginAttemptTracker` counts per-email only (fine for desktop) but never caps the HashMap size — trivial unbounded memory (each distinct email = one entry, never evicted except on success).
- `pdf.rs` hand-rolls PDFs with base-14 Helvetica/WinAnsi — **Urdu/RTL and any non-ASCII text will be lost or garbled** in PDF exports even though the UI is bilingual; either embed a TTF (e.g. via the `printpdf`/`krilla` crate) or render PDF from the invoice HTML through the webview.
- `.env.example` is empty but the `dotenv` crate is a dependency — either use it for documented config or drop `dotenv`.

---

## 2. Structural Critique — Backend

### 2.1 The `commands/` layer is doing everything (and it shows)

```
import_wizard.rs   7,782 LOC  (9 commands + CSV/XLSX/DOCX/PDF/OCR parsing + adapters + jobs + templates + rollback + emit-progress)
invoices.rs        4,603 LOC  (19 commands + numbering + ledger posting + HTML/PDF/Excel rendering + FBR queueing)
inventory.rs       4,055 LOC
saas.rs            2,425 LOC
```

`#[tauri::command]` functions are simultaneously the HTTP-layer, the service layer, and the repository layer. Evidence of the cost:

- `format!("Database error: {e}")` is hand-repeated **148×** across the codebase, leaking raw SQLite strings into user-facing toasts.
- Auth boilerplate — `require_current_user` → `check_permission` → extract `company_id` → business logic → `log_audit` with 9 positional args — is repeated in ~every one of the 145 commands, with **drift**: `create_backup` has no permission gate (1.5); `updater.rs` has no auth at all; `theme.rs::read_file_base64` bypasses everything (1.4). Guard-by-convention fails exactly where a reviewer isn't looking.
- Tests are excellent in count (492) but welded to production modules — `invoices.rs` is ~37% `#[cfg(test)]` code inside the same file that a dev must scroll.

**Target layout (mechanical, no semantics change):**

```
src-tauri/src/
  error.rs                  // AppError (thiserror) + Into<tauri::Error> with {code, message} payload
  state.rs                  // AppState { pool, session, login_tracker } in one managed struct
  guards.rs                 // authenticate(), authorize(module, action), with_audit(...) — used by ALL commands
  features/
    invoices/
      mod.rs                // #[tauri::command] wrappers ONLY (thin: guard → service → map error)
      service.rs            // finalize/create/numbering logic, takes &mut SqliteConnection
      repository.rs         // all SQL for invoices* tables
      render/               // html.rs, pdf.rs, excel.rs, template.rs (split out of the 4.6k LOC)
      fbr_queue.rs          // queue enqueue/status, talks to fbr/ service
      tests/                // #[cfg(test)] integration tests moved out of the module
    inventory/ …            // same shape
    import/
      analyze.rs, adapters/{csv.rs,xlsx.rs,docx.rs,pdf.rs,ocr.rs}, jobs.rs, rollback.rs, templates.rs
  db/
    pool.rs                 // connect options: pragmas centralized (journal, busy_timeout, foreign_keys, cache)
    migrate.rs              // proper applied-version skip (see §1.1)
```

Rules that make it stick:
1. **Commands are thin.** A `#[tauri::command]` may only: extract state, call `guards`, call one `service` fn, serialize. Enforce with a CI lint (custom `#![deny]`-style clippy lints or a simple grep-test that no `sqlx::query` appears in `mod.rs` files).
2. **One error type.** `AppError` with variants (`Unauthorized`, `Forbidden{module,action}`, `NotFound`, `Conflict{expected,found}`, `Validation(String)`, `Db(sqlx::Error)`, `Io`…) + a `code: String` used by the frontend for i18n instead of string-matching English sentences. Raw `sqlx::Error` is `#[error(transparent)]` and *logged*, never shown.
3. **Audit + auth become middleware.** Write it once: `guard!(pool, session, "invoices", "finalize")?;` expanded via a `macro_rules!` (or proc-macro) that returns the `PublicUser`, does the permission check, and registers the audit call with the result message — new commands then cannot forget either step.
4. **Service fns take `&mut Tx`** so invoice-finalize (invoice + stock deduction + ledger posting + FBR queueing) is one transaction by construction instead of by careful commenting.

### 2.2 Schema layer: triggers are load-bearing, FKs mostly absent

`REFERENCES` appears in exactly **one** migration (`019_fbr_integration.sql`, 3 occurrences); 001–018 model relationships purely through columns, validated by hand-written triggers (`002:60-112`, `003:219-245`, `004:216-238`). sqlx enables `PRAGMA foreign_keys` by default, so adding real FK constraints actually works today. FK clauses give you `ON DELETE RESTRICT` for free and remove per-feature trigger maintenance. **Recommendation:** add explicit `FOREIGN KEY … REFERENCES … ON DELETE RESTRICT` via a one-time table-rebuild migration (SQLite requires copy-recreate); keep triggers only for genuine business rules (no-edit-finalized, role whitelist). While in there: the re-run-every-startup design (§1.1) means `INSERT`-based seeds anywhere are landmines — mark seed data `INSERT OR IGNORE` with a unique key.

### 2.3 Connection/pool policy is implicit

Pool built in `lib.rs:97-118` with defaults: no `busy_timeout` override (5 s default is fine but undocumented), `synchronous=FULL` (slow; `NORMAL` is the accepted trade if you stay journal-DELETE… it isn't — FULL is default and fine; document the choice), no `journal_mode` decision (WAL would let the 30 s notification ticker + imports read/write concurrently — but then §1.5's copy-backup becomes *actively unsafe* until fixed, and `-wal`/`-shm` files must be included in backups). **Recommendation:** centralize a `SqliteConnectOptions` builder in `db/pool.rs`, choose WAL + `synchronous=NORMAL` + backup via `VACUUM INTO` + include sidecar files in `list_backups`, and note it in the README's "Database" row.

### 2.4 Dependency diet (`Cargo.toml`)

- `tauri-plugin-sql` (with `postgres` feature) — **never registered** in `lib.rs`; it also exists to expose SQL to the webview, the opposite of your "commands are the API" design. Remove.
- sqlx `postgres` feature — nothing in the tree connects to Postgres. Remove the feature (smaller binary, smaller CVE surface).
- `tauri = { features = ["test"] }` — the mock-runtime test feature ships in the production binary. Move to `[dev-dependencies] tauri = { features = ["test"] }`… actually `tauri` must stay in `[dependencies]`; instead gate the feature via a `test-utils` feature enabled by `cargo test --features test-utils`, or accept and comment why.
- `tokio` `full` → `rt-multi-thread, macros, sync, time, process` (you don't need fs/net/signal).
- `windows-sys` for one `AttachConsole` call is fine, but `winapi`-style console attach belongs in `#[cfg(all(target_os="windows", debug_assertions))]` — release builds shouldn't spawn consoles.
- No `[profile.release]` block: add `lto = "fat"`, `codegen-units = 1`, `opt-level = "s"`, `strip = true`, `panic = "abort"` — typically 25–40 % smaller NSIS payload and better startup, which matters when you ship updates over GitHub Releases.

### 2.5 CI: the only pipeline is the release pipeline

`.github/workflows/` contains just `release.yml`. Nothing runs `cargo test` (492 tests!), `cargo clippy`, `tsc`, or `cargo audit` on PRs; `cargo audit` failures are `|| echo ::warning::`-swallowed (`release.yml:64`); Linux release runs *only* because it reuses the Windows job's release. Gaps to close:

```
on: pull_request
jobs:
  frontend: npm ci && tsc --noEmit && npm run lint            # lint doesn't exist yet — see §3.5
  backend:    cargo fmt --check && cargo clippy -- -D warnings && cargo test --lib   # ~155 s per your own notes
  audit:      cargo audit (blocking weekly, advisory non-blocking)
  version:    script asserting package.json/Cargo.toml/tauri.conf.json agreement (§1.2)
```

Also: the release deletes-and-recreates the release for a tag (fine), but `latest.json` is regenerated from `package.json` (§1.2), and there is **no rollback story** for a bad signed release (document the "yank the release so clients stop updating" runbook — the updater checks `latest.json`, so deleting the asset is the kill switch).

---

## 3. Structural Critique — Frontend

### 3.1 Page monoliths

`InventoryPage.tsx` = 3,152 LOC / **19 nested components** / **55 `useState`** / 13 `useEffect`; `ImportWizard.tsx` 2,123; `InvoicePage.tsx` 1,482; `SettingsPage.tsx` 1,403; `PurchaseOrderPage.tsx` 1,323; `TenantsPage.tsx` 1,081. `paisaToDisplay`/`displayToPaisa`/`formatDate` are copy-pasted into at least 3 pages (8 total definitions). Every tab re-implements list+modal+submit+toast+refresh-by-hand. This is the bottleneck for the SaaS UI work ahead: every new field touches a 3,000-line file, and there's no unit-testable seam.

**Target structure (per feature):**

```
features/inventory/
  api.ts                 // re-export from src/api, or feature-local queries
  hooks/useProducts.ts   // react-query wrappers: list/create/update/delete + invalidation
  hooks/useStockAdjust.ts
  components/            // ProductTable.tsx, ProductModal.tsx, StockAdjustModal.tsx, BatchesModal.tsx, …
  pages/ProductsTab.tsx, CategoriesTab.tsx, SuppliersTab.tsx, UnitsTab.tsx
  index.tsx              // ~30 lines: Tabs shell
```

Shared primitives promoted to `src/components/`: `DataTable` (columns, pagination, empty-state, density — currently bespoke per page), `MoneyInput` (paisa↔display conversion in **one** place), `StatusBadge`, `ConfirmDelete`, `EntityModal` (form+submit+error-toast+invalidate flow you re-type everywhere).

### 3.2 No server-state management

There is no TanStack Query / SWR; data freshness is hand-managed per page via `useEffect` + `listen()` Tauri events + `onOpenImport`-style callbacks, with refresh storms on tab switch. Adopt **@tanstack/react-query**:
- `queryKeys` per entity (`['products', {page, filter}]`), `invalidateQueries` in every mutation hook — the "did the movements tab refresh after finalize?" class of bug disappears.
- Refetch on window focus + on `notification://*` Tauri events → the 30 s ticker logic (`notifications::start_notification_ticker`) becomes one `queryClient.invalidateQueries()` listener instead of per-page polling effects.
- Removes the majority of the 231 `useState`s across the app.

### 3.3 The IPC boundary is the type boundary — automate it

`src/api/backend.ts` (1,104 LOC, 128 invokes) and `src/types/backend.ts` (879 LOC) are **hand-mirrored** from 145 Rust structs with `#[serde(rename_all = "camelCase")]`. This already shows drift risk: any renamed field compiles fine and breaks at runtime. Options:
1. **`tauri-specta` (recommended):** derive TS bindings + types from the Rust commands, one generated `bindings.ts`, and `typedEvents()` for the import-progress/notification events. The two hand-maintained files shrink to a re-export; mismatches become compile errors.
2. If not ready for codegen: keep `backend.ts` as-is but **split it by domain** (`api/inventory.ts`, `api/invoices.ts`, …) with an `api/index.ts` barrel, and add a CI script asserting each `invoke("name")` exists in `generate_handler!` (a 20-line grep script catches dead renames today).

### 3.4 Routing & navigation

`App.tsx` is a clean state machine (good), but `AppShell` navigation is a single `view` string — no back/forward, no deep-link to `invoices?status=draft`, state lost on the two `window.location.reload()` recovery paths. Low urgency for a windowed app, but a 50-line hash-router (or `wouter`) removes a whole category of "how did I get back here" behavior and lets the onboarding tour reference stable route ids.

### 3.5 Lint/format/tests: currently zero for 25k LOC of TS

No ESLint config, no Prettier, no vitest/jest, no component tests, and `playwright-core` is a **devDependency referenced by nothing** (installed, never used). For React 19 + Mantine 9 add: `eslint` + `typescript-eslint` + `eslint-plugin-react-hooks` (flat config) + `eslint-plugin-jsx-a11y` + Prettier with `prettier-plugin-organize-imports`; a `lint`/`format` script wired into the CI job from §2.5; **vitest** for the pure helpers (`paisaToDisplay`, date math, form validators — the stuff currently only "tested" by 3,000-line files compiling); and either delete `playwright-core` or commit to the Tauri-driver-based e2e smoke it was clearly intended for.

### 3.6 i18n coverage is a feature flag lying about itself

`translations.ts` is disciplined (301 keys, en/ur parity verified — 0 missing). But `t()` is used only in ~8 of 21 screens: **InventoryPage, CustomersPage, AccountsPage, UserManagement, ReportsPage, Dashboard (1), ImportWizard (1)** are hardcoded English. Urdu/RTL is therefore a login-screen/super-admin feature, which the README doesn't say. Either wire `useT()` through the tenant pages (the shared components from §3.1 make this cheap) or downgrade the claim. Same for `dir=rtl` — Mantine's RTL requires `DirectionProvider`; verify it wraps the tenant shell, not just setup pages.

---

## 4. Documentation & Repo Hygiene

- Six overlapping status docs at the root (`PROJECT_ANALYSIS.md`, `PROJECT_PLAN.md`, `SAAS_SPECIFICATION.md`, `PLUGIN_SDK_SPEC.md`, `FUTURE_FEATURES.md`, `TEST_CASES.md`) + `Notes.txt`, each with versions/counts that have already drifted (see §1.2). Move to `docs/` with a one-line "generated/last-verified" header; regenerate counts in CI rather than hand-editing ("427" in README, "437" in analysis, **492** actual test functions today).
- `Notes.txt` release checklist is tribal knowledge — turn it into `docs/RELEASING.md` and script steps 1–2 (version bump automation); steps 3–5 are already done by CI, the checklist should say so.
- `create-icons.py` at root → `scripts/`; `.vscode/extensions.json` is fine.
- README "427 integration tests" and v1.0.5 header are stale as of this review — fix in the same PR as §1.2.
- Commit style: the branch has a single squashed commit (`Fbr Compliance`) — with an external auto-updater, per-release changelogs matter to users; adopt `git-cliff` or conventional commits + `release-notes` generation into `release.yml`'s currently-templated "See the changelog for details" body (which promises a changelog that doesn't exist).

---

## 5. Prioritized Roadmap

| # | Priority | Work | Why now |
|---|----------|------|---------|
| 1 | 🔴 P0 | Fix migration skip-on-applied + FTS rebuild idempotency (§1.1); add integrity guard | Silent data-quality decay on every user's machine, every launch |
| 2 | 🔴 P0 | Single-source version + CI `latest.json` from tag + version-parity check (§1.2) | Next release's updater is broken otherwise |
| 3 | 🔴 P0 | Session persistence hardening: TTL, token check, clear-on-password-change (§1.3) | Financial app; cheap fix, big exposure |
| 4 | 🔴 P0 | Kill/gate `read_file_base64`; CSP on; `withGlobalTauri:false`; owner-gate backups (§1.4, §1.5, §1.8) | Closes the file-read/write blast radius |
| 5 | 🟠 P1 | `VACUUM INTO` backups; safe restore sequencing (§1.5) | Backup is the only recovery story for a single-file DB app |
| 6 | 🟠 P1 | FBR: real sandbox URL, env-aware selection, keyring token, client timeout, idempotency (§1.6) | Compliance feature that currently can submit to the tax authority from a sandbox toggle |
| 7 | 🟠 P1 | CI: PR gate with `cargo test`, `clippy -D warnings`, `tsc`, `eslint`, audit (§2.5, §3.5) | 492 tests currently protect nothing between merges |
| 8 | 🔵 P2 | Backend feature-module refactor: thin commands, services, `AppError`, guard macros (§2.1) | Pre-requisite for SaaS growth; do it per-module (start with `invoices`) |
| 9 | 🔵 P2 | Frontend: react-query + per-feature component split + shared `DataTable`/`MoneyInput` (§3.1–3.3) | Unblocks the multi-tenant UI work; do alongside tauri-specta bindings |
| 10 | 🟡 P2 | FK constraints via rebuild migration (§2.2); `profile.release` + dep diet (§2.4) | Integrity + payload size for auto-updates |
| 11 | 🟡 P3 | i18n coverage sweep of tenant pages (§3.6); docs consolidation (§4) | Polish/claims alignment |

Suggested sequencing for 8–9: they're the same refactor in disguise — pick `invoices` as the pilot module end-to-end (Rust service split + react-query hooks + generated bindings), land it behind a PR with the new CI gates, then template the rest from it.

---

## 6. What's genuinely good (keep doing this)

- **Session revalidation on every command** (`require_current_user` reloads user+company state from DB rather than trusting the cache) — better than most web apps.
- **Password hashing off the async runtime** via `spawn_blocking`; bcrypt 72-byte edge documented; old-password reuse check on change.
- **Optimistic concurrency** (`version` column + `check_version`) and **soft deletes with a table allowlist** (`permissions.rs`) — the allowlist pattern is the right way to do dynamic SQL in SQLite.
- **Transaction-scoped invoice finalization + atomic invoice numbering** (`invoices.rs:2957+`), with a regression test for concurrent numbering.
- **492 tests with real temp-DB fixtures** and Input/Expected-style comments; the test hygiene (e.g. `finalize_deducts_stock_and_locks`) is above average for this stack.
- **FTS5 with a LIKE fallback**, `html_escape` applied consistently in the invoice HTML generator (checked: user data is escaped at every interpolation site), QR via `qrcode`, and paisa-integer money throughout the DB.
- **Audit logging on the right events** (profile, password, backup, restore, archive…) with actor role snapshots.
- The CI's hand-rolled `latest.json` merge for the "&"-in-product-name asset-mangling issue — correctly diagnosed and worked around, with the reasoning left in comments.

---

*Method note: findings were produced by exhaustive static review (locally: file inventory, LOC/metrics, security greps, migration/CI reads, targeted module audits, `tsc --noEmit`). `cargo test`/`cargo clippy` were not executed in this sandbox (full dependency compile); the counts and code quotes are from direct source inspection.*
