# Plugin SDK Specification — Ijaz & Company ERP

> **Status:** Draft — not yet implemented.
> This spec defines the planned plugin architecture for post-v1.0 extensibility.

---

## 1. Overview

The Plugin SDK allows third-party developers to extend the Ijaz & Company ERP
with custom modules, commands, and UI panels — without forking the core
codebase.

Plugins run **inside the Tauri Rust process** (not in a sandbox), so trust is
a prerequisite. Only plugins signed by the platform vendor or explicitly
approved by the super admin will load.

---

## 2. Plugin Lifecycle

```
Discover → Validate → Register → Initialize → Ready → Shutdown
```

| Phase | Description |
|-------|------------|
| **Discover** | Scan `plugins/` directory for `plugin.toml` manifests. |
| **Validate** | Check signature, API version compatibility, required permissions. |
| **Register** | Plugin declared in `company_modules` table with `is_enabled = false`. |
| **Initialize** | Plugin's `init()` called with the platform context handle. |
| **Ready** | Plugin registered its commands, UI routes, and event listeners. |
| **Shutdown** | Plugin's `shutdown()` called on app exit or disable. |

---

## 3. Plugin Manifest (`plugin.toml`)

```toml
[plugin]
id = "com.example.my-plugin"
name = "My Custom Plugin"
version = "0.1.0"
api_version = "1"
author = "Example Corp"
description = "Adds a custom report for seasonal analysis."

[permissions]
requires = ["reports.view", "invoices.view"]
grants = ["reports.export"]

[[commands]]
name = "get_seasonal_report"
description = "Returns seasonal sales breakdown"

[[ui]]
route = "/plugins/my-plugin/dashboard"
label = "Seasonal Dashboard"
icon = "chart-bar"
```

---

## 4. Rust Plugin Trait

```rust
pub trait Plugin: Send + Sync {
    /// Unique identifier (reverse-DNS recommended).
    fn id(&self) -> &str;

    /// Human-readable name.
    fn name(&self) -> &str;

    /// Called once when the plugin is initialized.
    /// Register commands, event listeners, and UI routes here.
    fn init(&self, ctx: &PluginContext) -> Result<(), PluginError>;

    /// Called on app exit or when the plugin is disabled.
    fn shutdown(&self) -> Result<(), PluginError>;

    /// Returns the list of Tauri commands this plugin exposes.
    fn commands(&self) -> Vec<Box<dyn TauriCommand>>;

    /// Returns UI route definitions for the plugin's panels.
    fn ui_routes(&self) -> Vec<UiRoute>;
}
```

---

## 5. Plugin Context

The `PluginContext` provides controlled access to platform services:

```rust
pub struct PluginContext {
    pub pool: SqlitePool,
    pub company_id: String,
    pub user: PublicUser,
    pub event_bus: EventBus,
    pub storage: PluginStorage,
}
```

| Field | Access Level | Notes |
|-------|-------------|-------|
| `pool` | Read-only | Plugins cannot write to the database directly; they must use command functions. |
| `company_id` | Read-only | Scoped to the current tenant. |
| `user` | Read-only | Current authenticated user. |
| `event_bus` | Emit + Subscribe | Plugins can emit and listen to custom events. |
| `storage` | Key-value | Per-plugin key-value storage (separate from the main DB). |

---

## 6. Security Model

1. **Signature verification** — Every plugin `.so`/`.dll` must be signed by
   the platform vendor's key. Unsigned plugins are rejected at discover time.
2. **Permission scoping** — Plugins declare their required and granted
   permissions in the manifest. The platform enforces least-privilege.
3. **No direct DB writes** — Plugins interact with the database through
   exported command functions, not raw SQL.
4. **Sandbox (future)** — A WASM-based sandbox is planned for untrusted
   plugins. The initial release runs plugins in-process with signature trust.

---

## 7. Plugin Storage

Each plugin gets an isolated key-value store backed by a SQLite table:

```sql
CREATE TABLE plugin_storage (
    plugin_id TEXT NOT NULL,
    key       TEXT NOT NULL,
    value     TEXT NOT NULL,
    PRIMARY KEY (plugin_id, key)
);
```

Access is through `PluginStorage::get(plugin_id, key)` and
`PluginStorage::set(plugin_id, key, value)`.

---

## 8. Frontend Integration

Plugins register UI routes that the React frontend loads lazily:

```tsx
// The plugin's UI is a self-contained React module
import { PluginRouter } from '@ijaz-erp/plugin-sdk/react';

<PluginRouter pluginId="com.example.my-plugin" />
```

The plugin's frontend bundle is loaded from `plugins/<id>/dist/` at runtime.
Each plugin provides its own `package.json` with the SDK as a peer dependency.

---

## 9. Event Bus

Plugins participate in the platform event system:

```rust
// Emit a custom event
ctx.event_bus.emit("my-plugin:data-ready", payload);

// Subscribe to platform events
ctx.event_bus.on("invoice:finalized", |event| {
    // React to invoice finalization
});
```

Built-in events the platform emits:

| Event | Payload | Description |
|-------|---------|-------------|
| `invoice:finalized` | `InvoiceFinalizedPayload` | An invoice was finalized. |
| `payment:recorded` | `PaymentRecordedPayload` | A payment was recorded. |
| `stock:low` | `LowStockPayload` | A product hit low-stock threshold. |
| `user:login` | `UserLoginPayload` | A user logged in. |

---

## 10. Directory Structure

```
plugins/
  com.example.my-plugin/
    plugin.toml              # Manifest
    src/
      lib.rs                 # Plugin entry point (implements Plugin trait)
    frontend/
      src/
        index.tsx            # UI entry point
      package.json
    target/
      release/
        com_example_my_plugin.dll   # Compiled plugin
    signatures/
      plugin.sig             # Vendor signature
```

---

## 11. CLI Tools (Future)

```bash
# Scaffold a new plugin
ijaz-erp plugin new com.example.my-plugin

# Build and sign
ijaz-erp plugin build --sign

# Install locally
ijaz-erp plugin install ./com.example.my-plugin/

# List installed plugins
ijaz-erp plugin list
```

---

*Last updated: 2026-08-18*
