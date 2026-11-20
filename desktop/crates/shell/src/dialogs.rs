//! Native confirm and alert for the page. The text is the page's, so it is capped before it
//! reaches the operating system: a native dialog sized by a megabyte of text would not be
//! usable, and some platforms refuse it.

use std::borrow::Cow;

use crate::Services;

/// The longest dialog text, in characters, ellipsis included.
pub const MAX_TEXT_CHARS: usize = 8192;

/// What replaces the end of a text that was cut.
const ELLIPSIS: char = '…';

/// `text` as a dialog may show it: unchanged up to [`MAX_TEXT_CHARS`] characters, longer text cut
/// to the first `MAX_TEXT_CHARS - 1` characters and an ellipsis, so that the result is exactly
/// `MAX_TEXT_CHARS` characters long. A cut never lands inside a multi-byte character.
pub fn cap_text(text: &str) -> Cow<'_, str> {
    // Characters are at most as many as bytes, so a short text needs no counting.
    if text.len() <= MAX_TEXT_CHARS {
        return Cow::Borrowed(text);
    }
    // Where the characters start: the one at `MAX_TEXT_CHARS - 1` is the first to go, and a character after
    // it means the text is over the cap. Counting stops there however long the text is.
    let mut starts = text.char_indices().map(|(at, _)| at).skip(MAX_TEXT_CHARS - 1);
    match (starts.next(), starts.next()) {
        (Some(cut), Some(_)) => match text.get(..cut) {
            Some(head) => Cow::Owned(format!("{head}{ELLIPSIS}")),
            None => Cow::Borrowed(text),
        },
        _ => Cow::Borrowed(text),
    }
}

/// Ask the user a yes/no question in a native dialog: `true` only for the affirmative button.
/// Closing the dialog, a missing hook and a failed dialog are all `false`, so the action the
/// question guards does not happen. The hook blocks until the dialog is closed: call this off the
/// thread that owns the session and off the UI thread.
pub fn confirm(services: &Services, message: &str) -> bool {
    services.confirm.as_ref().is_some_and(|hook| hook(&cap_text(message)))
}

/// Show `message` in a native dialog and return once it is closed. A missing hook drops the
/// message. Blocks like [`confirm`].
pub fn alert(services: &Services, message: &str) {
    if let Some(hook) = services.alert.as_ref() {
        hook(&cap_text(message));
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[test]
    fn text_up_to_the_cap_is_unchanged_and_not_copied() {
        for text in ["", "Delete file.txt?", &"a".repeat(MAX_TEXT_CHARS), &"é".repeat(MAX_TEXT_CHARS)] {
            assert!(matches!(cap_text(text), Cow::Borrowed(same) if same == text), "{} characters", text.chars().count());
        }
    }

    /// `cap_text` of `text`, owned, so a test can build the text in the call.
    fn capped(text: String) -> String {
        cap_text(&text).into_owned()
    }

    #[test]
    fn ten_thousand_characters_are_cut_to_the_cap_and_end_in_an_ellipsis() {
        let capped = capped("a".repeat(10_000));
        assert_eq!(capped.chars().count(), 8192);
        assert!(capped.ends_with('…'));
        assert_eq!(capped.trim_end_matches('…'), "a".repeat(8191));
    }

    #[test]
    fn one_character_over_the_cap_is_cut_too() {
        let capped = capped("b".repeat(MAX_TEXT_CHARS + 1));
        assert_eq!((capped.chars().count(), capped.ends_with('…')), (MAX_TEXT_CHARS, true));
    }

    #[test]
    fn a_cut_never_lands_inside_a_multi_byte_character() {
        // 4-byte characters: the cut is a character boundary however the bytes fall.
        let capped = capped("😀".repeat(9000));
        assert_eq!(capped.chars().count(), MAX_TEXT_CHARS);
        assert_eq!(capped.chars().filter(|c| *c == '😀').count(), MAX_TEXT_CHARS - 1);
        assert!(capped.ends_with('…'));
        // A short text that holds ellipses already is not a cut one.
        assert!(matches!(cap_text("……"), Cow::Borrowed("……")));
    }

    #[test]
    fn an_enormous_text_is_cut_without_being_counted_to_the_end() {
        assert_eq!(capped("x".repeat(32 * 1024 * 1024)).chars().count(), MAX_TEXT_CHARS);
    }

    /// Services whose confirm answers `answer` and whose alert and confirm record the text they got.
    fn recording(answer: bool) -> (Services, Arc<Mutex<Vec<String>>>) {
        let shown = Arc::new(Mutex::new(Vec::new()));
        let (for_confirm, for_alert) = (Arc::clone(&shown), Arc::clone(&shown));
        let record = |shown: &Arc<Mutex<Vec<String>>>, text: &str| {
            if let Ok(mut texts) = shown.lock() {
                texts.push(text.to_string());
            }
        };
        let services = Services {
            confirm: Some(Arc::new(move |text: &str| {
                record(&for_confirm, text);
                answer
            })),
            alert: Some(Arc::new(move |text: &str| record(&for_alert, text))),
            ..Services::default()
        };
        (services, shown)
    }

    fn shown(texts: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        texts.lock().map(|texts| texts.clone()).unwrap_or_default()
    }

    #[test]
    fn confirm_is_the_answer_of_the_hook_and_alert_reaches_it() {
        let (yes, yes_shown) = recording(true);
        let (no, _) = recording(false);
        assert!(confirm(&yes, "Delete file.txt?"));
        assert!(!confirm(&no, "Delete file.txt?"));
        alert(&yes, "Saved.");
        assert_eq!(shown(&yes_shown), ["Delete file.txt?", "Saved."]);
    }

    #[test]
    fn a_long_message_reaches_the_hook_capped() {
        let (services, texts) = recording(true);
        assert!(confirm(&services, &"a".repeat(10_000)));
        alert(&services, &"b".repeat(10_000));
        let texts = shown(&texts);
        assert_eq!(texts.iter().map(|t| t.chars().count()).collect::<Vec<_>>(), [MAX_TEXT_CHARS, MAX_TEXT_CHARS]);
        assert!(texts.iter().all(|t| t.ends_with('…')));
    }

    #[test]
    fn without_hooks_a_confirmation_is_declined_and_a_message_is_dropped() {
        let none = Services::default();
        assert!(!confirm(&none, "Delete file.txt?"));
        alert(&none, "Saved.");
    }
}
