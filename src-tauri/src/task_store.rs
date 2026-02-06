use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskMount {
    pub path: String,
    pub mode: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskMetadata {
    pub id: String,
    pub title: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub session_file: Option<String>,
    pub working_folder: Option<String>,
    pub mounts: Option<Vec<TaskMount>>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub connectors_enabled: Option<Vec<String>>,
}

pub const TASK_OUTPUTS_DIR: &str = "outputs";
pub const TASK_UPLOADS_DIR: &str = "uploads";

pub fn task_dir(tasks_dir: &Path, task_id: &str) -> PathBuf {
    tasks_dir.join(task_id)
}

pub fn task_outputs_dir(tasks_dir: &Path, task_id: &str) -> PathBuf {
    task_dir(tasks_dir, task_id).join(TASK_OUTPUTS_DIR)
}

pub fn task_uploads_dir(tasks_dir: &Path, task_id: &str) -> PathBuf {
    task_dir(tasks_dir, task_id).join(TASK_UPLOADS_DIR)
}

pub fn ensure_task_artifact_dirs(tasks_dir: &Path, task_id: &str) -> Result<(), String> {
    std::fs::create_dir_all(task_outputs_dir(tasks_dir, task_id)).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(task_uploads_dir(tasks_dir, task_id)).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn load_task(tasks_dir: &Path, task_id: &str) -> Result<Option<TaskMetadata>, String> {
    std::fs::create_dir_all(tasks_dir).map_err(|error| error.to_string())?;

    let task_path = tasks_dir.join(task_id).join("task.json");
    if !task_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&task_path).map_err(|error| error.to_string())?;
    let task: TaskMetadata = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    Ok(Some(task))
}

pub fn list_tasks(tasks_dir: &Path) -> Result<Vec<TaskMetadata>, String> {
    std::fs::create_dir_all(tasks_dir).map_err(|error| error.to_string())?;

    let mut tasks = Vec::new();

    for entry in std::fs::read_dir(tasks_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(task_id) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if let Some(task) = load_task(tasks_dir, task_id)? {
            tasks.push(task);
        }
    }

    tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(tasks)
}

pub fn upsert_task(tasks_dir: &Path, task: &TaskMetadata) -> Result<(), String> {
    std::fs::create_dir_all(tasks_dir).map_err(|error| error.to_string())?;

    let existing = load_task(tasks_dir, &task.id)?;
    if let Some(existing_task) = existing {
        if let Some(existing_folder) = existing_task.working_folder.as_deref() {
            if task.working_folder.as_deref() != Some(existing_folder) {
                return Err(
                    "workingFolder is immutable once set; create a new task to use a different folder".to_string(),
                );
            }
        }
    }

    let task_folder = task_dir(tasks_dir, &task.id);
    std::fs::create_dir_all(&task_folder).map_err(|error| error.to_string())?;
    ensure_task_artifact_dirs(tasks_dir, &task.id)?;

    let task_path = task_folder.join("task.json");
    let content = serde_json::to_string_pretty(task).map_err(|error| error.to_string())?;
    std::fs::write(&task_path, content).map_err(|error| error.to_string())?;

    Ok(())
}

pub fn delete_task(tasks_dir: &Path, task_id: String) -> Result<(), String> {
    let task_folder = tasks_dir.join(task_id);

    if task_folder.exists() {
        std::fs::remove_dir_all(task_folder).map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub fn delete_all_tasks(tasks_dir: &Path) -> Result<(), String> {
    if !tasks_dir.exists() {
        return Ok(());
    }

    for entry in std::fs::read_dir(tasks_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
        } else {
            std::fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

pub fn save_conversation(tasks_dir: &Path, task_id: &str, conversation_json: &str) -> Result<(), String> {
    let task_folder = tasks_dir.join(task_id);
    if !task_folder.exists() {
        return Err(format!("Task folder does not exist: {task_id}"));
    }

    let conv_path = task_folder.join("conversation.json");
    std::fs::write(&conv_path, conversation_json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_conversation(tasks_dir: &Path, task_id: &str) -> Result<Option<String>, String> {
    let task_folder = tasks_dir.join(task_id);
    let conv_path = task_folder.join("conversation.json");

    if !conv_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&conv_path).map_err(|e| e.to_string())?;
    Ok(Some(content))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_dir() -> PathBuf {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("piwork-task-store-{suffix}-{counter}"))
    }

    fn sample_task(id: &str, updated_at: &str) -> TaskMetadata {
        TaskMetadata {
            id: id.to_string(),
            title: "Test".to_string(),
            status: "idle".to_string(),
            created_at: "2026-02-04T00:00:00Z".to_string(),
            updated_at: updated_at.to_string(),
            session_file: None,
            working_folder: None,
            mounts: None,
            provider: None,
            model: None,
            thinking_level: None,
            connectors_enabled: None,
        }
    }

    fn sample_task_with_folder(id: &str, updated_at: &str, working_folder: Option<&str>) -> TaskMetadata {
        TaskMetadata {
            working_folder: working_folder.map(str::to_string),
            ..sample_task(id, updated_at)
        }
    }

    #[test]
    fn upsert_and_list() {
        let dir = temp_dir();
        let task = sample_task("task-1", "2026-02-04T00:00:01Z");

        upsert_task(&dir, &task).expect("upsert");
        let tasks = list_tasks(&dir).expect("list");

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "task-1");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn upsert_creates_artifact_dirs() {
        let dir = temp_dir();
        let task = sample_task("task-1", "2026-02-04T00:00:01Z");

        upsert_task(&dir, &task).expect("upsert");

        assert!(task_outputs_dir(&dir, &task.id).is_dir());
        assert!(task_uploads_dir(&dir, &task.id).is_dir());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn upsert_allows_first_working_folder_bind() {
        let dir = temp_dir();
        let initial = sample_task("task-1", "2026-02-04T00:00:01Z");
        let bound = sample_task_with_folder("task-1", "2026-02-04T00:00:02Z", Some("/tmp/work"));

        upsert_task(&dir, &initial).expect("upsert initial");
        upsert_task(&dir, &bound).expect("upsert bound");

        let loaded = load_task(&dir, "task-1").expect("load").expect("task exists");
        assert_eq!(loaded.working_folder.as_deref(), Some("/tmp/work"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn upsert_rejects_working_folder_change_after_bind() {
        let dir = temp_dir();
        let initial = sample_task_with_folder("task-1", "2026-02-04T00:00:01Z", Some("/tmp/work-a"));
        let changed = sample_task_with_folder("task-1", "2026-02-04T00:00:02Z", Some("/tmp/work-b"));

        upsert_task(&dir, &initial).expect("upsert initial");
        let error = upsert_task(&dir, &changed).expect_err("folder rebind should fail");

        assert!(error.contains("workingFolder is immutable"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn upsert_rejects_working_folder_clear_after_bind() {
        let dir = temp_dir();
        let initial = sample_task_with_folder("task-1", "2026-02-04T00:00:01Z", Some("/tmp/work-a"));
        let cleared = sample_task("task-1", "2026-02-04T00:00:02Z");

        upsert_task(&dir, &initial).expect("upsert initial");
        let error = upsert_task(&dir, &cleared).expect_err("folder clear should fail");

        assert!(error.contains("workingFolder is immutable"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_sorts_by_updated_at() {
        let dir = temp_dir();
        let older = sample_task("task-old", "2026-02-04T00:00:01Z");
        let newer = sample_task("task-new", "2026-02-04T00:00:02Z");

        upsert_task(&dir, &older).expect("upsert older");
        upsert_task(&dir, &newer).expect("upsert newer");

        let tasks = list_tasks(&dir).expect("list");
        assert_eq!(tasks[0].id, "task-new");
        assert_eq!(tasks[1].id, "task-old");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn delete_task_removes_dir() {
        let dir = temp_dir();
        let task = sample_task("task-1", "2026-02-04T00:00:01Z");

        upsert_task(&dir, &task).expect("upsert");
        delete_task(&dir, "task-1".to_string()).expect("delete");

        let tasks = list_tasks(&dir).expect("list");
        assert!(tasks.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn delete_all_tasks_removes_dirs() {
        let dir = temp_dir();
        let task_one = sample_task("task-1", "2026-02-04T00:00:01Z");
        let task_two = sample_task("task-2", "2026-02-04T00:00:02Z");

        upsert_task(&dir, &task_one).expect("upsert one");
        upsert_task(&dir, &task_two).expect("upsert two");
        delete_all_tasks(&dir).expect("delete all");

        let tasks = list_tasks(&dir).expect("list");
        assert!(tasks.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }
}
