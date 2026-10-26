use uuid::Uuid;

type DateTime = chrono::DateTime<chrono::Utc>;
uniffi::use_remote_type!(vowkey_core::DateTime);
uniffi::use_remote_type!(vowkey_core::Uuid);
