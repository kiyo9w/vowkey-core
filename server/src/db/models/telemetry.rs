use diesel::prelude::*;
use serde_json::Value;

use crate::{
    api::EmptyResult,
    db::{DbConn, schema::telemetry_daily},
    error::MapResult,
    util::retry,
};

#[derive(Clone, Debug, Identifiable, Queryable, Insertable)]
#[diesel(table_name = telemetry_daily)]
#[diesel(primary_key(utc_day, event, surface, os, locale, page_slug))]
pub struct TelemetryDaily {
    pub utc_day: String,
    pub event: String,
    pub surface: String,
    pub os: String,
    pub locale: String,
    pub page_slug: String,
    pub count: i64,
}

impl TelemetryDaily {
    pub async fn increment(
        utc_day: String,
        event: String,
        surface: String,
        os: String,
        locale: String,
        page_slug: String,
        conn: &DbConn,
    ) -> EmptyResult {
        let row = Self {
            utc_day,
            event,
            surface,
            os,
            locale,
            page_slug,
            count: 1,
        };

        db_run! { conn:
            mysql {
                retry(||
                    diesel::insert_into(telemetry_daily::table)
                        .values(&row)
                        .on_conflict(diesel::dsl::DuplicatedKeys)
                        .do_update()
                        .set(telemetry_daily::count.eq(telemetry_daily::count + 1))
                        .execute(conn),
                    10,
                ).map_res("Error recording telemetry event")
            }
            postgresql, sqlite {
                retry(||
                    diesel::insert_into(telemetry_daily::table)
                        .values(&row)
                        .on_conflict((
                            telemetry_daily::utc_day,
                            telemetry_daily::event,
                            telemetry_daily::surface,
                            telemetry_daily::os,
                            telemetry_daily::locale,
                            telemetry_daily::page_slug,
                        ))
                        .do_update()
                        .set(telemetry_daily::count.eq(telemetry_daily::count + 1))
                        .execute(conn),
                    10,
                ).map_res("Error recording telemetry event")
            }
        }
    }

    pub async fn list_since(since_day: &str, conn: &DbConn) -> Vec<Self> {
        let since = since_day.to_owned();
        conn.run(move |conn| {
            telemetry_daily::table
                .filter(telemetry_daily::utc_day.ge(since))
                .order((telemetry_daily::utc_day.desc(), telemetry_daily::count.desc()))
                .load::<Self>(conn)
                .unwrap_or_default()
        })
        .await
    }

    pub fn to_json(&self) -> Value {
        json!({
            "utcDay": self.utc_day,
            "event": self.event,
            "surface": self.surface,
            "os": self.os,
            "locale": self.locale,
            "pageSlug": self.page_slug,
            "count": self.count,
        })
    }
}

pub const COUNT_THRESHOLD: i64 = 5;

const PUBLIC_EVENTS: &[&str] = &["page_view", "download_clicked", "fill_outcome"];
const PAGES: &[&str] = &[
    "home", "import", "practice", "host", "en-schengen-arrival", "jp-konin-todoke", "jp-nenkin-lump-sum",
    "jp-zairyu-change", "vn-ct01", "vn-tk1-ts",
];
const LOCALES: &[&str] = &["en", "vi", "ja", "ko", "zh-CN", "zh-TW", "es", "fr", "de", "pt-BR"];
const CAMPAIGNS: &[&str] = &["direct", "launch", "mac", "windows", "linux", "extension", "family", "office", "free", "agent"];

/// An allowlisted acquisition slug, or empty. Anything else is not stored.
pub fn campaign_slug(value: &str) -> &'static str {
    CAMPAIGNS.iter().copied().find(|slug| *slug == value).unwrap_or("")
}

const DECISION_EVENTS: &[&str] = &[
    "decision_requests",
    "decision_cost_micros",
    "decision_input_tokens",
    "decision_output_tokens",
    "decision_latency_ms",
    "decision_succeeded",
    "decision_failed",
];
const PLANS: &[&str] = &["free", "family", "office", "storage_plus", "hosted_agent"];

/// One Decision request, already reduced to its plan. The account, model and result are not here.
pub struct DecisionUsage {
    pub plan: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cost_micros: Option<i64>,
    pub latency_ms: Option<i64>,
    pub succeeded: bool,
}
fn outcome_event(usage: &DecisionUsage) -> &'static str {
    if usage.succeeded { "decision_succeeded" } else { "decision_failed" }
}


impl TelemetryDaily {
    /// Adds one request's totals under its plan. Each total is one upsert; a zero is skipped.
    pub async fn record_decision_usage(usage: DecisionUsage, conn: &DbConn) -> EmptyResult {
        if !PLANS.contains(&usage.plan.as_str())
            || [outcome_event(&usage)].into_iter().any(|event| !DECISION_EVENTS.contains(&event))
        {
            err!("Unknown plan");
        }
        let day = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let outcome = outcome_event(&usage);
        let plan = usage.plan;
        for (event, total) in [
            ("decision_requests", 1),
            ("decision_cost_micros", usage.cost_micros.unwrap_or(0)),
            ("decision_input_tokens", usage.input_tokens.unwrap_or(0)),
            ("decision_output_tokens", usage.output_tokens.unwrap_or(0)),
            ("decision_latency_ms", usage.latency_ms.unwrap_or(0)),
            (outcome, 1),
        ] {
            if total > 0 {
                Self::add(day.clone(), event.to_owned(), "server".to_owned(), String::new(), String::new(), plan.clone(), total, conn).await?;
            }
        }
        Ok(())
    }
}
const SURFACES: &[&str] = &["site", "web", "extension", "desktop", "ios", "android", "server"];
const OS_FAMILIES: &[&str] = &["", "macos", "windows", "linux", "ios", "android", "chromeos", "unknown"];

/// A count the server will keep. Unknown names, extra fields and values outside the lists are refused whole.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CountEvent {
    pub event: String,
    pub surface: String,
    pub os: String,
    pub locale: String,
    pub page: String,
    pub count: i64,
}

fn listed(value: &str, allow: &[&str]) -> bool {
    allow.contains(&value)
}

impl CountEvent {
    /// `page` carries the page slug, or `campaign:locale` for a download click.
    pub fn parse(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        if object.keys().any(|key| !matches!(key.as_str(), "event" | "surface" | "os" | "locale" | "page" | "count")) {
            return None;
        }
        let event = object.get("event")?.as_str()?;
        let surface = object.get("surface")?.as_str()?;
        let string = |key: &str| match object.get(key) { Some(value) => value.as_str(), None => Some("") };
        let os = string("os")?;
        let locale = string("locale")?;
        let page = string("page")?;
        let count = match object.get("count") { Some(value) => value.as_i64()?, None => 1 };
        let page_ok = if event == "download_clicked" {
            page.split_once(':').is_some_and(|(campaign, language)| !campaign_slug(campaign).is_empty() && listed(language, LOCALES))
        } else if event == "fill_outcome" {
            let mut parts = page.split(':');
            (0..3).all(|_| parts.next().is_some_and(|part| !part.is_empty()
                && part.len() <= 7 && part.bytes().all(|byte| byte.is_ascii_digit())))
                && parts.next().is_none()
        } else {
            listed(page, PAGES)
        };
        if !listed(event, PUBLIC_EVENTS)
            || !listed(surface, SURFACES)
            || surface == "server"
            || !listed(os, OS_FAMILIES)
            || !listed(locale, LOCALES)
            || !page_ok
            || !(1..=1000).contains(&count)
        {
            return None;
        }
        Some(Self {
            event: event.to_owned(),
            surface: surface.to_owned(),
            os: os.to_owned(),
            locale: locale.to_owned(),
            page: page.to_owned(),
            count,
        })
    }
}

/// Cells under [`COUNT_THRESHOLD`] stay out of the admin listing.
pub fn visible_counts(rows: &[TelemetryDaily]) -> Vec<Value> {
    rows.iter().filter(|row| row.count >= COUNT_THRESHOLD).map(TelemetryDaily::to_json).collect()
}

/// One server-computed cell for a UTC day. `page` is the device, item or plan the count belongs to.
pub struct ServerCount {
    pub event: &'static str,
    pub page: String,
    pub count: i64,
}

impl TelemetryDaily {
    pub async fn record(event: CountEvent, conn: &DbConn) -> EmptyResult {
        let day = chrono::Utc::now().format("%Y-%m-%d").to_string();
        Self::add(day, event.event, event.surface, event.os, event.locale, event.page, event.count, conn).await
    }

    async fn add(
        utc_day: String,
        event: String,
        surface: String,
        os: String,
        locale: String,
        page_slug: String,
        by: i64,
        conn: &DbConn,
    ) -> EmptyResult {
        let row = Self { utc_day, event, surface, os, locale, page_slug, count: by };
        db_run! { conn:
            mysql {
                retry(|| diesel::insert_into(telemetry_daily::table).values(&row)
                    .on_conflict(diesel::dsl::DuplicatedKeys).do_update()
                    .set(telemetry_daily::count.eq(telemetry_daily::count + by)).execute(conn), 10)
                    .map_res("Error recording telemetry event")
            }
            postgresql, sqlite {
                retry(|| diesel::insert_into(telemetry_daily::table).values(&row)
                    .on_conflict((telemetry_daily::utc_day, telemetry_daily::event, telemetry_daily::surface, telemetry_daily::os, telemetry_daily::locale, telemetry_daily::page_slug))
                    .do_update().set(telemetry_daily::count.eq(telemetry_daily::count + by)).execute(conn), 10)
                    .map_res("Error recording telemetry event")
            }
        }
    }

    /// Replaces the server surface for one day, so a rerun does not double a total.
    pub async fn replace_server_day(day: &str, counts: &[ServerCount], conn: &DbConn) -> EmptyResult {
        let day = day.to_owned();
        let rows: Vec<TelemetryDaily> = counts.iter().map(|count| TelemetryDaily {
            utc_day: day.clone(),
            event: count.event.to_owned(),
            surface: "server".to_owned(),
            os: String::new(),
            locale: String::new(),
            page_slug: count.page.clone(),
            count: count.count,
        }).collect();
        db_run! { conn:
            mysql, postgresql, sqlite {
                diesel::delete(telemetry_daily::table
                    .filter(telemetry_daily::utc_day.eq(&day))
                    .filter(telemetry_daily::surface.eq("server"))
                    .filter(telemetry_daily::event.ne_all(DECISION_EVENTS)))
                    .execute(conn)
                    .map(|_| ())
                    .map_res("Error clearing server counts")?;
                for row in &rows {
                    diesel::insert_into(telemetry_daily::table).values(row).execute(conn)
                        .map(|_| ()).map_res("Error writing server counts")?;
                }
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count(extra: Value) -> Option<CountEvent> {
        let mut body = serde_json::json!({"event": "page_view", "surface": "site", "os": "macos", "locale": "ja", "page": "home"});
        body.as_object_mut().unwrap().extend(extra.as_object().cloned().unwrap_or_default());
        CountEvent::parse(&body)
    }

    #[test]
    fn keeps_an_allowlisted_count() {
        let parsed = count(serde_json::json!({})).expect("allowlisted");
        assert_eq!(parsed.page, "home");
        assert_eq!(parsed.count, 1);
    }

    #[test]
    fn drops_an_unknown_field_or_value_whole() {
        assert!(count(serde_json::json!({"url": "https://example.test"})).is_none());
        assert!(count(serde_json::json!({"event": "session_replay"})).is_none());
        assert!(count(serde_json::json!({"locale": "japanese"})).is_none());
        assert!(count(serde_json::json!({"page": "../admin"})).is_none());
        for bad in [serde_json::json!({"locale": 1}), serde_json::json!({"os": false}),
            serde_json::json!({"page": null}), serde_json::json!({"count": "1"})] {
            assert!(count(bad).is_none());
        }
    }

    #[test]
    fn keeps_a_download_campaign_and_a_form_page() {
        let click = count(serde_json::json!({"event": "download_clicked", "page": "mac:ja"}));
        assert_eq!(click.expect("campaign").page, "mac:ja");
        let form = count(serde_json::json!({"event": "page_view", "page": "vn-ct01", "locale": "vi"}));
        assert!(form.is_some());
    }

    #[test]
    fn drops_a_server_event_and_an_unknown_campaign() {
        assert!(count(serde_json::json!({"event": "accounts_created", "surface": "site"})).is_none());
        assert!(count(serde_json::json!({"surface": "server"})).is_none());
        assert!(count(serde_json::json!({"event": "download_clicked", "page": "newsletter:ja"})).is_none());
        assert!(count(serde_json::json!({"locale": "JA"})).is_none());
    }
    #[test]
    fn fill_outcomes_keep_only_three_bounded_numbers() {
        let outcome = |page: &str| count(serde_json::json!({"event": "fill_outcome", "surface": "web", "page": page}));
        assert_eq!(outcome("12:1:0").unwrap().page, "12:1:0");
        for page in ["", "::", "1:2", "1:2:3:4", "1:hello:0", "99999999:0:0", "https://form.test"] {
            assert!(outcome(page).is_none(), "{page}");
        }
    }
    #[test]
    fn hides_cells_under_five() {
        let rows = vec![
            TelemetryDaily { utc_day: "2026-11-04".into(), event: "page_view".into(), surface: "site".into(), os: "macos".into(), locale: "ja".into(), page_slug: "home".into(), count: 4 },
            TelemetryDaily { utc_day: "2026-11-04".into(), event: "page_view".into(), surface: "site".into(), os: "windows".into(), locale: "en".into(), page_slug: "home".into(), count: 5 },
        ];
        let visible = visible_counts(&rows);
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0]["count"], 5);
    }
}
