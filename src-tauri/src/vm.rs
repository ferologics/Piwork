use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

const RPC_PORT_NAME: &str = "piwork.rpc";

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
    pub rpc_path: Option<String>,
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
    rpc_path: PathBuf,
    log_path: PathBuf,
    writer: Arc<Mutex<Option<std::os::unix::net::UnixStream>>>,
}

struct VmPaths {
    rpc_path: PathBuf,
    log_path: PathBuf,
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
    }
}

pub fn status(state: &VmState) -> VmStatusResponse {
    let status = state.status.lock().unwrap().clone();
    let inner = state.inner.lock().unwrap();
    let (rpc_path, log_path) = inner.as_ref().map_or((None, None), |instance| {
        (
            Some(instance.rpc_path.to_string_lossy().to_string()),
            Some(instance.log_path.to_string_lossy().to_string()),
        )
    });

    VmStatusResponse {
        status,
        rpc_path,
        log_path,
    }
}

pub fn start(app: &AppHandle, state: &VmState, runtime_dir: &Path) -> Result<VmStatusResponse, String> {
    let mut inner = state.inner.lock().unwrap();
    if inner.is_some() {
        return Ok(status(state));
    }

    let manifest = load_manifest(runtime_dir)?;
    let paths = prepare_vm_paths(app)?;

    let child = spawn_qemu(&manifest, runtime_dir, &paths)?;
    let writer: Arc<Mutex<Option<std::os::unix::net::UnixStream>>> = Arc::new(Mutex::new(None));

    let instance = VmInstance {
        child,
        rpc_path: paths.rpc_path.clone(),
        log_path: paths.log_path.clone(),
        writer: writer.clone(),
    };

    *state.status.lock().unwrap() = VmStatus::Starting;
    *inner = Some(instance);

    let app_handle = app.clone();
    let rpc_path = paths.rpc_path.clone();
    let log_path = paths.log_path.clone();
    thread::spawn(move || match connect_rpc(&rpc_path) {
        Ok(stream) => {
            if let Ok(clone) = stream.try_clone() {
                *writer.lock().unwrap() = Some(clone);
            }
            read_rpc_lines(&app_handle, stream);
        }
        Err(error) => {
            emit_event(
                &app_handle,
                "error",
                format!(
                    "RPC connection failed: {error}. Check QEMU log at {}",
                    log_path.display()
                ),
            );
            mark_stopped(&app_handle);
        }
    });

    Ok(status(state))
}

pub fn stop(state: &VmState) {
    let mut inner = state.inner.lock().unwrap();
    if let Some(mut instance) = inner.take() {
        instance.child.kill().ok();
    }

    *state.status.lock().unwrap() = VmStatus::Stopped;
}

pub fn send(state: &VmState, message: &str) -> Result<(), String> {
    let inner = state.inner.lock().unwrap();
    let Some(instance) = inner.as_ref() else {
        return Err("VM not running".to_string());
    };

    let mut guard = instance.writer.lock().unwrap();
    let Some(stream) = guard.as_mut() else {
        return Err("RPC not connected".to_string());
    };

    stream
        .write_all(format!("{message}\n").as_bytes())
        .map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())?;

    Ok(())
}

fn load_manifest(runtime_dir: &Path) -> Result<RuntimeManifest, String> {
    let manifest_path = runtime_dir.join("manifest.json");
    let content = std::fs::read_to_string(&manifest_path).map_err(|error| error.to_string())?;
    let manifest: RuntimeManifest = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(manifest)
}

fn prepare_vm_paths(app: &AppHandle) -> Result<VmPaths, String> {
    let vm_dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("vm");
    std::fs::create_dir_all(&vm_dir).map_err(|error| error.to_string())?;

    let rpc_path = vm_dir.join("piwork-rpc.sock");
    if rpc_path.exists() {
        std::fs::remove_file(&rpc_path).map_err(|error| error.to_string())?;
    }

    Ok(VmPaths {
        rpc_path,
        log_path: vm_dir.join("qemu.log"),
    })
}

fn spawn_qemu(manifest: &RuntimeManifest, runtime_dir: &Path, paths: &VmPaths) -> Result<Child, String> {
    let qemu_binary = resolve_qemu_binary(manifest, runtime_dir)?;

    let kernel = runtime_dir.join(&manifest.kernel);
    if !kernel.is_file() {
        return Err(format!("Kernel not found: {}", kernel.display()));
    }

    let initrd = runtime_dir.join(&manifest.initrd);
    if !initrd.is_file() {
        return Err(format!("Initrd not found: {}", initrd.display()));
    }

    let cmdline = manifest
        .cmdline
        .as_deref()
        .unwrap_or("modules=loop,squashfs,sd-mod,usb-storage quiet console=ttyAMA0");

    let mut command = Command::new(qemu_binary);
    command
        .arg("-machine")
        .arg("virt,accel=hvf")
        .arg("-cpu")
        .arg("host")
        .arg("-smp")
        .arg("2")
        .arg("-m")
        .arg("1024")
        .arg("-nographic")
        .arg("-kernel")
        .arg(kernel)
        .arg("-initrd")
        .arg(initrd)
        .arg("-append")
        .arg(cmdline)
        .arg("-device")
        .arg("virtio-net-pci,netdev=net0,mac=52:54:00:12:34:56")
        .arg("-netdev")
        .arg("user,id=net0")
        .arg("-chardev")
        .arg(format!(
            "socket,id=rpc,path={},server=on,wait=off",
            paths.rpc_path.display()
        ))
        .arg("-device")
        .arg("virtio-serial")
        .arg("-device")
        .arg(format!("virtserialport,chardev=rpc,name={RPC_PORT_NAME}"))
        .arg("-serial")
        .arg("null")
        .stdout(Stdio::null());

    let log_file = File::create(&paths.log_path).map_err(|error| format!("Failed to create QEMU log: {error}"))?;
    command.stderr(Stdio::from(log_file));

    command.spawn().map_err(|error| error.to_string())
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

fn connect_rpc(rpc_path: &Path) -> Result<std::os::unix::net::UnixStream, String> {
    let mut attempts = 0;
    loop {
        match std::os::unix::net::UnixStream::connect(rpc_path) {
            Ok(stream) => return Ok(stream),
            Err(error) => {
                attempts += 1;
                if attempts > 100 {
                    return Err(error.to_string());
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn read_rpc_lines(app: &AppHandle, stream: std::os::unix::net::UnixStream) {
    let reader = BufReader::new(stream);
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed == "READY" {
            set_status(app, VmStatus::Ready);
            emit_event(app, "ready", trimmed.to_string());
        } else if !trimmed.is_empty() {
            emit_event(app, "rpc", trimmed.to_string());
        }
    }

    mark_stopped(app);
}
