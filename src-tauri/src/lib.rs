use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

const RUNTIME_MANIFEST: &str = "manifest.json";
const RUNTIME_ENV_VAR: &str = "PIWORK_RUNTIME_DIR";

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeState {
    Ready,
    Missing,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    status: RuntimeState,
    runtime_dir: String,
    manifest_path: String,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
fn runtime_status(app: tauri::AppHandle) -> Result<RuntimeStatus, String> {
    let runtime_dir = runtime_dir(&app)?;
    std::fs::create_dir_all(&runtime_dir).map_err(|error| error.to_string())?;

    let manifest_path = runtime_dir.join(RUNTIME_MANIFEST);
    let status = if manifest_path.exists() {
        RuntimeState::Ready
    } else {
        RuntimeState::Missing
    };

    Ok(RuntimeStatus {
        status,
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
    })
}

fn runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_dir) = std::env::var(RUNTIME_ENV_VAR) {
        return Ok(PathBuf::from(override_dir));
    }

    let base_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(base_dir.join("runtime"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, runtime_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
