use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRotationDataResponseModel {
    pub agent_records: Vec<serde_json::Value>,
    pub form_bindings: Vec<serde_json::Value>,
}
