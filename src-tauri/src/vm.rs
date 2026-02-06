use serde::{Deserialize, Serialize};
use std::fmt::Write as _;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

const RPC_PORT: u16 = 19384;
const READY_MARKER_TIMEOUT_SECS: u64 = 45;
const RPC_CONNECT_TIMEOUT_SECS: u64 = 45;

#[derive(Default)]
pub struct VmState {
    inner: Mutex<Option<VmInstance>>,
    status: Mutex<VmStatus>,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VmStatus {
    Starting,
    Ready,
    #[default]
    Stopped,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VmStatusResponse {
    pub status: VmStatus,
    pub rpc_port: Option<u16>,
    pub log_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub kernel: String,
    pub initrd: String,
    pub cmdline: Option<String>,
    pub qemu: Option<String>,
}

struct VmInstance {
    child: Child,
    log_path: PathBuf,
    rpc_writer: Arc<Mutex<Option<TcpStream>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VmEvent {
    event: String,
    message: String,
}

fn emit_event(app: &AppHandle, event: &str, message: String) {
    let _ = app.emit(
        "vm_event",
        VmEvent {
            event: event.to_string(),
            message,
        },
    );
}

fn set_status(app: &AppHandle, status: VmStatus) {
    let state: tauri::State<VmState> = app.state();
    *state.status.lock().unwrap() = status;
}

fn mark_stopped(app: &AppHandle) {
    let state: tauri::State<VmState> = app.state();
    let instance = {
        let mut inner = state.inner.lock().unwrap();
        inner.take()
    };

    *state.status.lock().unwrap() = VmStatus::Stopped;

    if let Some(mut instance) = instance {
        instance.child.kill().ok();
        let _ = instance.child.wait();
    }
}

pub fn status(state: &VmState) -> VmStatusResponse {
    let status = state.status.lock().unwrap().clone();
    let inner = state.inner.lock().unwrap();
    let log_path = inner
        .as_ref()
        .map(|instance| instance.log_path.to_string_lossy().to_string());

    VmStatusResponse {
        status,
        rpc_port: Some(RPC_PORT),
        log_path,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn start(
    app: &AppHandle,
    state: &VmState,
    runtime_dir: &Path,
    working_folder: Option<&Path>,
    task_state_dir: Option<&Path>,
    auth_state_dir: Option<&Path>,
    initial_task_id: Option<&str>,
    auth_profile: Option<&str>,
) -> Result<VmStatusResponse, String> {
    eprintln!("[rust:vm] start called");
    let mut inner = state.inner.lock().unwrap();
    if inner.is_some() {
        eprintln!("[rust:vm] already running");
        // Build response inline to avoid deadlock (we already hold inner lock)
        let status = state.status.lock().unwrap().clone();
        let log_path = inner
            .as_ref()
            .map(|instance| instance.log_path.to_string_lossy().to_string());
        return Ok(VmStatusResponse {
            status,
            rpc_port: Some(RPC_PORT),
            log_path,
        });
    }

    eprintln!("[rust:vm] loading manifest");
    let manifest = load_manifest(runtime_dir)?;

    let vm_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("vm");
    std::fs::create_dir_all(&vm_dir).map_err(|e| e.to_string())?;
    let log_path = vm_dir.join("qemu.log");

    eprintln!("[rust:vm] spawning qemu");
    let child = spawn_qemu(
        &manifest,
        runtime_dir,
        &log_path,
        working_folder,
        task_state_dir,
        auth_state_dir,
        initial_task_id,
        auth_profile,
    )?;
    eprintln!("[rust:vm] qemu spawned");

    let rpc_writer: Arc<Mutex<Option<TcpStream>>> = Arc::new(Mutex::new(None));

    let instance = VmInstance {
        child,
        log_path: log_path.clone(),
        rpc_writer: rpc_writer.clone(),
    };

    *state.status.lock().unwrap() = VmStatus::Starting;
    *inner = Some(instance);
    drop(inner); // Release lock before spawning thread

    // Thread to wait for READY and then connect RPC
    let app_handle = app.clone();
    thread::spawn(move || {
        let ready_timeout = timeout_from_env("PIWORK_VM_READY_TIMEOUT_SECS", READY_MARKER_TIMEOUT_SECS);
        let connect_timeout = timeout_from_env("PIWORK_VM_RPC_CONNECT_TIMEOUT_SECS", RPC_CONNECT_TIMEOUT_SECS);

        eprintln!("[rust:vm:rpc] waiting for READY signal...");

        // Wait for VM to boot by polling the log file for READY.
        // If READY is not observed in time, still attempt direct RPC connect as fallback.
        let ready = wait_for_ready(&log_path, ready_timeout);
        if ready {
            eprintln!("[rust:vm:rpc] READY received");
        } else {
            eprintln!(
                "[rust:vm:rpc] READY marker not observed within {ready_timeout:?}; attempting TCP connect anyway"
            );
        }

        // Connect to RPC port first, then emit ready once writable RPC is available.
        match connect_rpc(RPC_PORT, connect_timeout) {
            Ok(stream) => {
                eprintln!("[rust:vm:rpc] connected to TCP port {RPC_PORT}");
                if let Ok(clone) = stream.try_clone() {
                    *rpc_writer.lock().unwrap() = Some(clone);
                }

                set_status(&app_handle, VmStatus::Ready);
                emit_event(&app_handle, "ready", "READY".to_string());

                read_rpc_lines(&app_handle, stream);
            }
            Err(error) => {
                eprintln!("[rust:vm:rpc] TCP connection failed: {error}");
                let qemu_tail = read_log_tail(&log_path, 4_096);
                if !qemu_tail.is_empty() {
                    eprintln!("[rust:vm:rpc] qemu log tail:\n{qemu_tail}");
                }
                emit_event(&app_handle, "error", format!("RPC connection failed: {error}"));
            }
        }

        mark_stopped(&app_handle);
    });

    Ok(status(state))
}

pub fn stop(state: &VmState) {
    let mut inner = state.inner.lock().unwrap();
    if let Some(mut instance) = inner.take() {
        instance.child.kill().ok();
        let _ = instance.child.wait();
    }

    *state.status.lock().unwrap() = VmStatus::Stopped;
}

pub fn send(state: &VmState, message: &str) -> Result<(), String> {
    let inner = state.inner.lock().unwrap();
    let Some(instance) = inner.as_ref() else {
        return Err("VM not running".to_string());
    };

    let mut guard = instance.rpc_writer.lock().unwrap();
    let Some(stream) = guard.as_mut() else {
        return Err("RPC not connected".to_string());
    };

    stream
        .write_all(format!("{message}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;

    Ok(())
}

fn load_manifest(runtime_dir: &Path) -> Result<RuntimeManifest, String> {
    let manifest_path = runtime_dir.join("manifest.json");
    let content = std::fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let manifest: RuntimeManifest = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(manifest)
}

fn attach_9p_mount(command: &mut Command, id: &str, mount_tag: &str, path: &Path, label: &str) {
    if !path.is_dir() {
        eprintln!("[rust:vm] {label} not found: {}", path.display());
        return;
    }

    eprintln!("[rust:vm] mounting {label}: {}", path.display());
    command
        .arg("-fsdev")
        .arg(format!("local,id={id},path={},security_model=none", path.display()))
        .arg("-device")
        .arg(format!("virtio-9p-pci,fsdev={id},mount_tag={mount_tag}"));
}

#[allow(clippy::too_many_arguments)]
fn spawn_qemu(
    manifest: &RuntimeManifest,
    runtime_dir: &Path,
    log_path: &Path,
    working_folder: Option<&Path>,
    task_state_dir: Option<&Path>,
    auth_state_dir: Option<&Path>,
    initial_task_id: Option<&str>,
    auth_profile: Option<&str>,
) -> Result<Child, String> {
    let qemu_binary = resolve_qemu_binary(manifest, runtime_dir)?;

    let kernel = runtime_dir.join(&manifest.kernel);
    if !kernel.is_file() {
        return Err(format!("Kernel not found: {}", kernel.display()));
    }

    let initrd = runtime_dir.join(&manifest.initrd);
    if !initrd.is_file() {
        return Err(format!("Initrd not found: {}", initrd.display()));
    }

    let base_cmdline = manifest.cmdline.as_deref().unwrap_or("quiet console=ttyAMA0");
    let mut cmdline = base_cmdline.to_string();

    if let Some(task_id) = initial_task_id {
        let _ = write!(&mut cmdline, " piwork.task_id={task_id}");
    }

    if let Some(profile) = auth_profile {
        let _ = write!(&mut cmdline, " piwork.auth_profile={profile}");
    }

    // Open log file for serial output
    let log_file = std::fs::File::create(log_path).map_err(|e| e.to_string())?;
    let log_out = log_file.try_clone().map_err(|e| e.to_string())?;
    let log_err = log_file.try_clone().map_err(|e| e.to_string())?;

    let mut command = Command::new(qemu_binary);
    command
        .arg("-machine")
        .arg("virt,accel=hvf")
        .arg("-cpu")
        .arg("host")
        .arg("-smp")
        .arg("2")
        .arg("-m")
        .arg("2048")
        .arg("-nographic")
        .arg("-kernel")
        .arg(&kernel)
        .arg("-initrd")
        .arg(&initrd)
        .arg("-append")
        .arg(cmdline)
        // Network with port forwarding for RPC
        .arg("-device")
        .arg("virtio-net-pci,netdev=net0,mac=52:54:00:12:34:56")
        .arg("-netdev")
        .arg(format!("user,id=net0,hostfwd=tcp:127.0.0.1:{RPC_PORT}-:{RPC_PORT}"));

    // Working folder mount via virtio-9p
    if let Some(folder) = working_folder {
        attach_9p_mount(&mut command, "workdir", "workdir", folder, "working folder");
    }

    // Task state mount via virtio-9p
    if let Some(task_state) = task_state_dir {
        attach_9p_mount(&mut command, "taskstate", "taskstate", task_state, "task state dir");
    }

    // Auth state mount via virtio-9p
    if let Some(auth_state) = auth_state_dir {
        attach_9p_mount(&mut command, "authstate", "authstate", auth_state, "auth state dir");
    }

    command
        // Serial console to file (we read this for READY)
        .arg("-serial")
        .arg(format!("file:{}", log_path.display()))
        .stdout(Stdio::from(log_out))
        .stderr(Stdio::from(log_err));

    command.spawn().map_err(|e| e.to_string())
}

fn resolve_qemu_binary(manifest: &RuntimeManifest, runtime_dir: &Path) -> Result<PathBuf, String> {
    if let Some(qemu) = &manifest.qemu {
        let candidate = runtime_dir.join(qemu);
        if candidate.is_file() {
            return Ok(candidate);
        }
        return Err(format!("QEMU binary not found at {}", candidate.display()));
    }

    find_in_path("qemu-system-aarch64").ok_or_else(|| "QEMU not found in PATH".to_string())
}

pub fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    for entry in path_var.split(':') {
        let candidate = PathBuf::from(entry).join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn timeout_from_env(name: &str, fallback_secs: u64) -> Duration {
    let parsed = std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback_secs);

    Duration::from_secs(parsed)
}

fn read_log_tail(log_path: &Path, max_bytes: usize) -> String {
    let Ok(content) = std::fs::read(log_path) else {
        return String::new();
    };

    let start = content.len().saturating_sub(max_bytes);
    String::from_utf8_lossy(&content[start..]).to_string()
}

fn wait_for_ready(log_path: &Path, timeout: Duration) -> bool {
    let start = std::time::Instant::now();

    while start.elapsed() < timeout {
        if let Ok(content) = std::fs::read_to_string(log_path) {
            if content.contains("READY") {
                return true;
            }
        }
        thread::sleep(Duration::from_millis(100));
    }

    false
}

fn connect_rpc(port: u16, timeout: Duration) -> Result<TcpStream, String> {
    let addr = format!("127.0.0.1:{port}");
    let start = std::time::Instant::now();
    let mut last_error = String::from("connection timeout");

    while start.elapsed() < timeout {
        match TcpStream::connect(&addr) {
            Ok(stream) => return Ok(stream),
            Err(error) => {
                last_error = error.to_string();
                thread::sleep(Duration::from_millis(100));
            }
        }
    }

    Err(last_error)
}

fn read_rpc_lines(app: &AppHandle, stream: TcpStream) {
    eprintln!("[rust:vm:rpc] starting to read RPC lines");
    let reader = BufReader::new(stream);

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            eprintln!("[rust:vm:rpc] received: {trimmed:?}");
            emit_event(app, "rpc", trimmed.to_string());
        }
    }

    eprintln!("[rust:vm:rpc] RPC connection closed");
}
