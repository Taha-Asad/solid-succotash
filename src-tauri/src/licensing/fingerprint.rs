use sha2::{Digest, Sha256};
use std::fs;

const HWID_SALT: &str = "CORBEL-SOVEREIGN-FINGERPRINT-V1";

/// Generates a deterministic, platform-stable hardware fingerprint.
/// Returns a string formatted as `CRBL-HWID-XXXX-XXXX-XXXX-XXXX`.
pub fn get_hardware_id() -> String {
    let raw_seed = gather_hardware_seed();
    let mut hasher = Sha256::new();
    hasher.update(HWID_SALT.as_bytes());
    hasher.update(raw_seed.as_bytes());
    let result = hasher.finalize();
    let hex_str = hex::encode(result).to_uppercase();

    // Take the first 16 hex characters and format into 4-char chunks
    let chunk1 = &hex_str[0..4];
    let chunk2 = &hex_str[4..8];
    let chunk3 = &hex_str[8..12];
    let chunk4 = &hex_str[12..16];

    format!("CRBL-HWID-{chunk1}-{chunk2}-{chunk3}-{chunk4}")
}

/// Returns a human-friendly hostname for the device.
pub fn get_device_name() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(name) = std::env::var("COMPUTERNAME") {
            if !name.trim().is_empty() {
                return name.trim().to_string();
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(name) = fs::read_to_string("/etc/hostname") {
            let trimmed = name.trim().to_string();
            if !trimmed.is_empty() {
                return trimmed;
            }
        }
        if let Ok(name) = std::env::var("HOSTNAME") {
            if !name.trim().is_empty() {
                return name.trim().to_string();
            }
        }
    }

    "unknown-device".to_string()
}

/// Returns the OS family and architecture description.
pub fn get_os_info() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    format!("{os} {arch}")
}

fn gather_hardware_seed() -> String {
    let mut seeds = Vec::new();

    #[cfg(target_os = "linux")]
    {
        // 1. Linux machine-id (persistent unique ID per installation)
        if let Ok(machine_id) = fs::read_to_string("/etc/machine-id") {
            let id = machine_id.trim();
            if !id.is_empty() {
                seeds.push(id.to_string());
            }
        } else if let Ok(machine_id) = fs::read_to_string("/var/lib/dbus/machine-id") {
            let id = machine_id.trim();
            if !id.is_empty() {
                seeds.push(id.to_string());
            }
        }

        // 2. DMI Product UUID (motherboard/hypervisor level UUID if accessible)
        if let Ok(uuid) = fs::read_to_string("/sys/class/dmi/id/product_uuid") {
            let u = uuid.trim();
            if !u.is_empty() {
                seeds.push(u.to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows Cryptography MachineGuid via command fallback
        if let Ok(output) = std::process::Command::new("reg")
            .args(["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    if line.contains("MachineGuid") {
                        if let Some(val) = line.split_whitespace().last() {
                            seeds.push(val.to_string());
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    if line.contains("IOPlatformUUID") {
                        if let Some(val) = line.split('"').nth(3) {
                            seeds.push(val.to_string());
                        }
                    }
                }
            }
        }
    }

    // Common Fallbacks
    seeds.push(get_device_name());
    seeds.push(get_os_info());

    seeds.join("::")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hwid_deterministic() {
        let hwid1 = get_hardware_id();
        let hwid2 = get_hardware_id();
        assert_eq!(hwid1, hwid2, "HWID must be deterministic across calls");
        assert!(hwid1.starts_with("CRBL-HWID-"), "HWID must have prefix");
        assert_eq!(hwid1.len(), 29, "CRBL-HWID-XXXX-XXXX-XXXX-XXXX is 29 chars");
    }

    #[test]
    fn test_device_name_and_os() {
        let name = get_device_name();
        assert!(!name.is_empty());
        let os = get_os_info();
        assert!(!os.is_empty());
    }
}
