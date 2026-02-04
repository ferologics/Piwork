use serde::{Deserialize, Serialize};
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskMount {
    path: String,
    mode: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskMetadata {
    id: String,
    title: String,
    status: String,
    created_at: String,
    updated_at: String,
    session_file: Option<String>,
    mounts: Option<Vec<TaskMount>>,
    model: Option<String>,
    thinking_level: Option<String>,
    connectors_enabled: Option<Vec<String>>,
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

fn tasks_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(base_dir.join("tasks"))
}

#[tauri::command]
fn task_store_list(app: tauri::AppHandle) -> Result<Vec<TaskMetadata>, String> {
    let tasks_dir = tasks_dir(&app)?;
    std::fs::create_dir_all(&tasks_dir).map_err(|error| error.to_string())?;

    let mut tasks = Vec::new();

    for entry in std::fs::read_dir(&tasks_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let task_path = path.join("task.json");
        if !task_path.exists() {
            continue;
        }

        let content = std::fs::read_to_string(&task_path).map_err(|error| error.to_string())?;
        let task: TaskMetadata = serde_json::from_str(&content).map_err(|error| error.to_string())?;
        tasks.push(task);
    }

    tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(tasks)
}

#[tauri::command]
fn task_store_upsert(app: tauri::AppHandle, task: TaskMetadata) -> Result<(), String> {
    let tasks_dir = tasks_dir(&app)?;
    std::fs::create_dir_all(&tasks_dir).map_err(|error| error.to_string())?;

    let task_dir = tasks_dir.join(&task.id);
    std::fs::create_dir_all(&task_dir).map_err(|error| error.to_string())?;

    let task_path = task_dir.join("task.json");
    let content = serde_json::to_string_pretty(&task).map_err(|error| error.to_string())?;
    std::fs::write(&task_path, content).map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn task_store_delete(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    let tasks_dir = tasks_dir(&app)?;
    let task_dir = tasks_dir.join(task_id);

    if task_dir.exists() {
        std::fs::remove_dir_all(task_dir).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            runtime_status,
            task_store_list,
            task_store_upsert,
            task_store_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
