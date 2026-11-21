#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum EngineError {
    #[error("unknown command `{0}`")]
    UnknownCommand(String),
    /// The command exists but cannot run now (what greys its menu item out).
    #[error("`{id}` is unavailable: {reason}")]
    Disabled { id: String, reason: String },
    #[error("bad params: {0}")]
    BadParams(String),
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, EngineError>;
