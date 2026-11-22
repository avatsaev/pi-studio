//! Which path file transfers take in this launch: the engine's (`engine`, the default) or the
//! page's own (`page`). `--transfers` sets it; it is fixed for the launch and `boot` reports it.

use std::str::FromStr;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TransfersMode {
    #[default]
    Engine,
    Page,
}

impl TransfersMode {
    /// The word the page sees in `boot.transfers`.
    pub fn as_str(self) -> &'static str {
        match self {
            TransfersMode::Engine => "engine",
            TransfersMode::Page => "page",
        }
    }
}

impl FromStr for TransfersMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "engine" => Ok(TransfersMode::Engine),
            "page" => Ok(TransfersMode::Page),
            other => Err(format!("`{}` is not a transfers mode; use `engine` or `page`", other.chars().take(32).collect::<String>())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_words_parse_and_the_default_is_the_engine() {
        assert_eq!("engine".parse(), Ok(TransfersMode::Engine));
        assert_eq!("page".parse(), Ok(TransfersMode::Page));
        assert_eq!(TransfersMode::default(), TransfersMode::Engine);
        assert_eq!(TransfersMode::Page.as_str(), "page");
    }

    #[test]
    fn any_other_word_is_refused() {
        for word in ["fast", "", "Engine", "page "] {
            assert!(word.parse::<TransfersMode>().is_err(), "{word:?}");
        }
    }
}
