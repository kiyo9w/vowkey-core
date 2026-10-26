use serde::{Deserialize, Serialize};
use vowkey_core::require;

use crate::VaultParseError;

#[allow(missing_docs)]
#[derive(Serialize, Deserialize, Debug)]
pub struct GlobalDomains {
    pub r#type: i32,
    pub domains: Vec<String>,
    pub excluded: bool,
}

impl TryFrom<vowkey_api_api::models::GlobalDomains> for GlobalDomains {
    type Error = VaultParseError;

    fn try_from(
        global_domains: vowkey_api_api::models::GlobalDomains,
    ) -> Result<Self, Self::Error> {
        Ok(Self {
            r#type: require!(global_domains.r#type),
            domains: require!(global_domains.domains),
            excluded: require!(global_domains.excluded),
        })
    }
}
