import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// When this repo is developed from inside the VS Code *snap* integrated
// terminal, the snap launcher injects GTK/GIO/GLib environment overrides
// that point at snap-built module directories (GTK_PATH,
// GTK_IM_MODULE_FILE, GIO_MODULE_DIR, ...). A Tauri app linked against the
// host glibc then dlopens those snap modules, which resolves libpthread to
// the snap's core20 copy and aborts with "corrupted double-linked list" or
// a GLIBC_PRIVATE symbol lookup error right after startup.
//
// Strip those overrides before spawning the tauri CLI so dev builds run
// against the host's GTK/GIO stack.
//
// XDG_DATA_HOME is deliberately NOT kept: when launched from the snap it
// points at the snap's glib schema cache
// (~/snap/code/.../.local/share/glib-2.0/schemas/gschemas.compiled), which
// aborts the app with "Settings schema
// 'org.gnome.settings-daemon.plugins.xsettings' does not contain a key named
// 'antialiasing'". Dropping it lets GSettings read the host cache and the app
// starts cleanly.
const keep = new Set(["PATH"]);

const denylist = [
  "GTK_PATH",
  "GTK_IM_MODULE_FILE",
  "GTK_EXE_PREFIX",
  "GTK_MODULES",
  "GDK_BACKEND",
  "GIO_MODULE_DIR",
  "GIO_LAUNCHED_DESKTOP_FILE",
  "GSETTINGS_SCHEMA_DIR",
  "LOCPATH",
  "XDG_DATA_DIRS",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
];

for (const name of Object.keys(process.env)) {
  if (keep.has(name)) continue;
  if (denylist.includes(name)) {
    delete process.env[name];
    continue;
  }
  const value = process.env[name];
  if (typeof value === "string" && value.includes("/snap/")) {
    delete process.env[name];
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "node_modules", "@tauri-apps", "cli", "tauri.js");

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
