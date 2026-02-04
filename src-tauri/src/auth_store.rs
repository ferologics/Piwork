use serde::Serialize;
use serde_json::{Map, Value};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStoreEntry {
    pub provider: String,
    pub entry_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStoreSummary {
    pub path: String,
    pub entries: Vec<AuthStoreEntry>,
}

pub fn summary(path: &Path) -> Result<AuthStoreSummary, String> {
    let map = read_map(path)?;
    let mut entries: Vec<AuthStoreEntry> = map
        .into_iter()
        .map(|(provider, value)| AuthStoreEntry {
            provider,
            entry_type: entry_type(&value),
        })
        .collect();

    entries.sort_by(|a, b| a.provider.cmp(&b.provider));

    Ok(AuthStoreSummary {
        path: path.to_string_lossy().to_string(),
        entries,
    })
}

pub fn set_api_key(path: &Path, provider: &str, key: &str) -> Result<(), String> {
    if provider.trim().is_empty() {
        return Err("Provider is required".to_string());
    }

    if key.trim().is_empty() {
        return Err("API key is required".to_string());
    }

    let mut map = read_map(path)?;
    map.insert(provider.to_string(), serde_json::json!({"type": "api_key", "key": key}));

    write_map(path, map)
}

pub fn delete_provider(path: &Path, provider: &str) -> Result<(), String> {
    let mut map = read_map(path)?;
    map.remove(provider);

    write_map(path, map)
}

fn read_map(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }

    let content = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_str(&content).map_err(|error| error.to_string())?;

    match value {
        Value::Object(map) => Ok(map),
        _ => Err("auth.json must be a JSON object".to_string()),
    }
}

fn write_map(path: &Path, map: Map<String, Value>) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Invalid auth path".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    if map.is_empty() {
        if path.exists() {
            std::fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    let content = serde_json::to_string_pretty(&Value::Object(map)).map_err(|error| error.to_string())?;
    std::fs::write(path, content).map_err(|error| error.to_string())?;

    set_permissions(path);

    Ok(())
}

fn entry_type(value: &Value) -> String {
    value
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown")
        .to_string()
}

fn set_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o600);
        let _ = std::fs::set_permissions(path, permissions);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_path() -> PathBuf {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("piwork-auth-store-{suffix}-{counter}"));
        dir.join("auth.json")
    }

    #[test]
    fn set_and_list_entries() {
        let path = temp_path();

        set_api_key(&path, "anthropic", "test-key").expect("set");
        let summary = summary(&path).expect("summary");

        assert_eq!(summary.entries.len(), 1);
        assert_eq!(summary.entries[0].provider, "anthropic");
        assert_eq!(summary.entries[0].entry_type, "api_key");

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn delete_entry_removes_file() {
        let path = temp_path();

        set_api_key(&path, "openai", "test-key").expect("set");
        delete_provider(&path, "openai").expect("delete");

        let summary = summary(&path).expect("summary");
        assert!(summary.entries.is_empty());
        assert!(!path.exists());

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }
}
