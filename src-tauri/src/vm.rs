use serde::{Deserialize, Serialize};
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
    writer: Arc<Mutex<Option<std::os::unix::net::UnixStream>>>,
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
    let rpc_path = state
        .inner
        .lock()
        .unwrap()
        .as_ref()
        .map(|instance| instance.rpc_path.to_string_lossy().to_string());

    VmStatusResponse { status, rpc_path }
}

pub fn start(app: &AppHandle, state: &VmState, runtime_dir: &Path) -> Result<VmStatusResponse, String> {
    let mut inner = state.inner.lock().unwrap();
    if inner.is_some() {
        return Ok(status(state));
    }

    let manifest = load_manifest(runtime_dir)?;
    let rpc_path = prepare_rpc_socket(app)?;

    let child = spawn_qemu(&manifest, runtime_dir, &rpc_path)?;
    let writer: Arc<Mutex<Option<std::os::unix::net::UnixStream>>> = Arc::new(Mutex::new(None));

    let instance = VmInstance {
        child,
        rpc_path: rpc_path.clone(),
        writer: writer.clone(),
    };

    *state.status.lock().unwrap() = VmStatus::Starting;
    *inner = Some(instance);

    let app_handle = app.clone();
    thread::spawn(move || match connect_rpc(&rpc_path) {
        Ok(stream) => {
            if let Ok(clone) = stream.try_clone() {
                *writer.lock().unwrap() = Some(clone);
            }
            read_rpc_lines(&app_handle, stream);
        }
        Err(error) => {
            emit_event(&app_handle, "error", format!("RPC connection failed: {error}"));
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

fn prepare_rpc_socket(app: &AppHandle) -> Result<PathBuf, String> {
    let vm_dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("vm");
    std::fs::create_dir_all(&vm_dir).map_err(|error| error.to_string())?;

    let rpc_path = vm_dir.join("piwork-rpc.sock");
    if rpc_path.exists() {
        std::fs::remove_file(&rpc_path).map_err(|error| error.to_string())?;
    }

    Ok(rpc_path)
}

fn spawn_qemu(manifest: &RuntimeManifest, runtime_dir: &Path, rpc_path: &Path) -> Result<Child, String> {
    let qemu_binary = manifest
        .qemu
        .as_ref()
        .map_or_else(|| PathBuf::from("qemu-system-aarch64"), |path| runtime_dir.join(path));

    let kernel = runtime_dir.join(&manifest.kernel);
    let initrd = runtime_dir.join(&manifest.initrd);
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
        .arg(format!("socket,id=rpc,path={},server=on,wait=off", rpc_path.display()))
        .arg("-device")
        .arg("virtio-serial")
        .arg("-device")
        .arg(format!("virtserialport,chardev=rpc,name={RPC_PORT_NAME}"))
        .arg("-serial")
        .arg("null")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command.spawn().map_err(|error| error.to_string())
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
