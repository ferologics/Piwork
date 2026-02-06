use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;
use tauri::{Emitter, Manager};

mod auth_store;
mod task_store;
mod vm;

const RUNTIME_MANIFEST: &str = "manifest.json";
const RUNTIME_ENV_VAR: &str = "PIWORK_RUNTIME_DIR";
const WORKSPACE_ROOT_ENV_VAR: &str = "PIWORK_WORKSPACE_ROOT";
const AUTH_PROFILE_DEFAULT: &str = "default";

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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkingFolderValidation {
    folder: String,
    workspace_root: String,
    relative_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewFileEntry {
    path: String,
    size: u64,
    modified_at: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewListResponse {
    root: String,
    files: Vec<PreviewFileEntry>,
    truncated: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewReadResponse {
    path: String,
    mime_type: String,
    encoding: String,
    content: String,
    truncated: bool,
    size: u64,
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

    vm::find_in_path("qemu-system-aarch64")
}

fn check_accel_available() -> Option<bool> {
    if cfg!(target_os = "macos") {
        let output = Command::new("sysctl").arg("-n").arg("kern.hv_support").output().ok()?;
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Some(value == "1");
    }

    None
}

fn canonicalize_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| format!("{label} not found: {error}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("{label} must not be a symlink"));
    }

    let canonical = std::fs::canonicalize(path).map_err(|error| format!("Failed to resolve {label}: {error}"))?;
    let canonical_metadata =
        std::fs::metadata(&canonical).map_err(|error| format!("Failed to stat {label}: {error}"))?;

    if !canonical_metadata.is_dir() {
        return Err(format!("{label} must be a directory"));
    }

    Ok(canonical)
}

fn resolve_workspace_root_from_env() -> Result<Option<PathBuf>, String> {
    let Ok(raw_root) = std::env::var(WORKSPACE_ROOT_ENV_VAR) else {
        return Ok(None);
    };

    let trimmed = raw_root.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let canonical = canonicalize_directory(Path::new(trimmed), "workspace root")?;
    Ok(Some(canonical))
}

fn relative_path_string(root: &Path, candidate: &Path) -> Result<String, String> {
    let relative = candidate
        .strip_prefix(root)
        .map_err(|_| "Working folder is outside workspace root".to_string())?;

    let parts: Vec<String> = relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();

    Ok(parts.join("/"))
}

#[tauri::command]
fn runtime_workspace_root() -> Result<Option<String>, String> {
    let root = resolve_workspace_root_from_env()?;
    Ok(root.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn runtime_validate_working_folder(
    folder: String,
    workspace_root: Option<String>,
) -> Result<WorkingFolderValidation, String> {
    let trimmed_folder = folder.trim();
    if trimmed_folder.is_empty() {
        return Err("Working folder is required".to_string());
    }

    let canonical_folder = canonicalize_directory(Path::new(trimmed_folder), "working folder")?;

    let canonical_root = if let Some(root) = workspace_root.as_deref() {
        let trimmed_root = root.trim();
        if trimmed_root.is_empty() {
            canonical_folder.clone()
        } else {
            canonicalize_directory(Path::new(trimmed_root), "workspace root")?
        }
    } else if let Some(env_root) = resolve_workspace_root_from_env()? {
        env_root
    } else {
        canonical_folder.clone()
    };

    if !canonical_folder.starts_with(&canonical_root) {
        return Err("Working folder must be within workspace root".to_string());
    }

    let relative_path = relative_path_string(&canonical_root, &canonical_folder)?;

    Ok(WorkingFolderValidation {
        folder: canonical_folder.to_string_lossy().to_string(),
        workspace_root: canonical_root.to_string_lossy().to_string(),
        relative_path,
    })
}

fn resolve_task_working_folder(app: &tauri::AppHandle, task_id: &str) -> Result<PathBuf, String> {
    let tasks_path = tasks_dir(app)?;
    let task = task_store::load_task(&tasks_path, task_id)?.ok_or_else(|| "Task not found".to_string())?;
    let working_folder = task
        .working_folder
        .ok_or_else(|| "Task has no working folder configured".to_string())?;

    let validated = runtime_validate_working_folder(working_folder, None)?;
    Ok(PathBuf::from(validated.folder))
}

fn normalize_preview_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("relativePath is required".to_string());
    }

    if trimmed.contains('\0') || trimmed.contains('\\') {
        return Err("Invalid relativePath".to_string());
    }

    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Err("relativePath must be relative".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(segment) => normalized.push(segment),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                return Err("relativePath must not traverse parent directories".to_string())
            }
            std::path::Component::RootDir | std::path::Component::Prefix(_) => {
                return Err("Invalid relativePath".to_string())
            }
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err("relativePath is required".to_string());
    }

    Ok(normalized)
}

fn path_within_root(root: &Path, candidate: &Path) -> bool {
    candidate.strip_prefix(root).is_ok()
}

fn detect_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
    {
        Some(ext)
            if [
                "md", "txt", "rs", "ts", "tsx", "js", "jsx", "toml", "yaml", "yml", "css", "svelte", "sh",
            ]
            .contains(&ext.as_str()) =>
        {
            "text/plain"
        }
        Some(ext) if ext == "json" => "application/json",
        Some(ext) if ext == "csv" => "text/csv",
        Some(ext) if ext == "html" || ext == "htm" => "text/html",
        Some(ext) if ext == "png" => "image/png",
        Some(ext) if ext == "jpg" || ext == "jpeg" => "image/jpeg",
        Some(ext) if ext == "gif" => "image/gif",
        Some(ext) if ext == "webp" => "image/webp",
        Some(ext) if ext == "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn is_probably_text(bytes: &[u8]) -> bool {
    if bytes.contains(&0) {
        return false;
    }

    std::str::from_utf8(bytes).is_ok()
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn task_preview_list(app: tauri::AppHandle, task_id: String) -> Result<PreviewListResponse, String> {
    const MAX_FILES: usize = 300;
    const MAX_DEPTH: usize = 6;

    let root = resolve_task_working_folder(&app, &task_id)?;
    let mut files: Vec<PreviewFileEntry> = Vec::new();
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.clone(), 0)];
    let mut truncated = false;

    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };

            if metadata.file_type().is_symlink() {
                continue;
            }

            if metadata.is_dir() {
                if depth < MAX_DEPTH {
                    stack.push((path, depth + 1));
                }
                continue;
            }

            if !metadata.is_file() {
                continue;
            }

            let Ok(relative) = path.strip_prefix(&root) else {
                continue;
            };
            let relative_str = relative
                .components()
                .filter_map(|component| match component {
                    std::path::Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                    _ => None,
                })
                .collect::<Vec<String>>()
                .join("/");

            if relative_str.is_empty() {
                continue;
            }

            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |value| value.as_secs());

            files.push(PreviewFileEntry {
                path: relative_str,
                size: metadata.len(),
                modified_at,
            });

            if files.len() >= MAX_FILES {
                truncated = true;
                break;
            }
        }

        if truncated {
            break;
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(PreviewListResponse {
        root: root.to_string_lossy().to_string(),
        files,
        truncated,
    })
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn task_preview_read(
    app: tauri::AppHandle,
    task_id: String,
    relative_path: String,
) -> Result<PreviewReadResponse, String> {
    const MAX_PREVIEW_BYTES: usize = 256 * 1024;

    let root = resolve_task_working_folder(&app, &task_id)?;
    let relative = normalize_preview_relative_path(&relative_path)?;
    let candidate = root.join(&relative);

    let metadata = std::fs::symlink_metadata(&candidate).map_err(|_| "File not found".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Symlink previews are not allowed".to_string());
    }

    if !metadata.is_file() {
        return Err("Only regular files can be previewed".to_string());
    }

    let canonical = std::fs::canonicalize(&candidate).map_err(|_| "Failed to resolve file path".to_string())?;
    if !path_within_root(&root, &canonical) {
        return Err("File is outside task working folder".to_string());
    }

    let bytes = std::fs::read(&candidate).map_err(|error| error.to_string())?;
    let size = bytes.len() as u64;
    let truncated = bytes.len() > MAX_PREVIEW_BYTES;
    let preview_slice = if truncated {
        &bytes[..MAX_PREVIEW_BYTES]
    } else {
        bytes.as_slice()
    };

    let mime_type = detect_mime_type(&candidate).to_string();

    let (encoding, content) = if mime_type.starts_with("image/") {
        ("base64".to_string(), BASE64_STANDARD.encode(preview_slice))
    } else if is_probably_text(preview_slice) {
        (
            "utf8".to_string(),
            String::from_utf8(preview_slice.to_vec()).map_err(|_| "Invalid UTF-8 text".to_string())?,
        )
    } else {
        ("base64".to_string(), BASE64_STANDARD.encode(preview_slice))
    };

    Ok(PreviewReadResponse {
        path: relative
            .components()
            .filter_map(|component| match component {
                std::path::Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                _ => None,
            })
            .collect::<Vec<String>>()
            .join("/"),
        mime_type,
        encoding,
        content,
        truncated,
        size,
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

fn normalize_auth_profile_name(profile: Option<&str>) -> Result<String, String> {
    let candidate = profile
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(AUTH_PROFILE_DEFAULT);

    let is_safe = candidate
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-');

    if !is_safe || candidate.contains("..") {
        return Err("Invalid auth profile".to_string());
    }

    Ok(candidate.to_string())
}

fn auth_file(app: &tauri::AppHandle, profile: Option<&str>) -> Result<PathBuf, String> {
    let base_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let profile = normalize_auth_profile_name(profile)?;
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

fn is_valid_task_id(task_id: &str) -> bool {
    !task_id.is_empty() && !task_id.contains('/') && !task_id.contains('\\') && !task_id.contains("..")
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn vm_start(
    app: tauri::AppHandle,
    state: tauri::State<vm::VmState>,
    working_folder: Option<String>,
    task_id: Option<String>,
    auth_profile: Option<String>,
) -> Result<vm::VmStatusResponse, String> {
    let runtime_dir = runtime_dir(&app)?;
    let folder_path = if let Some(workspace_root) = resolve_workspace_root_from_env()? {
        Some(workspace_root)
    } else {
        working_folder.as_ref().map(std::path::PathBuf::from)
    };

    if let Some(task_id) = task_id.as_deref() {
        if !is_valid_task_id(task_id) {
            return Err("Invalid task id".to_string());
        }
    }

    let selected_auth_profile = normalize_auth_profile_name(auth_profile.as_deref())?;

    let auth_state_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("auth");
    std::fs::create_dir_all(auth_state_path.join(&selected_auth_profile)).map_err(|error| error.to_string())?;

    let task_state_path = tasks_dir(&app)?;
    std::fs::create_dir_all(&task_state_path).map_err(|error| error.to_string())?;

    vm::start(
        &app,
        &state,
        &runtime_dir,
        folder_path.as_deref(),
        Some(task_state_path.as_path()),
        Some(auth_state_path.as_path()),
        task_id.as_deref(),
        Some(selected_auth_profile.as_str()),
    )
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
fn task_store_delete_all(app: tauri::AppHandle) -> Result<(), String> {
    let tasks_dir = tasks_dir(&app)?;
    task_store::delete_all_tasks(&tasks_dir)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn task_store_save_conversation(
    app: tauri::AppHandle,
    task_id: String,
    conversation_json: String,
) -> Result<(), String> {
    let tasks_dir = tasks_dir(&app)?;
    task_store::save_conversation(&tasks_dir, &task_id, &conversation_json)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn task_store_load_conversation(app: tauri::AppHandle, task_id: String) -> Result<Option<String>, String> {
    let tasks_dir = tasks_dir(&app)?;
    task_store::load_conversation(&tasks_dir, &task_id)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn auth_store_list(app: tauri::AppHandle, profile: Option<String>) -> Result<auth_store::AuthStoreSummary, String> {
    let auth_path = auth_file(&app, profile.as_deref())?;
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
    let auth_path = auth_file(&app, profile.as_deref())?;
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
    let auth_path = auth_file(&app, profile.as_deref())?;
    auth_store::delete_provider(&auth_path, &provider)?;
    auth_store::summary(&auth_path)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
fn auth_store_import_pi(
    app: tauri::AppHandle,
    profile: Option<String>,
) -> Result<auth_store::AuthStoreSummary, String> {
    let auth_path = auth_file(&app, profile.as_deref())?;
    let source_path = pi_auth_file(&app)?;
    auth_store::import_from_path(&auth_path, &source_path)?;
    auth_store::summary(&auth_path)
}

#[cfg(debug_assertions)]
fn sanitize_test_server_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut sanitized = serde_json::Map::new();

            for (key, inner) in map {
                let lower = key.to_ascii_lowercase();
                let is_sensitive = lower.contains("key")
                    || lower.contains("token")
                    || lower.contains("password")
                    || lower.contains("secret");

                if is_sensitive {
                    sanitized.insert(key.clone(), serde_json::Value::String("<redacted>".to_string()));
                } else {
                    sanitized.insert(key.clone(), sanitize_test_server_value(inner));
                }
            }

            serde_json::Value::Object(sanitized)
        }
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.iter().map(sanitize_test_server_value).collect())
        }
        _ => value.clone(),
    }
}

/// Test server for automated testing (dev mode only)
/// Listens on port `19385` and accepts commands:
/// - `{"cmd":"prompt","message":"..."}` - triggers UI sendPrompt flow
/// - `{"cmd":"set_folder","folder":"/path"}` - changes working folder
/// - `{"cmd":"set_task","taskId":"..."}` - selects active task
/// - `{"cmd":"set_auth_profile","profile":"default"}` - switches auth profile and restarts runtime in UI
/// - `{"cmd":"send_login"}` - triggers UI /login flow
/// - `{"cmd":"auth_list","profile":"default"}` - returns auth store summary JSON
/// - `{"cmd":"auth_set_api_key","provider":"anthropic","key":"...","profile":"default"}` - writes API key to auth store
/// - `{"cmd":"auth_delete","provider":"anthropic","profile":"default"}` - deletes provider from auth store
/// - `{"cmd":"auth_import_pi","profile":"default"}` - imports ~/.pi/agent/auth.json into auth store
/// - `{"cmd":"create_task","title":"...","workingFolder":"/path"}` - creates task
/// - `{"cmd":"delete_all_tasks"}` - wipes all tasks
/// - `{"cmd":"dump_state"}` - logs UI state
/// - `{"cmd":"preview_list","taskId":"..."}` - returns preview file list JSON
/// - `{"cmd":"preview_read","taskId":"...","relativePath":"..."}` - returns preview file content JSON
/// - `{"cmd":"open_preview","taskId":"...","relativePath":"..."}` - opens preview pane in UI
/// - `{"cmd":"rpc",...}` - sends raw RPC to VM
#[cfg(debug_assertions)]
#[allow(clippy::too_many_lines)]
fn start_test_server(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:19385") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[test-server] failed to bind: {e}");
                return;
            }
        };
        eprintln!("[test-server] listening on 127.0.0.1:19385");

        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let app = app_handle.clone();

            std::thread::spawn(move || {
                let reader = BufReader::new(stream.try_clone().unwrap());
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    if line.is_empty() {
                        continue;
                    }

                    // Parse command
                    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&line);
                    let Ok(json) = parsed else {
                        let _ = stream.write_all(b"ERR: invalid JSON\n");
                        continue;
                    };

                    let sanitized = sanitize_test_server_value(&json);
                    eprintln!("[test-server] received: {sanitized}");

                    let cmd = json.get("cmd").and_then(|v| v.as_str()).unwrap_or("rpc");

                    match cmd {
                        "prompt" => {
                            // Emit event to frontend to trigger sendPrompt
                            let message = json.get("message").and_then(|v| v.as_str()).unwrap_or("");
                            eprintln!("[test-server] emitting test_prompt: {message}");
                            let _ = app.emit("test_prompt", message);
                            let _ = stream.write_all(b"OK\n");
                        }
                        "set_folder" => {
                            // Emit event to frontend to change working folder
                            let folder = json.get("folder").and_then(|v| v.as_str());
                            eprintln!("[test-server] emitting test_set_folder: {folder:?}");
                            let _ = app.emit("test_set_folder", folder);
                            let _ = stream.write_all(b"OK\n");
                        }
                        "set_task" => {
                            // Emit event to frontend to change active task
                            let task_id = json.get("taskId").and_then(|v| v.as_str());
                            eprintln!("[test-server] emitting test_set_task: {task_id:?}");
                            let _ = app.emit("test_set_task", task_id);
                            let _ = stream.write_all(b"OK\n");
                        }
                        "set_auth_profile" => {
                            // Emit event to frontend to switch auth profile + restart runtime
                            let profile = json.get("profile").and_then(|v| v.as_str());
                            eprintln!("[test-server] emitting test_set_auth_profile: {profile:?}");
                            let _ = app.emit("test_set_auth_profile", profile);
                            let _ = stream.write_all(b"OK\n");
                        }
                        "send_login" => {
                            // Emit event to frontend to trigger /login flow in UI
                            eprintln!("[test-server] emitting test_send_login");
                            let _ = app.emit("test_send_login", ());
                            let _ = stream.write_all(b"OK\n");
                        }
                        "auth_list" => {
                            let profile = json.get("profile").and_then(|v| v.as_str()).map(str::to_string);

                            match auth_store_list(app.clone(), profile) {
                                Ok(summary) => {
                                    let payload = serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string());
                                    let _ = stream.write_all(format!("{payload}\n").as_bytes());
                                }
                                Err(error) => {
                                    let _ = stream.write_all(format!("ERR: {error}\n").as_bytes());
                                }
                            }
                        }
                        "auth_set_api_key" => {
                            let provider = json.get("provider").and_then(|v| v.as_str()).unwrap_or("");
                            let key = json.get("key").and_then(|v| v.as_str()).unwrap_or("");
                            let profile = json.get("profile").and_then(|v| v.as_str()).map(str::to_string);

                            match auth_store_set_api_key(app.clone(), provider.to_string(), key.to_string(), profile) {
                                Ok(summary) => {
                                    let payload = serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string());
                                    let _ = stream.write_all(format!("{payload}\n").as_bytes());
                                }
                                Err(error) => {
                                    let _ = stream.write_all(format!("ERR: {error}\n").as_bytes());
                                }
                            }
                        }
                        "auth_delete" => {
                            let provider = json.get("provider").and_then(|v| v.as_str()).unwrap_or("");
                            let profile = json.get("profile").and_then(|v| v.as_str()).map(str::to_string);

                            match auth_store_delete(app.clone(), provider.to_string(), profile) {
                                Ok(summary) => {
                                    let payload = serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string());
                                    let _ = stream.write_all(format!("{payload}\n").as_bytes());
                                }
                                Err(error) => {
                                    let _ = stream.write_all(format!("ERR: {error}\n").as_bytes());
                                }
                            }
                        }
                        "auth_import_pi" => {
                            let profile = json.get("profile").and_then(|v| v.as_str()).map(str::to_string);

                            match auth_store_import_pi(app.clone(), profile) {
                                Ok(summary) => {
                                    let payload = serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string());
                                    let _ = stream.write_all(format!("{payload}\n").as_bytes());
                                }
                                Err(error) => {
                                    let _ = stream.write_all(format!("ERR: {error}\n").as_bytes());
                                }
                            }
                        }
                        "create_task" => {
                            // Emit event to frontend to create a new task
                            let title = json.get("title").and_then(|v| v.as_str());
                            let folder = json.get("workingFolder").and_then(|v| v.as_str());
                            eprintln!("[test-server] emitting test_create_task: {title:?}");
                            let payload = serde_json::json!({
                                "title": title,
                                "workingFolder": folder,
                            });
                            let _ = app.emit("test_create_task", payload);
                            let _ = stream.write_all(b"OK\n");
                        }
                        "delete_all_tasks" => {
                            // Emit event to frontend to wipe all tasks
                            eprintln!("[test-server] emitting test_delete_all_tasks");
                            let _ = app.emit("test_delete_all_tasks", ());
                            let _ = stream.write_all(b"OK\n");
                        }
                        "dump_state" => {
                            // Emit event to frontend to log current UI state
                            eprintln!("[test-server] emitting test_dump_state");
                            let _ = app.emit("test_dump_state", ());
                            let _ = stream.write_all(b"OK\n");
                        }
                        "preview_list" => {
                            let task_id = json.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
                            match task_preview_list(app.clone(), task_id.to_string()) {
                                Ok(result) => {
                                    let payload = serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string());
                                    let _ = stream.write_all(format!("{payload}\n").as_bytes());
                                }
                                Err(error) => {
                                    let _ = stream.write_all(format!("ERR: {error}\n").as_bytes());
                                }
                            }
                        }
                        "preview_read" => {
                            let task_id = json.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
                            let relative_path = json.get("relativePath").and_then(|v| v.as_str()).unwrap_or("");

                            match task_preview_read(app.clone(), task_id.to_string(), relative_path.to_string()) {
                                Ok(result) => {
                                    let payload = serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string());
                                    let _ = stream.write_all(format!("{payload}\n").as_bytes());
                                }
                                Err(error) => {
                                    let _ = stream.write_all(format!("ERR: {error}\n").as_bytes());
                                }
                            }
                        }
                        "open_preview" => {
                            let task_id = json.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
                            let relative_path = json.get("relativePath").and_then(|v| v.as_str()).unwrap_or("");

                            let payload = serde_json::json!({
                                "taskId": task_id,
                                "relativePath": relative_path,
                            });
                            let _ = app.emit("test_open_preview", payload);
                            let _ = stream.write_all(b"OK\n");
                        }
                        _ => {
                            // Direct RPC send (bypass UI)
                            let state: tauri::State<vm::VmState> = app.state();
                            match vm::send(&state, &line) {
                                Ok(()) => {
                                    let _ = stream.write_all(b"OK\n");
                                }
                                Err(e) => {
                                    let _ = stream.write_all(format!("ERR: {e}\n").as_bytes());
                                }
                            }
                        }
                    }
                }
            });
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(vm::VmState::default())
        .setup(|app| {
            #[cfg(debug_assertions)]
            start_test_server(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dev_log,
            runtime_status,
            runtime_workspace_root,
            runtime_validate_working_folder,
            task_store_list,
            task_store_upsert,
            task_store_delete,
            task_store_delete_all,
            task_store_save_conversation,
            task_store_load_conversation,
            task_preview_list,
            task_preview_read,
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

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::{normalize_auth_profile_name, sanitize_test_server_value};

    #[test]
    fn sanitize_redacts_sensitive_fields_recursively() {
        let payload = serde_json::json!({
            "cmd": "auth_set_api_key",
            "provider": "anthropic",
            "key": "secret-value",
            "nested": {
                "apiToken": "abc123",
                "list": [
                    { "password": "hunter2" },
                    { "safe": "value" }
                ]
            }
        });

        let sanitized = sanitize_test_server_value(&payload);

        assert_eq!(sanitized["provider"], "anthropic");
        assert_eq!(sanitized["key"], "<redacted>");
        assert_eq!(sanitized["nested"]["apiToken"], "<redacted>");
        assert_eq!(sanitized["nested"]["list"][0]["password"], "<redacted>");
        assert_eq!(sanitized["nested"]["list"][1]["safe"], "value");
    }

    #[test]
    fn sanitize_keeps_non_sensitive_structure() {
        let payload = serde_json::json!({
            "cmd": "preview_read",
            "taskId": "task-1",
            "relativePath": "src/main.ts"
        });

        let sanitized = sanitize_test_server_value(&payload);

        assert_eq!(sanitized, payload);
    }

    #[test]
    fn normalize_auth_profile_defaults_and_accepts_safe_values() {
        assert_eq!(normalize_auth_profile_name(None).unwrap(), "default");
        assert_eq!(normalize_auth_profile_name(Some("")).unwrap(), "default");
        assert_eq!(normalize_auth_profile_name(Some(" work ")).unwrap(), "work");
        assert_eq!(normalize_auth_profile_name(Some("work-1_2.3")).unwrap(), "work-1_2.3");
    }

    #[test]
    fn normalize_auth_profile_rejects_unsafe_values() {
        assert!(normalize_auth_profile_name(Some("../secret")).is_err());
        assert!(normalize_auth_profile_name(Some("work/profile")).is_err());
        assert!(normalize_auth_profile_name(Some("work\\profile")).is_err());
        assert!(normalize_auth_profile_name(Some("with space")).is_err());
    }
}
