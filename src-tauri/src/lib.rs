use std::path::PathBuf;
use tauri::Manager;

mod task_store;
mod vm;

const RUNTIME_MANIFEST: &str = "manifest.json";
const RUNTIME_ENV_VAR: &str = "PIWORK_RUNTIME_DIR";

#[derive(serde::Serialize)]
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
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
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

fn tasks_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(base_dir.join("tasks"))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(vm::VmState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            runtime_status,
            task_store_list,
            task_store_upsert,
            task_store_delete,
            vm_status,
            vm_start,
            vm_stop,
            rpc_send,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
