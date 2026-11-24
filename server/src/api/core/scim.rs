// SCIM 2.0 directory sync for one office organization, mounted under
// /api/organizations/<org_id>/scim/v2.
//
// The bearer is the organization API key (docs/operations/keycloak.md): either the access
// token issued by POST /identity/connect/token with grant_type=client_credentials and
// client_id=organization.<org_id>, or the raw API key itself. Both are credentials of the
// organization; an unknown or foreign key is rejected with 401. Directory sync additionally
// requires the Office plan, so a non-Office organization gets 403.

use chrono::Utc;
use rocket::{
    Request, Route,
    form::FromForm,
    http::Status,
    request::{FromRequest, Outcome},
    response::status,
    serde::json::Json,
};
use serde_json::{Value, json};

use crate::{
    CONFIG,
    api::{EmptyResult, JsonResult},
    auth,
    billing::{entitlement, provider::PlanCode},
    db::{
        DbConn,
        models::{
            Group, GroupId, GroupUser, Membership, MembershipId, MembershipStatus, MembershipType, OrganizationApiKey,
            OrganizationId, User,
        },
    },
};

pub fn routes() -> Vec<Route> {
    routes![
        service_provider_config,
        list_users,
        get_user,
        post_user,
        put_user,
        patch_user,
        delete_user,
        list_groups,
        get_group,
        post_group,
        patch_group,
        delete_group,
    ]
}

/// The organization the SCIM bearer belongs to.
pub struct ScimToken(OrganizationId);

#[rocket::async_trait]
impl<'r> FromRequest<'r> for ScimToken {
    type Error = &'static str;

    async fn from_request(request: &'r Request<'_>) -> Outcome<Self, Self::Error> {
        let bearer = request.headers().get_one("Authorization").and_then(|a| a.strip_prefix("Bearer ")).map(str::trim);
        let Some(bearer) = bearer.filter(|b| !b.is_empty()) else {
            err_handler!("A SCIM bearer token is required");
        };
        let Outcome::Success(conn) = DbConn::from_request(request).await else {
            err_handler!("Error getting DB")
        };

        // Organization API key token, as issued by /identity/connect/token (client_credentials).
        if let Ok(claims) = auth::decode_api_org(bearer) {
            let now = Utc::now().timestamp();
            if now < claims.nbf || now > claims.exp {
                err_handler!("The SCIM bearer token has expired");
            }
            let scope = claims.scope.first().cloned().unwrap_or_default();
            if claims.iss != format!("{}|{scope}", CONFIG.domain_origin()) {
                err_handler!("The SCIM bearer token was not issued by this server");
            }
            let Some(org_id) = claims.client_id.strip_prefix("organization.").map(|id| OrganizationId::from(id.to_owned()))
            else {
                err_handler!("Malformed SCIM bearer token");
            };
            let Some(key) = OrganizationApiKey::find_by_org_uuid(&org_id, &conn).await else {
                err_handler!("Unknown organization API key");
            };
            if key.uuid != claims.sub || key.org_uuid != claims.client_sub {
                err_handler!("The SCIM bearer token does not match the organization API key");
            }
            return Outcome::Success(ScimToken(org_id));
        }

        // The raw organization API key as pasted into a directory provider: "<org_uuid>.<secret>".
        // The prefix selects the organization; only the secret is compared to the stored key.
        let Some((org_part, secret)) = bearer.split_once('.') else {
            err_handler!("Invalid SCIM bearer token");
        };
        let Ok(org_uuid) = uuid::Uuid::parse_str(org_part) else {
            err_handler!("Invalid SCIM bearer token");
        };
        let org_id = OrganizationId::from(org_uuid.to_string());
        match OrganizationApiKey::find_by_org_uuid(&org_id, &conn).await {
            Some(key) if key.check_valid_api_key(secret) => Outcome::Success(ScimToken(org_id)),
            _ => err_handler!("Invalid SCIM bearer token"),
        }
    }
}

/// Every route resolves the organization from the bearer and requires the Office plan.
async fn office(org_id: &OrganizationId, token: &ScimToken, conn: &DbConn) -> EmptyResult {
    if token.0 != *org_id {
        err_code!("Organization not found", 404);
    }
    if entitlement::for_org(org_id, conn).await?.base_plan != PlanCode::Office {
        err_code!("Directory sync requires an Office plan", 403);
    }
    Ok(())
}

fn active(member: &Membership) -> bool {
    // revoke() subtracts ACTIVATE_REVOKE_DIFF, so "revoked" means any status at or below Revoked.
    member.status > MembershipStatus::Revoked as i32
}

fn user_resource(member: &Membership, user: &User) -> Value {
    json!({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "id": member.uuid,
        "externalId": member.external_id,
        "userName": user.email,
        "active": active(member),
        "emails": [{ "value": user.email, "type": "work", "primary": true }],
        "meta": { "resourceType": "User" },
    })
}

fn group_resource(group: &Group, members: Vec<Value>) -> Value {
    json!({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        "id": group.uuid,
        "externalId": group.external_id,
        "displayName": group.name,
        "members": members,
        "meta": { "resourceType": "Group" },
    })
}


#[get("/organizations/<org_id>/scim/v2/ServiceProviderConfig")]
async fn service_provider_config(org_id: OrganizationId, token: ScimToken, conn: DbConn) -> JsonResult {
    office(&org_id, &token, &conn).await?;
    Ok(Json(json!({
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        "documentationUri": "https://vowkey.app/docs/office/directory-sync",
        "patch": { "supported": true },
        "bulk": { "supported": false, "maxOperations": 0, "maxPayloadSize": 0 },
        "filter": { "supported": true, "maxResults": 200 },
        "changePassword": { "supported": false },
        "sort": { "supported": false },
        "etag": { "supported": false },
        "authenticationSchemes": [{
            "type": "oauthbearertoken",
            "name": "Organization API key",
            "description": "The organization API key, issued by the organization owner.",
            "primary": true,
        }],
        "meta": { "resourceType": "ServiceProviderConfig", "location": format!("/api/organizations/{org_id}/scim/v2/ServiceProviderConfig") },
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // SCIM payload field: accepted on input, echoed from the canonical model on output
struct ScimEmail {
    value: String,
    #[serde(default)]
    primary: bool,
    #[serde(default = "default_type_work")]
    r#type: String,
}

fn default_type_work() -> String {
    "work".to_owned()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScimUser {
    user_name: Option<String>,
    #[serde(default)]
    emails: Vec<ScimEmail>,
    #[serde(default = "default_active")]
    active: bool,
    external_id: Option<String>,
}

fn default_active() -> bool {
    true
}

/// The primary email of a SCIM user, which is also the Vowkey account email.
fn email_of(user: &ScimUser) -> Option<String> {
    user.emails
        .iter()
        .find(|email| email.primary)
        .or_else(|| user.emails.first())
        .map(|email| email.value.to_lowercase())
        .or_else(|| user.user_name.clone().map(|name| name.to_lowercase()))
        .filter(|email| email.contains('@'))
}

/// SCIM list filter: one or more `attr op "value"` terms joined by `and`.
/// Only the attributes directory providers actually filter on are accepted.
fn parse_filter(filter: &str) -> Result<Vec<(String, &'static str, String)>, crate::Error> {
    let mut terms = Vec::new();
    for part in filter.split(" and ").map(str::trim).filter(|p| !p.is_empty()) {
        let Some((attr, rest)) = part.split_once(' ') else {
            err_code!("Unsupported SCIM filter", 400);
        };
        let attr = attr.to_lowercase();
        let (op, value) = match rest.split_once(' ') {
            Some(("eq", value)) => ("eq", value),
            Some(("sw", value)) => ("sw", value),
            _ => err_code!("Unsupported SCIM filter", 400),
        };
        if !matches!(attr.as_str(), "username" | "externalid" | "emails" | "emails.value" | "id" | "active") {
            err_code!("Unsupported SCIM filter attribute", 400);
        }
        let value = value.trim_matches('"').to_lowercase();
        if value.is_empty() {
            err_code!("Unsupported SCIM filter value", 400);
        }
        terms.push((attr, op, value));
    }
    if terms.is_empty() {
        err_code!("Unsupported SCIM filter", 400);
    }
    Ok(terms)
}

fn matches_filter(member: &Membership, user: &User, terms: &[(String, &'static str, String)]) -> bool {
    terms.iter().all(|(attr, op, value)| {
        let candidate = match attr.as_str() {
            "username" | "emails" | "emails.value" => user.email.to_lowercase(),
            "externalid" => member.external_id.clone().unwrap_or_default().to_lowercase(),
            "id" => member.uuid.to_string().to_lowercase(),
            "active" => active(member).to_string(),
            _ => return false,
        };
        match *op {
            "eq" => candidate == *value,
            "sw" => candidate.starts_with(value.as_str()),
            _ => false,
        }
    })
}

/// SCIM list query: `filter`, `startIndex` (1-based) and `count`.
#[derive(FromForm)]
struct ScimListParams {
    filter: Option<String>,
    #[field(name = "startIndex")]
    start_index: Option<usize>,
    count: Option<usize>,
}

#[get("/organizations/<org_id>/scim/v2/Users?<params..>")]
async fn list_users(org_id: OrganizationId, params: ScimListParams, token: ScimToken, conn: DbConn) -> JsonResult {
    office(&org_id, &token, &conn).await?;
    let terms = params.filter.as_deref().map(parse_filter).transpose()?;

    let mut members = Vec::new();
    for member in Membership::find_by_org(&org_id, &conn).await {
        let Some(user) = User::find_by_uuid(&member.user_uuid, &conn).await else { continue };
        if terms.as_ref().is_none_or(|terms| matches_filter(&member, &user, terms)) {
            members.push((member, user));
        }
    }

    let total = members.len();
    let start = params.start_index.unwrap_or(1).max(1) - 1;
    let count = params.count.unwrap_or(100).clamp(1, 200);
    let resources: Vec<Value> = members
        .into_iter()
        .skip(start)
        .take(count)
        .map(|(member, user)| user_resource(&member, &user))
        .collect();

    Ok(Json(json!({
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": total,
        "startIndex": start + 1,
        "itemsPerPage": resources.len(),
        "Resources": resources,
    })))
}

#[get("/organizations/<org_id>/scim/v2/Users/<id>")]
async fn get_user(org_id: OrganizationId, id: MembershipId, token: ScimToken, conn: DbConn) -> JsonResult {
    office(&org_id, &token, &conn).await?;
    let Some(member) = Membership::find_by_uuid_and_org(&id, &org_id, &conn).await else {
        err_code!("User not found", 404)
    };
    let Some(user) = User::find_by_uuid(&member.user_uuid, &conn).await else {
        err_code!("User not found", 404)
    };
    Ok(Json(user_resource(&member, &user)))
}

/// Invite, restore or revoke one member. The account email is the vault key salt, so the
/// email itself never changes here; a different `userName` is rejected.
async fn apply_user(org_id: &OrganizationId, user: &User, external_id: &str, active: bool, conn: &DbConn) -> EmptyResult {
    let import = super::public::OrgImportData {
        groups: Vec::new(),
        members: vec![super::public::OrgImportUserData {
            email: user.email.clone(),
            external_id: external_id.to_owned(),
            deleted: !active,
        }],
        overwrite_existing: false,
    };
    super::public::import_organization(org_id.clone(), &import, conn).await
}

#[post("/organizations/<org_id>/scim/v2/Users", data = "<data>")]
async fn post_user(
    org_id: OrganizationId,
    data: Json<ScimUser>,
    token: ScimToken,
    conn: DbConn,
) -> Result<status::Created<Json<Value>>, crate::Error> {
    office(&org_id, &token, &conn).await?;
    let data = data.into_inner();
    let Some(email) = email_of(&data) else {
        err_code!("SCIM user has no email", 400)
    };
    if !data.active {
        err_code!("A SCIM user must be active to be invited", 400)
    }
    let external_id = data.external_id.clone().unwrap_or_else(|| email.clone());
    if Membership::find_by_email_and_org(&email, &org_id, &conn).await.is_some() {
        err_code!("A member with this email already exists", 409)
    }
    let import = super::public::OrgImportData {
        groups: Vec::new(),
        members: vec![super::public::OrgImportUserData { email: email.clone(), external_id: external_id.clone(), deleted: false }],
        overwrite_existing: false,
    };
    super::public::import_organization(org_id.clone(), &import, &conn).await?;
    let Some(member) = Membership::find_by_email_and_org(&email, &org_id, &conn).await else {
        err_code!("User was not created", 500)
    };
    let Some(user) = User::find_by_uuid(&member.user_uuid, &conn).await else {
        err_code!("User was not created", 500)
    };
    let location = format!("/api/organizations/{org_id}/scim/v2/Users/{}", member.uuid);
    Ok(status::Created::new(location).body(Json(user_resource(&member, &user))))
}

#[put("/organizations/<org_id>/scim/v2/Users/<id>", data = "<data>")]
async fn put_user(
    org_id: OrganizationId,
    id: MembershipId,
    data: Json<ScimUser>,
    token: ScimToken,
    conn: DbConn,
) -> JsonResult {
    office(&org_id, &token, &conn).await?;
    let data = data.into_inner();
    let Some(member) = Membership::find_by_uuid_and_org(&id, &org_id, &conn).await else {
        err_code!("User not found", 404)
    };
    let Some(user) = User::find_by_uuid(&member.user_uuid, &conn).await else {
        err_code!("User not found", 404)
    };
    if let Some(new_email) = email_of(&data)
        && new_email != user.email
    {
        err_code!("Directory sync cannot change the account email", 400)
    }
    let external_id = data.external_id.clone().unwrap_or_else(|| user.email.clone());
    apply_user(&org_id, &user, &external_id, data.active, &conn).await?;
    let Some(member) = Membership::find_by_uuid_and_org(&id, &org_id, &conn).await else {
        err_code!("User not found", 404)
    };
    Ok(Json(user_resource(&member, &user)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScimPatchOp {
    op: String,
    path: Option<String>,
    value: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // SCIM envelope field: required on input, not echoed on output
struct ScimPatch {
    schemas: Option<Vec<String>>,
    #[serde(rename = "Operations")]
    operations: Vec<ScimPatchOp>,
}

/// The user state a PATCH starts from, so a partial update keeps the rest.
fn current_user(member: &Membership, user: &User) -> ScimUser {
    ScimUser {
        user_name: Some(user.email.clone()),
        emails: vec![ScimEmail { value: user.email.clone(), primary: true, r#type: "work".to_owned() }],
        active: active(member),
        external_id: member.external_id.clone(),
    }
}

#[patch("/organizations/<org_id>/scim/v2/Users/<id>", data = "<data>")]
async fn patch_user(
    org_id: OrganizationId,
    id: MembershipId,
    data: Json<ScimPatch>,
    token: ScimToken,
    conn: DbConn,
) -> Result<Status, crate::Error> {
    office(&org_id, &token, &conn).await?;
    let data = data.into_inner();
    let Some(member) = Membership::find_by_uuid_and_org(&id, &org_id, &conn).await else {
        err_code!("User not found", 404)
    };
    let Some(user) = User::find_by_uuid(&member.user_uuid, &conn).await else {
        err_code!("User not found", 404)
    };
    let mut state = current_user(&member, &user);

    for operation in &data.operations {
        let op = operation.op.to_lowercase();
        match (op.as_str(), operation.path.as_deref()) {
            // A pathless operation carries a partial user object.
            // A pathless operation carries a partial user object; only the fields it sends
            // change, so read them as options instead of a full ScimUser.
            ("add" | "replace", None) => {
                let Some(partial) = operation.value.as_ref().and_then(Value::as_object) else {
                    err_code!("Invalid SCIM patch value", 400)
                };
                if let Some(email) = partial.get("userName").and_then(Value::as_str).map(str::to_lowercase)
                    .or_else(|| partial.get("emails").and_then(|e| e.as_array()).and_then(|a| a.first()).and_then(|e| e.get("value")).and_then(Value::as_str).map(str::to_lowercase))
                    && email != user.email
                {
                    err_code!("Directory sync cannot change the account email", 400)
                }
                if let Some(external_id) = partial.get("externalId").and_then(Value::as_str) {
                    state.external_id = Some(external_id.to_owned());
                }
                if let Some(active) = partial.get("active").and_then(Value::as_bool) {
                    state.active = active;
                }
            }
            ("replace" | "add", Some("active")) => {
                let Some(active) = operation.value.as_ref().and_then(Value::as_bool) else {
                    err_code!("Invalid SCIM patch value for active", 400)
                };
                state.active = active;
            }
            ("replace" | "add", Some("externalId")) => {
                let Some(external_id) = operation.value.as_ref().and_then(Value::as_str) else {
                    err_code!("Invalid SCIM patch value for externalId", 400)
                };
                state.external_id = Some(external_id.to_owned());
            }
            ("replace" | "add", Some("userName")) | ("replace" | "add", Some("emails")) | ("replace" | "add", Some("emails.value")) => {
                // The account email is the vault key salt; only the same email is accepted.
                let Some(value) = &operation.value else {
                    err_code!("Invalid SCIM patch value", 400)
                };
                let emails = match value {
                    Value::String(email) => vec![ScimEmail { value: email.clone(), primary: true, r#type: "work".to_owned() }],
                    Value::Array(items) => items
                        .iter()
                        .filter_map(|item| serde_json::from_value::<ScimEmail>(item.clone()).ok())
                        .collect(),
                    _ => err_code!("Invalid SCIM patch value", 400),
                };
                if let Some(email) = emails.iter().find(|e| e.primary).or_else(|| emails.first()).map(|e| e.value.to_lowercase())
                    && email != user.email
                {
                    err_code!("Directory sync cannot change the account email", 400)
                }
            }
            ("remove", Some("active")) => {
                state.active = false;
            }
            _ => err_code!("Unsupported SCIM patch operation", 400),
        }
    }

    let external_id = state.external_id.clone().unwrap_or_else(|| user.email.clone());
    apply_user(&org_id, &user, &external_id, state.active, &conn).await?;
    Ok(Status::NoContent)
}

#[delete("/organizations/<org_id>/scim/v2/Users/<id>")]
async fn delete_user(org_id: OrganizationId, id: MembershipId, token: ScimToken, conn: DbConn) -> Result<Status, crate::Error> {
    office(&org_id, &token, &conn).await?;
    let Some(member) = Membership::find_by_uuid_and_org(&id, &org_id, &conn).await else {
        return Ok(Status::NoContent);
    };
    if member.atype == MembershipType::Owner as i32 {
        err_code!("The organization owner cannot be removed by directory sync", 400)
    }
    member.delete(&conn).await?;
    Ok(Status::NoContent)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScimGroup {
    display_name: String,
    external_id: Option<String>,
    #[serde(default)]
    members: Vec<ScimMember>,
}

#[derive(Deserialize)]
struct ScimMember {
    value: String,
}

#[get("/organizations/<org_id>/scim/v2/Groups?<params..>")]
async fn list_groups(org_id: OrganizationId, params: ScimListParams, token: ScimToken, conn: DbConn) -> JsonResult {
    office(&org_id, &token, &conn).await?;
    // Group filters are not used by directory providers on this endpoint.
    let groups = Group::find_by_organization(&org_id, &conn).await;
    let total = groups.len();
    let start = params.start_index.unwrap_or(1).max(1) - 1;
    let count = params.count.unwrap_or(100).clamp(1, 200);
    let mut resources: Vec<Value> = Vec::new();
    for group in groups.into_iter().skip(start).take(count) {
        let members = GroupUser::find_by_group(&group.uuid, &org_id, &conn).await;
        let members = members.iter().map(|gu| json!({ "value": gu.users_organizations_uuid })).collect();
        resources.push(group_resource(&group, members));
    }
    Ok(Json(json!({
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": total,
        "startIndex": start + 1,
        "itemsPerPage": resources.len(),
        "Resources": resources,
    })))
}

#[get("/organizations/<org_id>/scim/v2/Groups/<id>")]
async fn get_group(org_id: OrganizationId, id: GroupId, token: ScimToken, conn: DbConn) -> JsonResult {
    office(&org_id, &token, &conn).await?;
    let Some(group) = Group::find_by_uuid_and_org(&id, &org_id, &conn).await else {
        err_code!("Group not found", 404)
    };
    let members = GroupUser::find_by_group(&group.uuid, &org_id, &conn).await;
    let members = members.iter().map(|gu| json!({ "value": gu.users_organizations_uuid })).collect();
    Ok(Json(group_resource(&group, members)))
}

/// Create or rename the group and replace its members, the way a directory push does.
async fn apply_group(org_id: &OrganizationId, name: &str, external_id: &str, member_ids: Vec<String>, conn: &DbConn) -> EmptyResult {
    let import = super::public::OrgImportData {
        groups: vec![super::public::OrgImportGroupData {
            name: name.to_owned(),
            external_id: external_id.to_owned(),
            member_external_ids: member_ids,
        }],
        members: Vec::new(),
        overwrite_existing: false,
    };
    super::public::import_organization(org_id.clone(), &import, conn).await
}

/// SCIM group members are referenced by their user id, which is the membership uuid here; the
/// import API takes the member's external id, so resolve it.
async fn member_external_ids(org_id: &OrganizationId, values: &[ScimMember], conn: &DbConn) -> Vec<String> {
    let mut external_ids = Vec::new();
    for value in values {
        if let Some(membership) = Membership::find_by_uuid_and_org(&value.value.clone().into(), org_id, conn).await {
            external_ids.push(membership.external_id.unwrap_or_else(|| value.value.clone()));
        }
    }
    external_ids
}

#[post("/organizations/<org_id>/scim/v2/Groups", data = "<data>")]
async fn post_group(
    org_id: OrganizationId,
    data: Json<ScimGroup>,
    token: ScimToken,
    conn: DbConn,
) -> Result<status::Created<Json<Value>>, crate::Error> {
    office(&org_id, &token, &conn).await?;
    let data = data.into_inner();
    let external_id = data.external_id.clone().unwrap_or_else(|| data.display_name.clone());
    let member_external_ids = member_external_ids(&org_id, &data.members, &conn).await;
    apply_group(&org_id, &data.display_name, &external_id, member_external_ids, &conn).await?;
    let Some(group) = Group::find_by_external_id_and_org(&external_id, &org_id, &conn).await else {
        err_code!("Group was not created", 500)
    };
    let members = GroupUser::find_by_group(&group.uuid, &org_id, &conn).await;
    let members = members.iter().map(|gu| json!({ "value": gu.users_organizations_uuid })).collect();
    let location = format!("/api/organizations/{org_id}/scim/v2/Groups/{}", group.uuid);
    Ok(status::Created::new(location).body(Json(group_resource(&group, members))))
}

#[patch("/organizations/<org_id>/scim/v2/Groups/<id>", data = "<data>")]
async fn patch_group(
    org_id: OrganizationId,
    id: GroupId,
    data: Json<ScimPatch>,
    token: ScimToken,
    conn: DbConn,
) -> Result<Status, crate::Error> {
    office(&org_id, &token, &conn).await?;
    let data = data.into_inner();
    let Some(group) = Group::find_by_uuid_and_org(&id, &org_id, &conn).await else {
        err_code!("Group not found", 404)
    };
    let mut name = group.name.clone();
    let mut external_id = group.external_id.clone().unwrap_or_else(|| group.name.clone());
    let mut members: Vec<String> = Vec::new();
    for group_user in GroupUser::find_by_group(&id, &org_id, &conn).await {
        // apply_group takes external ids, so resolve each current member to its external id.
        if let Some(member) = Membership::find_by_uuid_and_org(&group_user.users_organizations_uuid, &org_id, &conn).await {
            members.push(member.external_id.unwrap_or_else(|| group_user.users_organizations_uuid.to_string()));
        }
    }

    for operation in &data.operations {
        let op = operation.op.to_lowercase();
        let path = operation.path.as_deref().unwrap_or("").to_lowercase();
        match (op.as_str(), path.as_str()) {
            ("add" | "replace", "displayname") => {
                let Some(display_name) = operation.value.as_ref().and_then(Value::as_str) else {
                    err_code!("Invalid SCIM patch value for displayName", 400)
                };
                name = display_name.to_owned();
            }
            ("add" | "replace", "externalid") => {
                let Some(value) = operation.value.as_ref().and_then(Value::as_str) else {
                    err_code!("Invalid SCIM patch value for externalId", 400)
                };
                external_id = value.to_owned();
            }
            ("add", "members") => {
                let Some(values) = operation.value.as_ref().and_then(Value::as_array) else {
                    err_code!("Invalid SCIM patch value for members", 400)
                };
                let added = member_external_ids(
                    &org_id,
                    &values.iter().filter_map(|v| serde_json::from_value::<ScimMember>(v.clone()).ok()).collect::<Vec<_>>(),
                    &conn,
                ).await;
                for external in added {
                    if !members.contains(&external) {
                        members.push(external);
                    }
                }
            }
            ("remove", "members") => {
                let Some(values) = operation.value.as_ref().and_then(Value::as_array) else {
                    err_code!("Invalid SCIM patch value for members", 400)
                };
                let removed = member_external_ids(
                    &org_id,
                    &values.iter().filter_map(|v| serde_json::from_value::<ScimMember>(v.clone()).ok()).collect::<Vec<_>>(),
                    &conn,
                ).await;
                members.retain(|member| !removed.contains(member));
            }
            ("replace", "members") => {
                let Some(values) = operation.value.as_ref().and_then(Value::as_array) else {
                    err_code!("Invalid SCIM patch value for members", 400)
                };
                members = member_external_ids(
                    &org_id,
                    &values.iter().filter_map(|v| serde_json::from_value::<ScimMember>(v.clone()).ok()).collect::<Vec<_>>(),
                    &conn,
                ).await;
            }
            _ => err_code!("Unsupported SCIM patch operation", 400),
        }
    }

    apply_group(&org_id, &name, &external_id, members, &conn).await?;
    Ok(Status::NoContent)
}

#[delete("/organizations/<org_id>/scim/v2/Groups/<id>")]
async fn delete_group(org_id: OrganizationId, id: GroupId, token: ScimToken, conn: DbConn) -> Result<Status, crate::Error> {
    office(&org_id, &token, &conn).await?;
    if let Some(group) = Group::find_by_uuid_and_org(&id, &org_id, &conn).await {
        group.delete(&org_id, &conn).await?;
    }
    Ok(Status::NoContent)
}
