use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::VowkeyError;

const SOCKET_NAME: &str = "pw";
const SOCKET_TIMEOUT: Duration = Duration::from_millis(2200);

/// Saved login credential (and optional live verification code) returned by the Vowkey desktop app
/// to the macOS AutoFill Credential Provider extension.
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordCredentialRecord {
    pub record_identifier: String,
    pub username: String,
    pub password: Option<String>,
    pub totp: Option<String>,
    pub service_identifier: String,
    pub title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PasswordSocketRequest<'a> {
    op: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    service_identifiers: Option<&'a [String]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    record_identifier: Option<&'a str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasswordSocketResponse {
    ok: bool,
    #[serde(default)]
    locked: bool,
    #[serde(default)]
    credentials: Vec<PasswordCredentialRecord>,
    error: Option<String>,
}

fn candidate_socket_paths() -> Vec<PathBuf> {
    let primary = desktop_core::ipc::path(SOCKET_NAME);
    let mut paths = vec![primary];
    if let Some(home) = std::env::var_os("HOME") {
        let home_path = PathBuf::from(home);
        let group_sock = home_path
            .join("Library")
            .join("Group Containers")
            .join("9ASJ75KP6N.com.vowkey.desktop")
            .join(format!("s.{SOCKET_NAME}"));
        if !paths.contains(&group_sock) {
            paths.push(group_sock);
        }
        let cache_sock = home_path
            .join("Library")
            .join("Caches")
            .join("com.vowkey.desktop")
            .join(format!("s.{SOCKET_NAME}"));
        if !paths.contains(&cache_sock) {
            paths.push(cache_sock);
        }
    }
    paths
}

#[cfg(unix)]
fn query_socket_at(
    socket_path: &Path,
    request: &PasswordSocketRequest<'_>,
) -> Result<PasswordSocketResponse, VowkeyError> {
    use std::os::unix::net::UnixStream;

    let mut stream =
        UnixStream::connect(socket_path).map_err(|_| VowkeyError::Disconnected)?;
    let _ = stream.set_read_timeout(Some(SOCKET_TIMEOUT));
    let _ = stream.set_write_timeout(Some(SOCKET_TIMEOUT));

    let mut line = serde_json::to_string(request)
        .map_err(|err| VowkeyError::Internal(format!("Serialize error: {err}")))?;
    line.push('\n');
    stream
        .write_all(line.as_bytes())
        .map_err(|_| VowkeyError::Disconnected)?;
    stream.flush().map_err(|_| VowkeyError::Disconnected)?;

    let mut reader = BufReader::new(stream);
    let mut response_line = String::new();
    let bytes = reader
        .read_line(&mut response_line)
        .map_err(|_| VowkeyError::Disconnected)?;
    if bytes == 0 {
        return Err(VowkeyError::Disconnected);
    }

    serde_json::from_str::<PasswordSocketResponse>(response_line.trim())
        .map_err(|err| VowkeyError::Internal(format!("Invalid credential response: {err}")))
}

#[cfg(not(unix))]
fn query_socket_at(
    _socket_path: &Path,
    _request: &PasswordSocketRequest<'_>,
) -> Result<PasswordSocketResponse, VowkeyError> {
    Err(VowkeyError::Disconnected)
}

fn query_password_socket(
    request: &PasswordSocketRequest<'_>,
) -> Result<Vec<PasswordCredentialRecord>, VowkeyError> {
    let mut last_error = VowkeyError::Disconnected;
    for path in candidate_socket_paths() {
        if !path.exists() {
            continue;
        }
        match query_socket_at(&path, request) {
            Ok(reply) => {
                if reply.locked {
                    return Err(VowkeyError::Internal("VaultLocked".to_owned()));
                }
                if !reply.ok {
                    return Err(VowkeyError::Internal(
                        reply
                            .error
                            .unwrap_or_else(|| "Credential lookup failed".to_owned()),
                    ));
                }
                return Ok(reply.credentials);
            }
            Err(err) => {
                last_error = err;
            }
        }
    }
    Err(last_error)
}

/// Lists saved login credentials matching `service_identifiers` (or all saved logins when empty).
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn list_password_credentials(
    service_identifiers: Vec<String>,
) -> Result<Vec<PasswordCredentialRecord>, VowkeyError> {
    let req = PasswordSocketRequest {
        op: "list",
        service_identifiers: Some(&service_identifiers),
        record_identifier: None,
    };
    query_password_socket(&req)
}

/// Fetches a single decrypted login credential (including password and live TOTP code) by ID.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn fetch_password_credential(
    record_identifier: String,
) -> Result<PasswordCredentialRecord, VowkeyError> {
    let req = PasswordSocketRequest {
        op: "get",
        service_identifiers: None,
        record_identifier: Some(&record_identifier),
    };
    let mut items = query_password_socket(&req)?;
    if items.is_empty() {
        return Err(VowkeyError::CredentialNotFound);
    }
    Ok(items.swap_remove(0))
}

#[cfg(all(test, unix))]
mod tests {
    use std::{
        io::{BufRead, BufReader, Write},
        os::unix::net::UnixListener,
    };

    use serde_json::json;

    use super::{PasswordCredentialRecord, PasswordSocketRequest, query_socket_at};

    #[test]
    fn round_trips_password_and_totp_over_unix_socket() {
        let dir = std::env::temp_dir().join(format!("vk-pw-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let sock = dir.join("s.pw");
        let _ = std::fs::remove_file(&sock);

        let listener = UnixListener::bind(&sock).unwrap();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(&stream).read_line(&mut line).unwrap();
            assert!(line.contains("\"op\":\"get\""));
            assert!(line.contains("\"recordIdentifier\":\"c-1\""));
            let reply = json!({
                "ok": true,
                "credentials": [{
                    "recordIdentifier": "c-1",
                    "username": "linh@example.com",
                    "password": "correct-horse-battery-staple",
                    "totp": "482910",
                    "serviceIdentifier": "https://github.com",
                    "title": "GitHub"
                }]
            });
            writeln!(stream, "{reply}").unwrap();
        });

        let req = PasswordSocketRequest {
            op: "get",
            service_identifiers: None,
            record_identifier: Some("c-1"),
        };
        let reply = query_socket_at(&sock, &req).unwrap();
        handle.join().unwrap();
        let _ = std::fs::remove_file(&sock);
        let _ = std::fs::remove_dir(&dir);

        assert!(reply.ok);
        assert_eq!(
            reply.credentials,
            vec![PasswordCredentialRecord {
                record_identifier: "c-1".to_owned(),
                username: "linh@example.com".to_owned(),
                password: Some("correct-horse-battery-staple".to_owned()),
                totp: Some("482910".to_owned()),
                service_identifier: "https://github.com".to_owned(),
                title: "GitHub".to_owned(),
            }]
        );
    }
}
