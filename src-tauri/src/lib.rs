use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

mod auth_store;
mod task_store;
mod vm;

const RUNTIME_MANIFEST: &str = "manifest.json";
const RUNTIME_ENV_VAR: &str = "PIWORK_RUNTIME_DIR";

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeState {
    Ready,
    Missing,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    status: RuntimeState,
    runtime_dir: String,
    manifest_path: String,
    qemu_available: bool,
    qemu_path: Option<String>,
    accel_available: Option<bool>,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
fn dev_log(source: &str, message: &str) {
    eprintln!("[{source}] {message}");
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn runtime_status(app: tauri::AppHandle) -> Result<RuntimeStatus, String> {
    eprintln!("[rust] runtime_status called");
    let runtime_dir = runtime_dir(&app)?;
    std::fs::create_dir_all(&runtime_dir).map_err(|error| error.to_string())?;

    let manifest_path = runtime_dir.join(RUNTIME_MANIFEST);
    let status = if manifest_path.exists() {
        RuntimeState::Ready
    } else {
        RuntimeState::Missing
    };

    let qemu_path = find_qemu_binary(&runtime_dir, &manifest_path);
    let qemu_available = qemu_path.is_some();
    let accel_available = check_accel_available();
    eprintln!("[rust] runtime_status returning status={status:?}");

    Ok(RuntimeStatus {
        status,
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
        qemu_available,
        qemu_path: qemu_path.map(|path| path.to_string_lossy().to_string()),
        accel_available,
    })
}

fn find_qemu_binary(runtime_dir: &Path, manifest_path: &Path) -> Option<PathBuf> {
    if manifest_path.exists() {
        if let Ok(content) = std::fs::read_to_string(manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<vm::RuntimeManifest>(&content) {
                if let Some(qemu) = manifest.qemu {
                    let candidate = runtime_dir.join(qemu);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    find_in_path("qemu-system-aarch64")
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    for entry in path_var.split(':') {
        let candidate = PathBuf::from(entry).join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn check_accel_available() -> Option<bool> {
    if cfg!(target_os = "macos") {
        let output = Command::new("sysctl").arg("-n").arg("kern.hv_support").output().ok()?;
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Some(value == "1");
    }

    None
}

fn runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_dir) = std::env::var(RUNTIME_ENV_VAR) {
        return Ok(PathBuf::from(override_dir));
    }

    let base_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(base_dir.join("runtime"))
}

fn tasks_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(base_dir.join("tasks"))
}

fn auth_file(app: &tauri::AppHandle, profile: Option<String>) -> Result<PathBuf, String> {
    let base_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let profile = profile.unwrap_or_else(|| "default".to_string());
    Ok(base_dir.join("auth").join(profile).join("auth.json"))
}

fn pi_auth_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home_dir = app.path().home_dir().map_err(|error| error.to_string())?;
    Ok(home_dir.join(".pi").join("agent").join("auth.json"))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn vm_status(state: tauri::State<vm::VmState>) -> vm::VmStatusResponse {
    vm::status(&state)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn vm_start(app: tauri::AppHandle, state: tauri::State<vm::VmState>) -> Result<vm::VmStatusResponse, String> {
    let runtime_dir = runtime_dir(&app)?;
    vm::start(&app, &state, &runtime_dir)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn vm_stop(state: tauri::State<vm::VmState>) {
    vm::stop(&state);
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn rpc_send(state: tauri::State<vm::VmState>, message: String) -> Result<(), String> {
    vm::send(&state, &message)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn task_store_list(app: tauri::AppHandle) -> Result<Vec<task_store::TaskMetadata>, String> {
    let tasks_dir = tasks_dir(&app)?;
    task_store::list_tasks(&tasks_dir)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn task_store_upsert(app: tauri::AppHandle, task: task_store::TaskMetadata) -> Result<(), String> {
    let tasks_dir = tasks_dir(&app)?;
    task_store::upsert_task(&tasks_dir, &task)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn task_store_delete(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    let tasks_dir = tasks_dir(&app)?;
    task_store::delete_task(&tasks_dir, task_id)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn auth_store_list(app: tauri::AppHandle, profile: Option<String>) -> Result<auth_store::AuthStoreSummary, String> {
    let auth_path = auth_file(&app, profile)?;
    auth_store::summary(&auth_path)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn auth_store_set_api_key(
    app: tauri::AppHandle,
    provider: String,
    key: String,
    profile: Option<String>,
) -> Result<auth_store::AuthStoreSummary, String> {
    let auth_path = auth_file(&app, profile)?;
    auth_store::set_api_key(&auth_path, &provider, &key)?;
    auth_store::summary(&auth_path)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn auth_store_delete(
    app: tauri::AppHandle,
    provider: String,
    profile: Option<String>,
) -> Result<auth_store::AuthStoreSummary, String> {
    let auth_path = auth_file(&app, profile)?;
    auth_store::delete_provider(&auth_path, &provider)?;
    auth_store::summary(&auth_path)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn auth_store_import_pi(
    app: tauri::AppHandle,
    profile: Option<String>,
) -> Result<auth_store::AuthStoreSummary, String> {
    let auth_path = auth_file(&app, profile)?;
    let source_path = pi_auth_file(&app)?;
    auth_store::import_from_path(&auth_path, &source_path)?;
    auth_store::summary(&auth_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(vm::VmState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            dev_log,
            runtime_status,
            task_store_list,
            task_store_upsert,
            task_store_delete,
            auth_store_list,
            auth_store_set_api_key,
            auth_store_delete,
            auth_store_import_pi,
            vm_status,
            vm_start,
            vm_stop,
            rpc_send,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
