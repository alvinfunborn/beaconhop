//! Manual release discovery. Downloads and installation use Tauri's signed updater.
use serde::Serialize;
use std::time::Duration;

struct Channel {
    page: String,
    manifest: String,
    tag_path: String,
}
impl Channel {
    fn from_manifest(endpoint: &str) -> Result<Self, String> {
        let url = reqwest::Url::parse(endpoint).map_err(|e| e.to_string())?;
        let parts: Vec<_> = url.path().trim_start_matches('/').split('/').collect();
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || parts.len() != 6
            || parts[2..] != ["releases", "latest", "download", "latest.json"]
            || parts[..2].iter().any(|p| {
                p.is_empty()
                    || !p
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            })
        {
            return Err("Invalid GitHub update channel".into());
        }
        let repo = format!("{}/{}", parts[0], parts[1]);
        Ok(Self {
            page: format!("https://github.com/{repo}/releases/latest"),
            manifest: endpoint.into(),
            tag_path: format!("/{repo}/releases/tag/"),
        })
    }
    fn configured(app: &tauri::AppHandle) -> Result<Self, String> {
        let endpoint = app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|v| v.get("endpoints"))
            .and_then(|v| v.get(0))
            .and_then(|v| v.as_str())
            .ok_or("Update channel is not configured")?;
        Self::from_manifest(endpoint)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseStatus {
    current_version: String,
    published: bool,
    version: String,
    notes: String,
    newer: bool,
    can_install: bool,
}

fn release_tag<'a>(url: &'a reqwest::Url, channel: &Channel) -> Result<&'a str, String> {
    if url.scheme() != "https" || url.host_str() != Some("github.com") {
        return Err("Unexpected GitHub release destination".into());
    }
    url.path()
        .strip_prefix(&channel.tag_path)
        .filter(|tag| !tag.is_empty() && !tag.contains('/'))
        .ok_or_else(|| "GitHub did not resolve the latest release".into())
}

fn release_status(current: &str, tag: &str, can_install: bool) -> Result<ReleaseStatus, String> {
    let version = tag.strip_prefix('v').unwrap_or(tag);
    let current_version = semver::Version::parse(current).map_err(|e| e.to_string())?;
    let latest_version = semver::Version::parse(version)
        .map_err(|_| "GitHub returned an invalid release version".to_owned())?;
    if !latest_version.pre.is_empty() {
        return Err("GitHub returned a non-stable release".into());
    }
    Ok(ReleaseStatus {
        current_version: current.to_owned(),
        published: true,
        version: version.to_owned(),
        notes: String::new(),
        newer: latest_version > current_version,
        can_install,
    })
}

#[tauri::command]
pub async fn get_release_status(app: tauri::AppHandle) -> Result<ReleaseStatus, String> {
    discover_release(
        &app.package_info().version.to_string(),
        &Channel::configured(&app)?,
    )
    .await
}

async fn discover_release(current: &str, channel: &Channel) -> Result<ReleaseStatus, String> {
    // The public latest-release redirect avoids the unauthenticated API quota.
    // No startup request, timer, credentials, or persistent background task.
    let client = reqwest::Client::builder()
        .user_agent(concat!("beaconhop/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .head(&channel.page)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(ReleaseStatus {
            current_version: current.into(),
            published: false,
            version: String::new(),
            notes: String::new(),
            newer: false,
            can_install: false,
        });
    }
    let response = response.error_for_status().map_err(|e| e.to_string())?;
    let mut release = release_status(current, release_tag(response.url(), channel)?, false)?;
    if release.newer {
        let manifest = client
            .head(&channel.manifest)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        // Only a missing manifest means a legacy/manual release. Network and
        // server failures must remain errors, never an "up to date" result.
        release.can_install = match manifest.status() {
            reqwest::StatusCode::NOT_FOUND => false,
            status if status.is_success() => true,
            status => return Err(format!("GitHub update manifest returned HTTP {status}")),
        };
    }
    Ok(release)
}

#[tauri::command]
pub fn open_releases_page(app: tauri::AppHandle) -> Result<(), String> {
    let channel = Channel::configured(&app)?;
    // Fixed destination: the frontend cannot run arbitrary programs or URLs.
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("/usr/bin/open")
        .arg(&channel.page)
        .status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("explorer.exe")
        .arg(&channel.page)
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = std::process::Command::new("xdg-open")
        .arg(&channel.page)
        .status();
    status.map_err(|e| e.to_string()).and_then(|status| {
        if status.success() {
            Ok(())
        } else {
            Err("Could not open GitHub Releases".into())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_release_is_current_without_an_update_manifest() {
        let status = release_status("1.2.3", "v1.2.3", false).unwrap();
        assert!(!status.newer);
        assert!(!status.can_install);
    }

    #[test]
    fn compares_semver_and_never_offers_a_downgrade() {
        assert!(release_status("1.2.9", "v1.2.10", true).unwrap().newer);
        assert!(!release_status("1.3.0", "v1.2.10", true).unwrap().newer);
        assert!(
            release_status("1.3.0-beta.1", "v1.3.0", true)
                .unwrap()
                .newer
        );
        let legacy = release_status("1.2.3", "v1.2.4", false).unwrap();
        assert!(legacy.newer && !legacy.can_install);
    }

    #[test]
    fn rejects_invalid_or_non_stable_releases() {
        assert!(release_status("1.2.3", "latest", true).is_err());
        assert!(release_status("1.2.3", "v2.0.0-beta.1", true).is_err());
    }

    #[test]
    fn only_accepts_the_expected_repository_release_redirect() {
        let channel = Channel::from_manifest(
            "https://github.com/alvinfunborn/beaconhop/releases/latest/download/latest.json",
        )
        .unwrap();
        let valid =
            reqwest::Url::parse("https://github.com/alvinfunborn/beaconhop/releases/tag/v1.2.3")
                .unwrap();
        assert_eq!(release_tag(&valid, &channel).unwrap(), "v1.2.3");
        for invalid in [
            channel.page.as_str(),
            "https://github.com/other/repo/releases/tag/v1.2.3",
            "https://example.com/alvinfunborn/beaconhop/releases/tag/v1.2.3",
        ] {
            assert!(release_tag(&reqwest::Url::parse(invalid).unwrap(), &channel).is_err());
        }
    }
}
