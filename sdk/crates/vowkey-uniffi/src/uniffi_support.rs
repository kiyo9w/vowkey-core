use uuid::Uuid;
use vowkey_crypto::{SymmetricCryptoKey, safe};

// Forward the type definitions to the main vowkey crate
type DateTime = chrono::DateTime<chrono::Utc>;
uniffi::use_remote_type!(vowkey_core::DateTime);

type NaiveDate = chrono::NaiveDate;
uniffi::use_remote_type!(vowkey_core::NaiveDate);

uniffi::use_remote_type!(vowkey_core::Uuid);

uniffi::use_remote_type!(vowkey_crypto::safe::PasswordProtectedKeyEnvelope);

uniffi::use_remote_type!(vowkey_crypto::SymmetricCryptoKey);
