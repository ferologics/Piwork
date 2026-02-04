import { invoke } from "@tauri-apps/api/core";

/**
 * Log to terminal via Tauri backend (visible in `mise run tauri-dev` output).
 * Falls back to console.log if Tauri isn't available.
 */
export function devLog(source: string, message: string) {
    // Also log to browser console for DevTools
    console.log(`[${source}] ${message}`);

    // Send to Rust backend to print to stderr
    invoke("dev_log", { source, message }).catch(() => {
        // Ignore errors (e.g., if not running in Tauri)
    });
}
