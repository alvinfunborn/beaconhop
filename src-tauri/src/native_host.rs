//! Chrome Native Messaging host, served by the same executable before Tauri starts.
use crate::plugins::{self, Endpoint, MAX_MESSAGE};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufReader, Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

fn read_native(reader: &mut impl Read) -> Result<Value, String> {
    let mut header = [0u8; 4];
    reader.read_exact(&mut header).map_err(|e| e.to_string())?;
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > MAX_MESSAGE {
        return Err("Invalid native message size".into());
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}
fn write_native(value: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if body.len() > MAX_MESSAGE {
        return Err("Native response is too large".into());
    }
    let mut out = std::io::stdout().lock();
    out.write_all(&(body.len() as u32).to_le_bytes())
        .and_then(|_| out.write_all(&body))
        .and_then(|_| out.flush())
        .map_err(|e| e.to_string())
}
pub fn run() -> Result<(), String> {
    let mut input = BufReader::new(std::io::stdin());
    let hello = read_native(&mut input)?;
    let app_ids: Vec<String> =
        serde_json::from_value(hello["appIds"].clone()).map_err(|_| "Missing browser identity")?;
    if hello["type"] != "hello"
        || app_ids.is_empty()
        || app_ids.len() > 16
        || app_ids.iter().any(|s| s.len() > 200)
    {
        return Err("Invalid browser handshake".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let endpoint = Endpoint {
        protocol: 1,
        provider: "browser".into(),
        name: Some("Browser".into()),
        version: hello["version"]
            .as_str()
            .filter(|s| s.len() <= 100)
            .map(str::to_owned),
        instance: uuid::Uuid::new_v4().to_string(),
        app_ids,
        port: listener.local_addr().unwrap().port(),
        token: uuid::Uuid::new_v4().to_string(),
        capabilities: if hello["capabilities"]
            .as_array()
            .is_some_and(|caps| caps.iter().any(|c| c == "thumbnails"))
        {
            vec!["thumbnails".into()]
        } else {
            vec![]
        },
    };
    let path = plugins::directory()?.join(format!("browser-{}.json", endpoint.instance));
    let data = serde_json::to_vec(&endpoint).unwrap();
    plugins::private_write(&path, &data)?;
    let alive = Arc::new(AtomicBool::new(true));
    let reply: Arc<Mutex<Option<(String, mpsc::Sender<Value>)>>> = Arc::new(Mutex::new(None));
    let reader_alive = alive.clone();
    let replies = reply.clone();
    std::thread::spawn(move || {
        while let Ok(message) = read_native(&mut input) {
            if let Some((id, sender)) = replies.lock().unwrap().as_ref() {
                if message["id"] == *id {
                    let _ = sender.send(message);
                }
            }
        }
        reader_alive.store(false, Ordering::Release);
    });
    write_native(&json!({"type":"ready","protocol":1}))?;
    let mut refreshed = Instant::now();
    while alive.load(Ordering::Acquire) {
        if refreshed.elapsed() > Duration::from_secs(5) {
            plugins::private_write(&path, &data)?;
            refreshed = Instant::now();
        }
        match listener.accept() {
            Ok((mut socket, _)) => {
                // macOS inherits O_NONBLOCK from the listening socket. Requests
                // may arrive after accept (or in several packets), so this stream
                // must block within its timeout instead of closing on WouldBlock.
                socket.set_nonblocking(false).map_err(|e| e.to_string())?;
                let _ = socket.set_read_timeout(Some(Duration::from_millis(1000)));
                let _ = socket.set_write_timeout(Some(Duration::from_millis(1000)));
                let result = (|| -> Result<(), String> {
                    let mut request = plugins::read_line(&mut BufReader::new(
                        socket.try_clone().map_err(|e| e.to_string())?,
                    ))?;
                    if request["protocol"] != 1 || request["token"] != endpoint.token {
                        return Err("Unauthorized plugin request".into());
                    }
                    let id = request["id"]
                        .as_str()
                        .filter(|id| id.len() <= 100)
                        .ok_or("Invalid request ID")?
                        .to_owned();
                    if !matches!(
                        request["method"].as_str(),
                        Some("list" | "activate" | "thumbnails")
                    ) {
                        return Err("Unknown plugin method".into());
                    }
                    request.as_object_mut().unwrap().remove("token");
                    let (sender, receiver) = mpsc::channel();
                    *reply.lock().unwrap() = Some((id.clone(), sender));
                    write_native(&request)?;
                    let response = receiver
                        .recv_timeout(Duration::from_millis(2500))
                        .unwrap_or_else(|_| json!({"id":id,"error":"Browser plugin timed out"}));
                    *reply.lock().unwrap() = None;
                    writeln!(socket, "{response}").map_err(|e| e.to_string())
                })();
                if result.is_err() {
                    *reply.lock().unwrap() = None;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(_) => break,
        }
    }
    let _ = fs::remove_file(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_frames_are_little_endian_and_bounded() {
        let mut bytes = 2u32.to_le_bytes().to_vec();
        bytes.extend(b"{}");
        assert_eq!(read_native(&mut bytes.as_slice()).unwrap(), json!({}));
        assert!(read_native(&mut (MAX_MESSAGE as u32 + 1).to_le_bytes().as_slice()).is_err());
        assert!(read_native(&mut &[2, 0, 0, 0, b'{'][..]).is_err());
    }
}
