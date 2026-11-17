use std::sync::LazyLock;

pub(crate) fn join_path(base: &str, child: &str) -> String {
    #[cfg(gcs)]
    if gcs::is_uri(base) {
        return gcs::join_path(base, child);
    }

    let base = base.trim_end_matches('/');
    let child = child.trim_start_matches('/');
    if base.is_empty() {
        child.to_owned()
    } else if child.is_empty() {
        base.to_owned()
    } else {
        format!("{base}/{child}")
    }
}

pub(crate) fn with_extension(path: &str, extension: &str) -> String {
    let extension = extension.trim_start_matches('.');

    #[cfg(gcs)]
    if gcs::is_uri(path) {
        return gcs::with_extension(path, extension);
    }

    format!("{path}.{extension}")
}

pub(crate) fn parent(path: &str) -> Option<String> {
    #[cfg(gcs)]
    if gcs::is_uri(path) {
        return gcs::parent(path);
    }

    std::path::Path::new(path).parent()?.to_str().map(str::to_owned)
}

pub(crate) fn file_name(path: &str) -> Option<String> {
    #[cfg(gcs)]
    if gcs::is_uri(path) {
        return gcs::file_name(path);
    }

    std::path::Path::new(path).file_name()?.to_str().map(str::to_owned)
}

pub(crate) fn is_fs_operator(operator: &opendal::Operator) -> bool {
    operator.info().scheme() == opendal::services::FS_SCHEME
}

pub(crate) fn operator_for_path(path: &str) -> Result<opendal::Operator, crate::Error> {
    // Cache of previously built operators by path
    static OPERATORS_BY_PATH: LazyLock<dashmap::DashMap<String, opendal::Operator>> =
        LazyLock::new(dashmap::DashMap::new);

    if let Some(operator) = OPERATORS_BY_PATH.get(path) {
        return Ok(operator.clone());
    }

    let operator = if path.starts_with("gs://") {
        #[cfg(not(gcs))]
        return Err(opendal::Error::new(opendal::ErrorKind::ConfigInvalid, "Cloud Storage support is not enabled").into());

        #[cfg(gcs)]
        gcs::operator_for_path(path)?
    } else {
        let builder = opendal::services::Fs::default().root(path);
        opendal::Operator::new(builder)?
    };

    OPERATORS_BY_PATH.insert(path.to_owned(), operator.clone());

    Ok(operator)
}

#[cfg(gcs)]
mod gcs {
    use std::sync::LazyLock;

    use opendal_http_transport_reqwest::ReqwestTransport;
    use reqwest::Url;

    use crate::error::Error;

    static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
        // Storage endpoints are administrator-configured and may be private.
        crate::http_client::get_reqwest_client_builder(false).build().expect("Failed to build OpenDAL HTTP client")
    });

    pub(super) fn is_uri(path: &str) -> bool {
        path.starts_with("gs://")
    }

    pub(super) fn join_path(base: &str, child: &str) -> String {
        if let Ok(mut url) = Url::parse(base) {
            let mut segments = path_segments(&url);
            segments.extend(child.split('/').filter(|segment| !segment.is_empty()).map(str::to_owned));
            set_path_segments(&mut url, &segments);
            return url.to_string();
        }

        let base = base.trim_end_matches('/');
        let child = child.trim_start_matches('/');
        if base.is_empty() {
            child.to_owned()
        } else if child.is_empty() {
            base.to_owned()
        } else {
            format!("{base}/{child}")
        }
    }

    pub(super) fn with_extension(path: &str, extension: &str) -> String {
        if let Ok(mut url) = Url::parse(path) {
            let mut segments = path_segments(&url);
            if let Some(file_name) = segments.last_mut() {
                file_name.push('.');
                file_name.push_str(extension);
                set_path_segments(&mut url, &segments);
                return url.to_string();
            }
        }

        format!("{path}.{extension}")
    }

    pub(super) fn parent(path: &str) -> Option<String> {
        if let Ok(mut url) = Url::parse(path) {
            let mut segments = path_segments(&url);
            segments.pop()?;
            set_path_segments(&mut url, &segments);
            return Some(url.to_string());
        }

        std::path::Path::new(path).parent()?.to_str().map(str::to_owned)
    }

    pub(super) fn file_name(path: &str) -> Option<String> {
        if let Ok(url) = Url::parse(path) {
            return path_segments(&url).pop();
        }

        std::path::Path::new(path).file_name()?.to_str().map(str::to_owned)
    }

    fn path_segments(url: &Url) -> Vec<String> {
        url.path_segments()
            .map(|segments| segments.filter(|segment| !segment.is_empty()).map(str::to_owned).collect())
            .unwrap_or_default()
    }

    fn set_path_segments(url: &mut Url, segments: &[String]) {
        if segments.is_empty() {
            url.set_path("");
        } else {
            url.set_path(&format!("/{}", segments.join("/")));
        }
    }

    pub(super) fn operator_for_path(path: &str) -> Result<opendal::Operator, Error> {
        use opendal::Configurator;

        let uri = opendal::OperatorUri::new(path, std::iter::empty::<(String, String)>())?;
        let config = opendal::services::GcsConfig::from_uri(&uri)?;
        let builder = config.into_builder();
        let http_transport = opendal::HttpTransporter::new(ReqwestTransport::new(HTTP_CLIENT.clone()));
        let context = opendal::OperationContext::new().with_http_transport(http_transport);
        Ok(opendal::Operator::new(builder)?.with_context(context))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_local_paths() {
        assert_eq!(join_path("data", "attachments"), "data/attachments");
        assert_eq!(with_extension("data/rsa_key", "pem"), "data/rsa_key.pem");
        assert_eq!(parent("data/rsa_key.pem").as_deref(), Some("data"));
        assert_eq!(file_name("data/rsa_key.pem").as_deref(), Some("rsa_key.pem"));
    }
}

#[cfg(all(test, gcs))]
mod gcs_tests {
    use super::*;

    #[test]
    fn joins_gcs_path_before_query_string() {
        assert_eq!(
            join_path("gs://bucket/base?predefined_acl=projectPrivate", "attachments"),
            "gs://bucket/base/attachments?predefined_acl=projectPrivate"
        );
    }

    #[test]
    fn appends_extension_before_gcs_query_string() {
        assert_eq!(
            with_extension("gs://bucket/base/rsa_key?predefined_acl=projectPrivate", "pem"),
            "gs://bucket/base/rsa_key.pem?predefined_acl=projectPrivate"
        );
    }

    #[test]
    fn splits_gcs_parent_and_file_name_without_query_string() {
        let path = "gs://bucket/base/config.json?predefined_acl=projectPrivate";

        assert_eq!(parent(path).as_deref(), Some("gs://bucket/base?predefined_acl=projectPrivate"));
        assert_eq!(file_name(path).as_deref(), Some("config.json"));
    }
}
