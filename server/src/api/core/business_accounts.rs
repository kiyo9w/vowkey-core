use chrono::Utc;
use diesel::prelude::*;
use rocket::{Route, serde::json::Json};
use crate::{api::EmptyResult, auth::Headers, db::{DbConn, schema::users}, mail, CONFIG};

pub fn routes() -> Vec<Route> { routes![guest_attached] }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AttachData { new_account: bool }
#[post("/accounts/guest-attached", data = "<data>")]
async fn guest_attached(data: Json<AttachData>, headers: Headers, conn: DbConn) -> EmptyResult {
    let timestamp = Utc::now().naive_utc();
    let changed = conn.run(|c| {
        diesel::update(users::table.filter(users::uuid.eq(&headers.user.uuid))
            .filter(users::guest_attached_at.is_null()))
            .set(users::guest_attached_at.eq(Some(timestamp))).execute(c)
    }).await?;
    if changed == 1 && data.new_account && CONFIG.mail_enabled() {
        if mail::send_welcome_from_guest(&headers.user.email).await.is_err() {
            warn!("Guest welcome mail failed");
        }
    }
    Ok(())
}
