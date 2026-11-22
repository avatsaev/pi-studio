use std::sync::{Arc, Mutex};

use super::*;

/// Services whose open dialog answers `chosen` and records the folder it was shown with.
fn picking(chosen: Vec<PathBuf>) -> (Services, Arc<Mutex<Vec<Option<PathBuf>>>>) {
    let asked = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&asked);
    let services = Services {
        pick_files: Some(Arc::new(move |folder: Option<&Path>| {
            log.lock().unwrap().push(folder.map(Path::to_path_buf));
            chosen.clone()
        })),
        ..Services::default()
    };
    (services, asked)
}

fn is_handle(text: &str) -> bool {
    text.len() == 32 && text.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn file_in(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

#[test]
fn three_picked_files_answer_a_handle_a_name_and_a_size_and_no_path() {
    let dir = tempfile::tempdir().unwrap();
    let paths = vec![file_in(dir.path(), "a.txt", b"abc"), file_in(dir.path(), "b.bin", b""), dir.path().join("missing.txt")];
    let (services, _) = picking(paths.clone());
    let picked = Picked::default();

    let files = picked.pick(&services).unwrap();

    assert_eq!(files.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["a.txt", "b.bin", "missing.txt"]);
    assert_eq!(files.iter().map(|f| f.size).collect::<Vec<_>>(), [Some(3), Some(0), None], "no size for a file that cannot be read");
    assert!(files.iter().all(|f| is_handle(&f.handle)), "{files:?}");
    let distinct: std::collections::HashSet<_> = files.iter().map(|f| &f.handle).collect();
    assert_eq!(distinct.len(), 3);
    let shown = format!("{files:?}");
    assert!(!shown.contains(dir.path().to_str().unwrap()), "no answer holds a path: {shown}");
    for (file, path) in files.iter().zip(&paths) {
        assert_eq!(picked.take(&file.handle).as_ref(), Some(path));
    }
}

#[test]
fn a_directory_has_no_size_and_a_path_without_a_file_name_is_skipped() {
    let dir = tempfile::tempdir().unwrap();
    let (services, _) = picking(vec![dir.path().to_path_buf(), PathBuf::from("/"), file_in(dir.path(), "ok.txt", b"x")]);
    let files = Picked::default().pick(&services).unwrap();
    assert_eq!(
        files.iter().map(|f| (f.name.clone(), f.size)).collect::<Vec<_>>(),
        [(dir.path().file_name().unwrap().to_string_lossy().into_owned(), None), ("ok.txt".to_string(), Some(1))]
    );
}

#[cfg(unix)]
#[test]
fn a_name_that_is_not_unicode_is_sent_with_replacement_characters() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt as _;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(OsString::from_vec(b"caf\xe9.txt".to_vec()));
    std::fs::write(&path, b"x").unwrap();
    let (services, _) = picking(vec![path]);
    let files = Picked::default().pick(&services).unwrap();
    assert_eq!(files[0].name, "caf\u{fffd}.txt");
    assert_eq!(files[0].size, Some(1));
}

#[test]
fn a_cancelled_dialog_answers_nothing_and_a_missing_hook_is_unavailable() {
    let (services, asked) = picking(Vec::new());
    let picked = Picked::default();
    assert_eq!(picked.pick(&services).unwrap(), Vec::new());
    assert_eq!(asked.lock().unwrap().len(), 1);
    assert_eq!(picked.pick(&Services::default()), Err(PickError::Unavailable));
}

#[test]
fn a_handle_can_be_taken_once_and_an_unknown_one_not_at_all() {
    let dir = tempfile::tempdir().unwrap();
    let path = file_in(dir.path(), "a.txt", b"a");
    let (services, _) = picking(vec![path.clone()]);
    let picked = Picked::default();
    let handle = picked.pick(&services).unwrap().remove(0).handle;

    assert_eq!(picked.take("00000000000000000000000000000000"), None);
    assert_eq!(picked.take(&handle), Some(path));
    assert_eq!(picked.take(&handle), None, "single use");
}

#[test]
fn the_1025th_unused_entry_drops_the_oldest() {
    let (services, _) = picking((0..MAX_UNUSED + 1).map(|n| PathBuf::from(format!("/pick/{n}.txt"))).skip(1).collect());
    let picked = Picked::default();
    let first = picked.pick(&services).unwrap();
    assert_eq!(first.len(), MAX_UNUSED);

    let (more, _) = picking(vec![PathBuf::from("/pick/new.txt")]);
    let newest = picked.pick(&more).unwrap().remove(0);

    assert_eq!(picked.take(&first[0].handle), None, "the oldest was dropped");
    assert_eq!(picked.take(&first[1].handle), Some(PathBuf::from("/pick/2.txt")));
    assert_eq!(picked.take(&newest.handle), Some(PathBuf::from("/pick/new.txt")));
    assert_eq!(picked.take(&first[MAX_UNUSED - 1].handle), Some(PathBuf::from(format!("/pick/{MAX_UNUSED}.txt"))));
}

#[test]
fn one_dialog_that_answers_more_than_the_limit_gives_handles_only_to_the_newest() {
    let (services, _) = picking((0..MAX_UNUSED + 5).map(|n| PathBuf::from(format!("/pick/{n}.txt"))).collect());
    let picked = Picked::default();
    let files = picked.pick(&services).unwrap();
    assert_eq!(files.len(), MAX_UNUSED);
    assert_eq!(files[0].name, "5.txt");
    assert!(files.iter().all(|f| picked.take(&f.handle).is_some()));
}

#[test]
fn clearing_drops_every_entry() {
    let (services, _) = picking(vec![PathBuf::from("/pick/a.txt"), PathBuf::from("/pick/b.txt")]);
    let picked = Picked::default();
    let files = picked.pick(&services).unwrap();
    picked.clear();
    assert!(files.iter().all(|f| picked.take(&f.handle).is_none()));
}

#[test]
fn the_dialog_starts_in_the_folder_of_the_last_pick_of_this_run() {
    let (services, asked) = picking(vec![PathBuf::from("/pick/one/a.txt"), PathBuf::from("/elsewhere/b.txt")]);
    let picked = Picked::default();
    picked.pick(&services).unwrap();
    picked.clear();
    picked.pick(&services).unwrap();
    assert_eq!(asked.lock().unwrap().clone(), [None, Some(PathBuf::from("/pick/one"))]);

    // A cancelled dialog does not forget the folder.
    let (cancelled, asked) = picking(Vec::new());
    picked.pick(&cancelled).unwrap();
    picked.pick(&cancelled).unwrap();
    assert_eq!(asked.lock().unwrap().clone(), [Some(PathBuf::from("/pick/one")), Some(PathBuf::from("/pick/one"))]);
}
