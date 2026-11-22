//! Reading typed fields out of a JSON object the daemon sent.
//!
//! The messages never repeat what the daemon sent: a field is named by the engine's own constant.

use serde_json::{Map, Value};

use crate::Error;

/// A JSON object.
pub(super) type Fields = Map<String, Value>;

/// The largest whole number a JSON number from the daemon can hold exactly (2^53 − 1). The
/// protocol's integer fields (`z.number().int()`) stop here, so a larger value is not the daemon's.
pub(super) const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// A protocol error with the engine's own words.
pub(super) fn broken(text: impl Into<String>) -> Error {
    Error::Protocol(text.into())
}

/// A field that is present and is not `null`.
fn present<'a>(fields: &'a Fields, key: &str) -> Option<&'a Value> {
    fields.get(key).filter(|value| !value.is_null())
}

pub(super) fn string(fields: &Fields, key: &'static str) -> Result<String, Error> {
    optional_string(fields, key)?.ok_or_else(|| broken(format!("`{key}` is missing")))
}

pub(super) fn optional_string(fields: &Fields, key: &'static str) -> Result<Option<String>, Error> {
    match present(fields, key) {
        None => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(broken(format!("`{key}` is not a string"))),
    }
}

pub(super) fn boolean(fields: &Fields, key: &'static str) -> Result<bool, Error> {
    match present(fields, key) {
        Some(Value::Bool(flag)) => Ok(*flag),
        Some(_) => Err(broken(format!("`{key}` is not true or false"))),
        None => Err(broken(format!("`{key}` is missing"))),
    }
}

pub(super) fn size(fields: &Fields, key: &'static str) -> Result<u64, Error> {
    optional_size(fields, key)?.ok_or_else(|| broken(format!("`{key}` is missing")))
}

pub(super) fn optional_size(fields: &Fields, key: &'static str) -> Result<Option<u64>, Error> {
    match present(fields, key) {
        None => Ok(None),
        Some(value) => match value.as_u64() {
            Some(number) if number <= MAX_SAFE_INTEGER => Ok(Some(number)),
            _ => Err(broken(format!("`{key}` is not a whole number from 0 to 2^53 - 1"))),
        },
    }
}

pub(super) fn stream(fields: &Fields, key: &'static str) -> Result<u8, Error> {
    optional_stream(fields, key)?.ok_or_else(|| broken(format!("`{key}` is missing")))
}

pub(super) fn optional_stream(fields: &Fields, key: &'static str) -> Result<Option<u8>, Error> {
    match present(fields, key) {
        None => Ok(None),
        Some(value) => match value.as_u64().and_then(|number| u8::try_from(number).ok()) {
            Some(number) => Ok(Some(number)),
            None => Err(broken(format!("`{key}` is not a stream from 0 to 255"))),
        },
    }
}
