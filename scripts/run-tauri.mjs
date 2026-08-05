import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const keep = new Set(["PATH", "XDG_DATA_HOME"]);

for (const [name, value] of Object.entries(process.env)) {
  if (keep.has(name)) continue;
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
