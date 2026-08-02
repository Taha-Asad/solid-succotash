// ==========================================
// AUTO-UPDATER
// ==========================================
//
// Checks GitHub Releases for new versions on app startup.
// If an update is found, downloads and installs it automatically.
// The database in AppData is NEVER touched by updates.

import { invoke } from "@tauri-apps/api/core";

export type UpdateInfo = {
  version: string;
  date: string | null;
  body: string | null;
};

export type UpdateResult = {
  available: boolean;
  currentVersion: string;
  update: UpdateInfo | null;
};

/// Checks if a new version is available
export async function checkForUpdates(): Promise<UpdateResult> {
  try {
    const result = await invoke<UpdateResult>("check_for_updates");
    return result;
  } catch {
    // Updater not configured yet or network error — that's OK
    return {
      available: false,
      currentVersion: "unknown",
      update: null,
    };
  }
}

/// Downloads and installs the update
export async function installUpdate(): Promise<void> {
  return invoke<void>("install_update");
}
