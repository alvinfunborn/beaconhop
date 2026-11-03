//! Codex exposes persisted threads, not a public enumeration of GUI tabs.
use crate::model::{ContentRef, Destination};
use serde_json::{json, Value};
use std::{
    io::{BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

fn executable() -> Option<PathBuf> {
    std::env::var_os("BEACONHOP_CODEX_BIN")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(|| {
            [
                "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
                "/Applications/Codex.app/Contents/Resources/codex",
            ]
            .into_iter()
            .map(PathBuf::from)
            .find(|p| p.is_file())
        })
}
pub fn available() -> bool {
    cfg!(target_os = "macos") && executable().is_some()
}
struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn threads(home: &str) -> Result<Vec<Value>, String> {
    threads_with_command(
        Command::new(executable().ok_or("Codex app-server is not installed")?),
        home,
        Duration::from_secs(8),
    )
}
fn threads_with_command(
    mut command: Command,
    home: &str,
    timeout: Duration,
) -> Result<Vec<Value>, String> {
    command
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if !home.is_empty() {
        command.env("CODEX_HOME", home);
    }
    let mut child = Server(command.spawn().map_err(|e| e.to_string())?);
    let mut stdin = child.0.stdin.take().unwrap();
    let stdout = child.0.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        // app-server may emit notifications. Bound each frame and ignore unrelated IDs.
        while let Ok(value) = crate::plugins::read_line(&mut reader) {
            if tx.send(value).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + timeout;
    let receive = |id: u32| -> Result<Value, String> {
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or("Codex session listing timed out")?;
            let reply = rx
                .recv_timeout(remaining)
                .map_err(|error| match error {
                    mpsc::RecvTimeoutError::Timeout => "Codex session listing timed out. Retry or check the Codex data folder.",
                    mpsc::RecvTimeoutError::Disconnected => "Codex app-server closed before returning local sessions. Check the installed Codex version and data folder.",
                })?;
            if reply["id"] == id {
                if reply.get("error").is_some() {
                    return Err(
                        "Codex could not list local sessions. Check the selected CODEX_HOME."
                            .into(),
                    );
                }
                return Ok(reply["result"].clone());
            }
        }
    };
    writeln!(stdin,"{}",json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"beaconhop","version":"0.1.0"},"capabilities":{"experimentalApi":false}}})).map_err(|e| e.to_string())?;
    receive(1)?;
    writeln!(stdin, "{}", json!({"method":"initialized"})).map_err(|e| e.to_string())?;
    // The default list repairs metadata by scanning historical rollout files.
    // A switcher needs the existing index, including desktop app-server threads
    // and sessions from other configured providers, without that unbounded scan.
    writeln!(
        stdin,
        "{}",
        json!({"id":2,"method":"thread/list","params":{
            "limit":100,"sortKey":"updated_at","archived":false,
            "useStateDbOnly":true,"sourceKinds":["cli","vscode","appServer"],"modelProviders":[]
        }})
    )
    .map_err(|e| e.to_string())?;
    let result = receive(2)?;
    Ok(result["data"]
        .as_array()
        .ok_or("Invalid Codex thread list")?
        .clone())
}
pub fn list(parent: &Destination, home: &str) -> Result<Vec<Destination>, String> {
    threads(home)?
        .into_iter()
        .filter_map(|thread| {
            let id = thread["id"].as_str()?.to_owned();
            if uuid::Uuid::parse_str(&id).is_err() {
                return None;
            }
            let title = thread["name"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| thread["preview"].as_str())
                .unwrap_or("Codex session");
            let mut target = parent.clone();
            target.id = format!("codex:{id}");
            target.title = title.chars().take(300).collect();
            target.content = Some(ContentRef {
                provider: "codex".into(),
                instance: "local".into(),
                context: home.into(),
                item: id,
                parent_id: parent.id.clone(),
                subtitle: thread["cwd"].as_str().unwrap_or_default().into(),
                active: false,
                preview: false,
                description: thread["preview"]
                    .as_str()
                    .filter(|s| *s != title)
                    .unwrap_or_default()
                    .chars()
                    .take(300)
                    .collect(),
                ..Default::default()
            });
            Some(Ok(target))
        })
        .collect()
}
pub fn activate(content: &ContentRef) -> Result<bool, String> {
    uuid::Uuid::parse_str(&content.item).map_err(|_| "Invalid Codex thread ID")?;
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/open")
            .args([
                "-b",
                "com.openai.codex",
                &format!("codex://threads/{}", content.item),
            ])
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(false);
        }
    }
    Err("Codex could not open that session".into())
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    fn shell(script: &str) -> std::process::Command {
        let mut command = std::process::Command::new("/bin/sh");
        command.args(["-c", script]);
        command
    }
    #[test]
    #[cfg(unix)]
    fn indexed_inventory_includes_desktop_and_all_providers() {
        let command = shell(
            r#"
            read -r initialize
            printf '{"method":"notification"}\n{"id":1,"result":{}}\n'
            read -r initialized
            read -r request
            case "$request" in *'"useStateDbOnly":true'*) ;; *) exit 1;; esac
            case "$request" in *'"sourceKinds":["cli","vscode","appServer"]'*) ;; *) exit 1;; esac
            case "$request" in *'"modelProviders":[]'*) ;; *) exit 1;; esac
            printf '{"id":2,"result":{"data":[{"id":"local-session"}]}}\n'
        "#,
        );
        let rows =
            super::threads_with_command(command, "", std::time::Duration::from_secs(2)).unwrap();
        assert_eq!(rows[0]["id"], "local-session");
    }
    #[test]
    #[cfg(unix)]
    fn stalled_server_is_killed_and_returns_a_bounded_error() {
        let started = std::time::Instant::now();
        let result = super::threads_with_command(
            shell("read -r initialize; exec sleep 30"),
            "",
            std::time::Duration::from_millis(100),
        );
        assert!(result.unwrap_err().contains("timed out"));
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }
    #[test]
    #[ignore = "Requires an installed Codex app-server and reads local thread metadata"]
    fn installed_app_server_lists_local_metadata() {
        let items = super::threads("").expect("installed app-server thread/list");
        assert!(
            !items.is_empty(),
            "Expected at least one local session for this smoke test"
        );
        assert!(items.iter().all(|t| t["id"]
            .as_str()
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())));
        println!(
            "Codex thread/list: {} session identities validated; content omitted",
            items.len()
        );
    }
    #[test]
    fn invalid_deep_link_is_rejected_before_any_process_is_started() {
        let content = crate::model::ContentRef {
            provider: "codex".into(),
            instance: "local".into(),
            context: "".into(),
            item: "../../bad?x=1".into(),
            parent_id: "1".into(),
            subtitle: "".into(),
            active: false,
            preview: false,
            ..Default::default()
        };
        assert!(super::activate(&content).is_err());
    }
}
