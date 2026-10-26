//! Custom Uniffi type converters for types defined by external crates.

use reqwest::StatusCode;
use vowkey_uniffi_error::convert_result;

uniffi::custom_type!(StatusCode, u16, {
    remote,
    try_lift: |val| convert_result(StatusCode::from_u16(val)),
    lower: |obj| obj.as_u16(),
});
