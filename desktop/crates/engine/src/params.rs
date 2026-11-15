//! Reading command params. Params come from menus, scripts and agents: a missing key is `None`,
//! a key of the wrong type is an error that names it, and nothing here indexes or unwraps.

use serde_json::Value;

use crate::{EngineError, Result};

pub fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

fn wrong(key: &str, want: &str, got: &Value) -> EngineError {
    EngineError::BadParams(format!("`{key}` must be {want}, got {}", kind(got)))
}

fn missing(key: &str) -> EngineError {
    EngineError::BadParams(format!("`{key}` is required"))
}

pub fn str_param<'a>(p: &'a Value, key: &str) -> Result<Option<&'a str>> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(other) => Err(wrong(key, "a string", other)),
    }
}

pub fn req_str<'a>(p: &'a Value, key: &str) -> Result<&'a str> {
    str_param(p, key)?.ok_or_else(|| missing(key))
}

pub fn u64_param(p: &Value, key: &str) -> Result<Option<u64>> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v.as_u64().map(Some).ok_or_else(|| wrong(key, "a non-negative integer", v)),
    }
}

pub fn req_u64(p: &Value, key: &str) -> Result<u64> {
    u64_param(p, key)?.ok_or_else(|| missing(key))
}

pub fn bool_param(p: &Value, key: &str) -> Result<Option<bool>> {
    match p.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(other) => Err(wrong(key, "a boolean", other)),
    }
}
