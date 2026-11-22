use std::sync::{Arc, Mutex};

use super::*;

/// A configuration directory and a destination directory, both temporary.
struct Dirs {
    config: tempfile::TempDir,
    out: tempfile::TempDir,
}

fn dirs() -> Dirs {
    Dirs { config: tempfile::tempdir().unwrap(), out: tempfile::tempdir().unwrap() }
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    names
}

fn journalled(config: &Path) -> Vec<PathBuf> {
    let bytes = std::fs::read(config.join(JOURNAL)).unwrap();
    serde_json::from_slice::<Journal>(&bytes).unwrap().files
}

#[test]
fn three_writes_in_order_then_finish_leave_the_bytes_at_the_destination_and_no_temporary_file() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let destination = d.out.path().join("report.txt");
    let handle = saves.begin(&destination).unwrap();
    assert_eq!(handle.len(), 32);
    assert!(handle.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{handle}");
    saves.write(&handle, b"one ").unwrap();
    saves.write(&handle, b"two ").unwrap();
    saves.write(&handle, b"three").unwrap();
    assert_eq!(names(d.out.path()).len(), 1, "only the temporary file exists before finish");
    assert!(!destination.exists());
    saves.finish(&handle).unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"one two three");
    assert_eq!(names(d.out.path()), ["report.txt"]);
    assert!(journalled(d.config.path()).is_empty());
}

#[test]
fn an_existing_destination_is_unchanged_until_finish_and_after_a_discard() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let destination = d.out.path().join("a.txt");
    std::fs::write(&destination, b"old").unwrap();

    let handle = saves.begin(&destination).unwrap();
    saves.write(&handle, b"new").unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"old");
    saves.discard(&handle).unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"old");
    assert_eq!(names(d.out.path()), ["a.txt"], "the temporary file is gone");
    assert!(journalled(d.config.path()).is_empty());

    let handle = saves.begin(&destination).unwrap();
    saves.write(&handle, b"new").unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"old", "still old before finish");
    saves.finish(&handle).unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"new");
}

#[test]
fn an_empty_save_creates_an_empty_file() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let destination = d.out.path().join("empty");
    let handle = saves.begin(&destination).unwrap();
    saves.finish(&handle).unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"");
}

#[test]
fn a_spent_or_unknown_handle_is_an_error_everywhere() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let handle = saves.begin(&d.out.path().join("a")).unwrap();
    saves.write(&handle, b"x").unwrap();
    saves.finish(&handle).unwrap();
    assert_eq!(saves.write(&handle, b"y"), Err(SaveError::UnknownHandle), "write after finish");
    assert_eq!(saves.finish(&handle), Err(SaveError::UnknownHandle), "second finish");
    assert_eq!(saves.discard(&handle), Err(SaveError::UnknownHandle), "discard after finish");
    assert_eq!(std::fs::read(d.out.path().join("a")).unwrap(), b"x", "and the file is as finished");

    let other = saves.begin(&d.out.path().join("b")).unwrap();
    saves.discard(&other).unwrap();
    assert_eq!(saves.write(&other, b"y"), Err(SaveError::UnknownHandle), "write after discard");
    assert_eq!(saves.finish(&other), Err(SaveError::UnknownHandle), "finish after discard");
    assert_eq!(saves.discard(&other), Err(SaveError::UnknownHandle), "second discard");

    for unknown in ["", "nope", &"0".repeat(32), "../../etc/passwd"] {
        assert_eq!(saves.write(unknown, b"y"), Err(SaveError::UnknownHandle), "{unknown}");
        assert_eq!(saves.finish(unknown), Err(SaveError::UnknownHandle), "{unknown}");
        assert_eq!(saves.discard(unknown), Err(SaveError::UnknownHandle), "{unknown}");
    }
    assert_eq!(names(d.out.path()), ["a"]);
}

#[test]
fn a_write_over_sixteen_mebibytes_is_refused_and_exactly_that_is_taken() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let handle = saves.begin(&d.out.path().join("big")).unwrap();
    let chunk = vec![7_u8; MAX_WRITE_BYTES];
    saves.write(&handle, &chunk).unwrap();
    let refused = saves.write(&handle, &vec![7_u8; MAX_WRITE_BYTES + 1]);
    assert_eq!(refused, Err(SaveError::TooLarge(MAX_WRITE_BYTES + 1)));
    assert!(refused.unwrap_err().to_string().contains("smaller chunks"));
    saves.finish(&handle).unwrap();
    assert_eq!(std::fs::metadata(d.out.path().join("big")).unwrap().len(), MAX_WRITE_BYTES as u64, "the refused write wrote nothing");
}

#[test]
fn a_ninth_open_save_is_refused_until_one_is_over() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let handles: Vec<String> = (0..MAX_OPEN).map(|i| saves.begin(&d.out.path().join(format!("f{i}"))).unwrap()).collect();
    assert_eq!(handles.iter().collect::<std::collections::HashSet<_>>().len(), MAX_OPEN, "handles are distinct");
    assert_eq!(saves.begin(&d.out.path().join("ninth")), Err(SaveError::TooManyOpen));
    assert_eq!(names(d.out.path()).len(), MAX_OPEN, "the refused save created no file");
    saves.discard(&handles[3]).unwrap();
    let ninth = saves.begin(&d.out.path().join("ninth")).unwrap();
    saves.finish(&ninth).unwrap();
    assert_eq!(journalled(d.config.path()).len(), MAX_OPEN - 1);
}

#[test]
fn begin_refuses_a_destination_that_cannot_be_written_beside() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    for destination in [Path::new(""), Path::new("/"), Path::new("relative-name-only")] {
        assert_eq!(saves.begin(destination), Err(SaveError::BadDestination), "{destination:?}");
    }
    let missing_folder = d.out.path().join("no-such-folder").join("a.txt");
    assert!(matches!(saves.begin(&missing_folder), Err(SaveError::Io(_))));
    assert_eq!(names(d.out.path()), Vec::<String>::new());
    assert!(journalled(d.config.path()).is_empty(), "a refused save is not journalled");
}

#[test]
fn an_error_never_names_a_path() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let missing_folder = d.out.path().join("no-such-folder").join("a.txt");
    let text = saves.begin(&missing_folder).unwrap_err().to_string();
    assert!(!text.contains(d.out.path().to_str().unwrap()), "{text}");
}

#[test]
fn a_finish_that_cannot_rename_fails_removes_the_temporary_file_and_spends_the_handle() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    // A directory cannot be replaced by a file.
    let destination = d.out.path().join("taken");
    std::fs::create_dir(&destination).unwrap();
    std::fs::write(destination.join("inner"), b"keep").unwrap();
    let handle = saves.begin(&destination).unwrap();
    saves.write(&handle, b"x").unwrap();
    assert!(matches!(saves.finish(&handle), Err(SaveError::Io(_))));
    assert_eq!(names(d.out.path()), ["taken"]);
    assert_eq!(std::fs::read(destination.join("inner")).unwrap(), b"keep");
    assert_eq!(saves.write(&handle, b"y"), Err(SaveError::UnknownHandle));
    assert!(journalled(d.config.path()).is_empty());
}

#[test]
fn the_temporary_file_is_named_beside_the_destination_and_listed_in_the_journal_while_the_save_is_open() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let handle = saves.begin(&d.out.path().join("a.txt")).unwrap();
    let temp = names(d.out.path());
    assert_eq!(temp.len(), 1);
    assert!(temp[0].starts_with(".pistudio-save-") && temp[0].ends_with(".part"), "{temp:?}");
    assert!(!temp[0].contains(&handle), "the handle is not in a name on disk");
    assert_eq!(journalled(d.config.path()), [d.out.path().join(&temp[0])]);
    saves.discard(&handle).unwrap();
}

#[test]
fn a_temporary_file_listed_in_the_journal_is_removed_at_the_next_launch_and_the_journal_is_emptied() {
    let d = dirs();
    let first = Saves::open(d.config.path(), None);
    let one = first.begin(&d.out.path().join("one.bin")).unwrap();
    first.write(&one, b"partial").unwrap();
    let other = tempfile::tempdir().unwrap();
    let two = first.begin(&other.path().join("two.bin")).unwrap();
    first.write(&two, b"partial").unwrap();
    assert_eq!(journalled(d.config.path()).len(), 2);
    // The app is killed: nothing runs `Drop`.
    std::mem::forget(first);
    assert_eq!(names(d.out.path()).len(), 1);

    let second = Saves::open(d.config.path(), None);
    assert_eq!(names(d.out.path()), Vec::<String>::new());
    assert_eq!(names(other.path()), Vec::<String>::new());
    assert!(journalled(d.config.path()).is_empty());
    assert_eq!(second.write(&one, b"x"), Err(SaveError::UnknownHandle), "handles do not survive a launch");
}

#[test]
fn the_launch_cleanup_removes_only_files_named_like_a_temporary_save_file() {
    let d = dirs();
    let precious = d.out.path().join("precious.txt");
    let near = d.out.path().join(".pistudio-save-notes.txt");
    let stale = d.out.path().join(".pistudio-save-00112233445566778899aabbccddeeff.part");
    for file in [&precious, &near, &stale] {
        std::fs::write(file, b"x").unwrap();
    }
    let journal = Journal { files: vec![precious.clone(), near.clone(), stale.clone(), d.out.path().join("missing.part")] };
    std::fs::write(d.config.path().join(JOURNAL), serde_json::to_vec(&journal).unwrap()).unwrap();
    let _saves = Saves::open(d.config.path(), None);
    assert_eq!(names(d.out.path()), [".pistudio-save-notes.txt", "precious.txt"]);
    assert!(journalled(d.config.path()).is_empty());
}

#[test]
fn a_damaged_or_missing_journal_does_not_stop_the_launch() {
    let d = dirs();
    let _fresh = Saves::open(d.config.path(), None);
    assert!(!d.config.path().join(JOURNAL).exists(), "nothing to clean up: no file is created");
    std::fs::write(d.config.path().join(JOURNAL), b"{not json").unwrap();
    let saves = Saves::open(d.config.path(), None);
    assert!(journalled(d.config.path()).is_empty());
    let handle = saves.begin(&d.out.path().join("a")).unwrap();
    saves.finish(&handle).unwrap();
    assert_eq!(names(d.out.path()), ["a"]);
}

#[test]
fn a_save_that_is_dropped_open_leaves_no_temporary_file() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let handle = saves.begin(&d.out.path().join("a")).unwrap();
    saves.write(&handle, b"x").unwrap();
    drop(saves);
    assert_eq!(names(d.out.path()), Vec::<String>::new());
}

#[test]
fn a_save_that_cannot_be_journalled_does_not_start_and_leaves_no_file() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    // A directory where the journal file belongs: it cannot be replaced.
    std::fs::create_dir(d.config.path().join(JOURNAL)).unwrap();
    assert!(matches!(saves.begin(&d.out.path().join("a")), Err(SaveError::Io(_))));
    assert_eq!(names(d.out.path()), Vec::<String>::new());
}

/// What the save dialog was shown with: the suggested name and the starting folder.
type DialogAsk = (String, Option<PathBuf>);

fn picking(result: Option<PathBuf>) -> (Services, Arc<Mutex<Vec<DialogAsk>>>) {
    let asked = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&asked);
    let hook = move |name: &str, folder: Option<&Path>| {
        log.lock().unwrap().push((name.to_string(), folder.map(Path::to_path_buf)));
        result.clone()
    };
    (Services { pick_save_path: Some(Arc::new(hook)), ..Services::default() }, asked)
}

#[test]
fn a_cancelled_dialog_begins_nothing_and_a_missing_hook_is_an_error() {
    let d = dirs();
    let saves = Saves::open(d.config.path(), None);
    let (services, asked) = picking(None);
    assert_eq!(saves.choose(&services, "a.txt"), Ok(None));
    assert_eq!(asked.lock().unwrap().len(), 1);
    assert_eq!(names(d.out.path()), Vec::<String>::new());
    assert_eq!(saves.choose(&Services::default(), "a.txt"), Err(SaveError::Unavailable));
}

#[test]
fn the_dialog_gets_a_bare_name_and_starts_in_the_last_folder_else_downloads() {
    let d = dirs();
    let downloads = tempfile::tempdir().unwrap();
    let saves = Saves::open(d.config.path(), Some(downloads.path().to_path_buf()));
    let destination = d.out.path().join("x.txt");
    let (services, asked) = picking(Some(destination.clone()));

    let handle = saves.choose(&services, "../../x.txt").unwrap().unwrap();
    saves.finish(&handle).unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"");
    let handle = saves.choose(&services, "y.txt").unwrap().unwrap();
    saves.discard(&handle).unwrap();

    let asked = asked.lock().unwrap();
    assert_eq!(asked[0], ("x.txt".to_string(), Some(downloads.path().to_path_buf())), "first: Downloads");
    assert_eq!(asked[1], ("y.txt".to_string(), Some(d.out.path().to_path_buf())), "then: where the last save went");

    let nowhere = Saves::open(d.config.path(), None);
    assert_eq!(nowhere.start_folder(), None);
}

#[test]
fn a_cancelled_dialog_does_not_change_the_starting_folder() {
    let d = dirs();
    let downloads = tempfile::tempdir().unwrap();
    let saves = Saves::open(d.config.path(), Some(downloads.path().to_path_buf()));
    let (services, _) = picking(None);
    assert_eq!(saves.choose(&services, "a").unwrap(), None);
    assert_eq!(saves.start_folder(), Some(downloads.path().to_path_buf()));
}

#[test]
fn a_suggested_name_becomes_a_bare_file_name() {
    assert_eq!(file_name("../../x"), "x");
    assert_eq!(file_name("a/b.txt"), "b.txt");
    assert_eq!(file_name("a\nb.txt"), "ab.txt");
    assert_eq!(file_name(""), "download");
    assert_eq!(file_name("report.pdf"), "report.pdf");
    assert_eq!(file_name("/etc/passwd"), "passwd");
    assert_eq!(file_name("C:\\Users\\me\\a.txt"), "a.txt");
    assert_eq!(file_name("dir/"), "dir", "a trailing separator names the last folder, not a path");
    assert_eq!(file_name("a/../.."), "a");
    for nothing in ["..", ".", "/", "\\", "../", "  ", "\n\t", "\u{0}", "/../.."] {
        assert_eq!(file_name(nothing), "download", "{nothing:?}");
    }
    assert_eq!(file_name("  padded name .txt  "), "padded name .txt");
    assert_eq!(file_name("tab\there\u{7f}\u{85}.md"), "tabhere.md");
    assert_eq!(file_name("héllo wörld.txt"), "héllo wörld.txt");
}

#[test]
fn a_long_name_is_cut_to_255_bytes_on_a_character_boundary_and_keeps_its_extension() {
    let long = format!("{}.txt", "a".repeat(400));
    let name = file_name(&long);
    assert_eq!(name.len(), 255);
    assert!(name.ends_with("aaaa.txt"));

    let wide = format!("{}.md", "é".repeat(300));
    let name = file_name(&wide);
    assert!(name.len() <= 255 && name.ends_with("é.md"), "{} bytes", name.len());

    let no_extension = "😀".repeat(100);
    let name = file_name(&no_extension);
    assert!(name.len() <= 255 && name.len() > 250, "{} bytes", name.len());
    assert!(name.chars().all(|c| c == '😀'));

    let exactly = "b".repeat(255);
    assert_eq!(file_name(&exactly), exactly);

    // An "extension" too long to keep is cut like the rest.
    let odd = format!("a.{}", "x".repeat(400));
    assert_eq!(file_name(&odd).len(), 255);
}

fn shared(d: &Dirs) -> Arc<Saves> {
    Arc::new(Saves::open(d.config.path(), None))
}

#[test]
fn a_claimed_save_takes_pieces_counts_them_and_finish_leaves_the_bytes_and_nothing_else() {
    let d = dirs();
    let saves = shared(&d);
    let destination = d.out.path().join("report.txt");
    let handle = saves.begin(&destination).unwrap();
    let claimed = saves.claim(&handle).unwrap();
    assert_eq!(claimed.written(), 0);
    claimed.write(b"one ").unwrap();
    claimed.write(b"two ").unwrap();
    claimed.write(b"three").unwrap();
    assert_eq!(claimed.written(), 13);
    assert!(!destination.exists());
    assert_eq!(journalled(d.config.path()).len(), 1, "a claimed save is still listed");
    claimed.finish().unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"one two three");
    assert_eq!(names(d.out.path()), ["report.txt"]);
    assert!(journalled(d.config.path()).is_empty());
}

#[test]
fn a_claimed_save_may_take_more_than_one_page_write() {
    let d = dirs();
    let saves = shared(&d);
    let handle = saves.begin(&d.out.path().join("big")).unwrap();
    let claimed = saves.claim(&handle).unwrap();
    claimed.write(&vec![7_u8; MAX_WRITE_BYTES + 1]).unwrap();
    assert_eq!(claimed.written(), MAX_WRITE_BYTES as u64 + 1);
    claimed.discard().unwrap();
}

#[test]
fn a_discarded_or_dropped_claimed_save_leaves_no_temporary_file_and_the_destination_alone() {
    let d = dirs();
    let saves = shared(&d);
    let destination = d.out.path().join("a.txt");
    std::fs::write(&destination, b"old").unwrap();

    let claimed = saves.claim(&saves.begin(&destination).unwrap()).unwrap();
    claimed.write(b"new").unwrap();
    claimed.discard().unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"old");
    assert_eq!(names(d.out.path()), ["a.txt"]);
    assert!(journalled(d.config.path()).is_empty());

    let claimed = saves.claim(&saves.begin(&destination).unwrap()).unwrap();
    claimed.write(b"new").unwrap();
    assert_eq!(names(d.out.path()).len(), 2);
    drop(claimed);
    assert_eq!(std::fs::read(&destination).unwrap(), b"old");
    assert_eq!(names(d.out.path()), ["a.txt"]);
    assert!(journalled(d.config.path()).is_empty());
    // The destination is free again.
    let claimed = saves.claim(&saves.begin(&destination).unwrap()).unwrap();
    claimed.finish().unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"");
}

#[test]
fn a_second_claim_on_one_destination_is_busy_discards_that_save_and_a_new_save_works_after_the_first_ends() {
    let d = dirs();
    let saves = shared(&d);
    let destination = d.out.path().join("a.txt");
    let first = saves.claim(&saves.begin(&destination).unwrap()).unwrap();
    first.write(b"first").unwrap();

    let second = saves.begin(&destination).unwrap();
    assert_eq!(saves.claim(&second).err(), Some(SaveError::DestinationBusy));
    assert_eq!(names(d.out.path()).len(), 1, "the second save left no file");
    assert_eq!(journalled(d.config.path()).len(), 1);
    assert_eq!(saves.write(&second, b"x"), Err(SaveError::UnknownHandle), "and its handle is spent");
    assert_eq!(saves.claim(&second).err(), Some(SaveError::UnknownHandle));

    // Spelled differently, the same file.
    let alias = d.out.path().join(".").join("a.txt");
    assert_eq!(saves.claim(&saves.begin(&alias).unwrap()).err(), Some(SaveError::DestinationBusy));
    // Another destination is not busy.
    saves.claim(&saves.begin(&d.out.path().join("b.txt")).unwrap()).unwrap().discard().unwrap();

    first.finish().unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"first");
    let again = saves.claim(&saves.begin(&destination).unwrap()).unwrap();
    again.write(b"again").unwrap();
    again.finish().unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"again");
    assert_eq!(names(d.out.path()), ["a.txt"]);
    assert!(journalled(d.config.path()).is_empty());
}

#[test]
fn a_page_save_into_a_claimed_destination_is_not_refused_until_it_is_claimed() {
    let d = dirs();
    let saves = shared(&d);
    let destination = d.out.path().join("a.txt");
    let first = saves.claim(&saves.begin(&destination).unwrap()).unwrap();
    let page = saves.begin(&destination).unwrap();
    saves.write(&page, b"page").unwrap();
    saves.finish(&page).unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"page");
    first.discard().unwrap();
}

#[test]
fn the_page_cannot_use_a_claimed_handle() {
    let d = dirs();
    let saves = shared(&d);
    let handle = saves.begin(&d.out.path().join("a")).unwrap();
    let claimed = saves.claim(&handle).unwrap();
    claimed.write(b"x").unwrap();
    assert_eq!(saves.write(&handle, b"y"), Err(SaveError::UnknownHandle));
    assert_eq!(saves.finish(&handle), Err(SaveError::UnknownHandle));
    assert_eq!(saves.discard(&handle), Err(SaveError::UnknownHandle));
    assert_eq!(saves.claim(&handle).err(), Some(SaveError::UnknownHandle), "a handle is claimed once");
    // The refusals changed nothing: the engine's save still works.
    claimed.write(b"z").unwrap();
    claimed.finish().unwrap();
    assert_eq!(std::fs::read(d.out.path().join("a")).unwrap(), b"xz");
}

#[test]
fn claiming_an_unknown_or_spent_handle_is_an_unknown_handle_error() {
    let d = dirs();
    let saves = shared(&d);
    assert_eq!(saves.claim("nope").err(), Some(SaveError::UnknownHandle));
    let handle = saves.begin(&d.out.path().join("a")).unwrap();
    saves.finish(&handle).unwrap();
    assert_eq!(saves.claim(&handle).err(), Some(SaveError::UnknownHandle));
}

#[test]
fn a_claimed_save_still_counts_against_the_open_limit_until_it_ends() {
    let d = dirs();
    let saves = shared(&d);
    let mut claimed = Vec::new();
    for i in 0..MAX_OPEN {
        claimed.push(saves.claim(&saves.begin(&d.out.path().join(format!("f{i}"))).unwrap()).unwrap());
    }
    assert_eq!(saves.begin(&d.out.path().join("one-more")), Err(SaveError::TooManyOpen));
    claimed.pop().unwrap().discard().unwrap();
    saves.begin(&d.out.path().join("one-more")).unwrap();
}

#[test]
fn a_claimed_save_is_removed_at_the_next_launch_after_a_crash() {
    let d = dirs();
    let saves = shared(&d);
    let claimed = saves.claim(&saves.begin(&d.out.path().join("a")).unwrap()).unwrap();
    claimed.write(b"x").unwrap();
    let listed = journalled(d.config.path());
    assert_eq!(listed.len(), 1);
    assert!(listed[0].exists());
    // A crash runs no destructors: the files stay and the next launch finds the journal.
    std::mem::forget(claimed);
    std::mem::forget(saves);
    assert!(listed[0].exists());
    drop(Saves::open(d.config.path(), None));
    assert_eq!(names(d.out.path()), Vec::<String>::new());
    assert!(journalled(d.config.path()).is_empty());
}

#[test]
fn a_claimed_save_that_cannot_be_renamed_fails_and_removes_the_temporary_file() {
    let d = dirs();
    let saves = shared(&d);
    let destination = d.out.path().join("a");
    // A directory where the file belongs: the rename cannot replace it.
    std::fs::create_dir(&destination).unwrap();
    std::fs::write(destination.join("keep"), b"k").unwrap();
    let claimed = saves.claim(&saves.begin(&destination).unwrap()).unwrap();
    claimed.write(b"x").unwrap();
    assert!(matches!(claimed.finish(), Err(SaveError::Io(_))));
    assert_eq!(names(d.out.path()), ["a"]);
    assert!(journalled(d.config.path()).is_empty());
}
