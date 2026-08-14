#!/usr/bin/env node
// ==========================================
// fetch-tesseract.mjs — bundle Tesseract OCR for the Windows installer
// ==========================================
//
// Downloads the official UB-Mannheim Tesseract Windows build, extracts it
// with 7-Zip, and stages the minimal runtime set (tesseract.exe + its DLLs +
// eng/osd traineddata + configs) into `src-tauri/bin/tesseract/` so the NSIS
// installer ships OCR and image/scanned-document import works without
// Tesseract installed on PATH (spec §23.2 Phase 2).
//
// The staged folder is referenced by `tauri.conf.json` `bundle.resources`
// and resolved at runtime by `import_wizard::resolve_tesseract_bundle`.
//
// On non-Windows platforms the script only makes sure the staging directory
// exists (those builds keep using the system `tesseract` on PATH at runtime).
//
// Requirements:
//   - Node.js 18+ (built-in fetch)
//   - 7-Zip (full `7z.exe`, not just standalone `7za`) for NSIS extraction:
//       * Windows: C:\Program Files\7-Zip\7z.exe (preinstalled on GitHub
//         Actions windows runners)
//       * any: `7z` / `7zz` on PATH, or the SEVENZIP_BIN env var
//
// Usage:  node scripts/fetch-tesseract.mjs [--force]
//   --force  re-download the installer even if it is cached.

import { execFileSync, spawnSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rm, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_TAURI = path.join(ROOT, "src-tauri");
const STAGE_DIR = path.join(SRC_TAURI, "bin", "tesseract");
const CACHE_DIR = path.join(__dirname, ".cache");
const EXTRACT_DIR = path.join(CACHE_DIR, "tesseract-extract");

const VERSION = "5.4.0.20240606";
const INSTALLER = `tesseract-ocr-w64-setup-${VERSION}.exe`;
const INSTALLER_URL = `https://github.com/UB-Mannheim/tesseract/releases/download/v${VERSION}/${INSTALLER}`;

const force = process.argv.includes("--force");

// ---------------------------------------------------------------------------
// 7-Zip discovery (NSIS installers need the full 7z, not standalone 7za)
// ---------------------------------------------------------------------------
function find7z() {
  const candidates = [
    process.env.SEVENZIP_BIN,
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
  ].filter(Boolean);

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  for (const name of ["7z", "7zz"]) {
    const probe = spawnSync(name, ["i"], { stdio: "ignore", shell: process.platform === "win32" });
    if (probe.status === 0) return name;
  }

  throw new Error(
    "7-Zip not found. Install 7-Zip (https://www.7-zip.org/), ensure `7z` is on PATH, " +
      "or set SEVENZIP_BIN to the full 7z.exe path (e.g. 'C:\\Program Files\\7-Zip\\7z.exe').",
  );
}

// ---------------------------------------------------------------------------
// Download with resume-friendly semantics (skip when already cached)
// ---------------------------------------------------------------------------
async function ensureInstaller() {
  await mkdir(CACHE_DIR, { recursive: true });
  const installerPath = path.join(CACHE_DIR, INSTALLER);
  if (existsSync(installerPath) && !force) {
    console.log(`Using cached installer: ${installerPath}`);
    return installerPath;
  }
  console.log(`Downloading ${INSTALLER} ...`);
  const response = await fetch(INSTALLER_URL, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (HTTP ${response.status}): ${INSTALLER_URL}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(installerPath));
  console.log(`Saved installer: ${installerPath}`);
  return installerPath;
}

// ---------------------------------------------------------------------------
// Extract, then stage the minimal runtime set
// ---------------------------------------------------------------------------
async function extract(sevenZip, installerPath) {
  await rm(EXTRACT_DIR, { recursive: true, force: true });
  await mkdir(EXTRACT_DIR, { recursive: true });
  console.log("Extracting with 7-Zip (this can take a minute)...");
  execFileSync(sevenZip, ["x", "-y", `-o${EXTRACT_DIR}`, installerPath], { stdio: "inherit" });
}

async function stage() {
  const root = EXTRACT_DIR;
  const tessdataSrc = path.join(root, "tessdata");
  if (!existsSync(path.join(root, "tesseract.exe")) || !existsSync(tessdataSrc)) {
    throw new Error("Extraction did not produce tesseract.exe / tessdata — aborting.");
  }

  await rm(STAGE_DIR, { recursive: true, force: true });
  await mkdir(STAGE_DIR, { recursive: true });

  const entries = await readdir(root, { withFileTypes: true });
  let dllCount = 0;
  for (const entry of entries) {
    const src = path.join(root, entry.name);
    // tesseract.exe + every DLL. Training-tool EXEs and docs are not needed.
    if (entry.name === "tesseract.exe" || (entry.isFile() && entry.name.endsWith(".dll"))) {
      await copyFile(src, path.join(STAGE_DIR, entry.name));
      if (entry.name.endsWith(".dll")) dllCount++;
    }
  }

  // eng + osd language data and the configs (psm/table modes work off these).
  const tessdataDest = path.join(STAGE_DIR, "tessdata");
  await mkdir(path.join(tessdataDest, "configs"), { recursive: true });
  for (const file of ["eng.traineddata", "osd.traineddata"]) {
    await copyFile(path.join(tessdataSrc, file), path.join(tessdataDest, file));
  }
  const configs = await readdir(path.join(tessdataSrc, "configs"));
  for (const file of configs) {
    await copyFile(path.join(tessdataSrc, "configs", file), path.join(tessdataDest, "configs", file));
  }

  console.log(
    `Staged Tesseract into ${STAGE_DIR}: tesseract.exe + ${dllCount} DLLs + tessdata (eng, osd, configs)`,
  );

  // Re-create the committed placeholder so the repo keeps a non-empty dir.
  const gitkeep = path.join(STAGE_DIR, ".gitkeep");
  if (!existsSync(gitkeep)) await mkdir(STAGE_DIR, { recursive: true }).then(() => writeFile(gitkeep, ""));
}

async function main() {
  if (process.platform !== "win32" && !(process.env.TESSERACT_FORCE_WIN === "1")) {
    // Non-Windows builds use the system tesseract on PATH. Only ensure the
    // staging dir exists so the bundle resource reference always resolves.
    await mkdir(STAGE_DIR, { recursive: true });
    const gitkeep = path.join(STAGE_DIR, ".gitkeep");
    if (!existsSync(gitkeep)) await writeFile(gitkeep, "");
    console.log(`Non-Windows platform (${process.platform}) — no OCR engine staged.`);
    console.log(`Ensured resource dir exists: ${STAGE_DIR}`);
    return;
  }

  const sevenZip = find7z();
  console.log(`Using 7-Zip: ${sevenZip}`);

  const installerPath = await ensureInstaller();
  await extract(sevenZip, installerPath);
  await stage();
}

main().catch((err) => {
  console.error(`fetch-tesseract failed: ${err.message}`);
  process.exit(1);
});
