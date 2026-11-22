//! The engine's two local ends: a file an upload reads, and a claimed save a download is written
//! into. Every call that touches the disk runs on the blocking pool, so that a slow disk or a
//! network share holds up one transfer and never the async runtime's workers.
//!
//! No error here carries a path: the text of an `io::Error` from the system names none, and the
//! messages written here name none either (the engine shows them to the page).

use std::fs::File;
use std::io::{self, Read as _, Seek as _, SeekFrom};
use std::mem;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use pistudiodesktop_shell::saves::ClaimedSave;
use pistudiodesktop_transfer::download::Sink;
use pistudiodesktop_transfer::upload::UploadSource;

/// Run `work` on the blocking pool. A task that ended abnormally is an error without a path.
async fn off_thread<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> io::Result<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|_| io::Error::other("the file work was interrupted"))
}

/// The size of the regular file behind `file`. A directory or a device is not something to upload.
fn regular_size(file: &File) -> io::Result<u64> {
    let meta = file.metadata()?;
    if meta.is_file() { Ok(meta.len()) } else { Err(io::Error::new(io::ErrorKind::InvalidInput, "it is not a regular file")) }
}

/// A file being uploaded. The size is the file's at the start of each attempt: [`Self::open`] and
/// [`UploadSource::rewind`] read the metadata, so a file that changed in between is found out by the
/// upload (`source_changed`), not hidden.
pub struct FileSource {
    /// `None` while a read or a rewind runs on the blocking pool, and after one was dropped (the
    /// engine does not use a source again after a cancel).
    file: Option<File>,
    /// What a read fills on the blocking pool, then copies from.
    scratch: Vec<u8>,
    size: u64,
}

impl FileSource {
    /// Open `path` for reading, on the blocking pool.
    ///
    /// # Errors
    /// The system's error, or that it is not a regular file.
    pub async fn open(path: PathBuf) -> io::Result<Self> {
        off_thread(move || {
            let file = File::open(path)?;
            let size = regular_size(&file)?;
            Ok(Self { file: Some(file), scratch: Vec::new(), size })
        })
        .await?
    }

    fn take_file(&mut self) -> io::Result<File> {
        self.file.take().ok_or_else(|| io::Error::other("the file is not open"))
    }
}

impl UploadSource for FileSource {
    fn size(&self) -> Option<u64> {
        Some(self.size)
    }

    async fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let (mut file, mut scratch) = (self.take_file()?, mem::take(&mut self.scratch));
        scratch.resize(buf.len(), 0);
        let (file, scratch, read) = off_thread(move || {
            let read = file.read(&mut scratch);
            (file, scratch, read)
        })
        .await?;
        let read = read?;
        buf[..read].copy_from_slice(&scratch[..read]);
        (self.file, self.scratch) = (Some(file), scratch);
        Ok(read)
    }

    async fn rewind(&mut self) -> io::Result<()> {
        let mut file = self.take_file()?;
        let (file, size) = off_thread(move || {
            let size = file.seek(SeekFrom::Start(0)).and_then(|_| regular_size(&file));
            (file, size)
        })
        .await?;
        self.size = size?;
        self.file = Some(file);
        Ok(())
    }
}

/// What a [`SaveSink`] and the blocking tasks it starts share. A write that the engine drops (a
/// cancel) goes on running on the blocking pool; the lock makes a later `discard` wait for it.
struct Shared {
    /// `None` once the save is finished or discarded.
    claimed: Mutex<Option<ClaimedSave>>,
    /// The bytes in the temporary file: what a resume asks the daemon to continue from.
    written: AtomicU64,
}

/// A claimed save as the engine's [`Sink`]: written, finished (renamed over the destination) or
/// discarded (the temporary file removed). Dropped unfinished, the save discards itself.
pub struct SaveSink {
    shared: Arc<Shared>,
}

impl SaveSink {
    #[must_use]
    pub fn new(claimed: ClaimedSave) -> Self {
        Self { shared: Arc::new(Shared { claimed: Mutex::new(Some(claimed)), written: AtomicU64::new(0) }) }
    }
}

fn gone() -> io::Error {
    io::Error::other("the save is already over")
}

impl Sink for SaveSink {
    fn written(&self) -> u64 {
        self.shared.written.load(Ordering::Acquire)
    }

    async fn write(&mut self, data: &[u8]) -> io::Result<()> {
        let (shared, data) = (Arc::clone(&self.shared), data.to_vec());
        off_thread(move || {
            let held = shared.claimed.lock().unwrap_or_else(PoisonError::into_inner);
            let claimed = held.as_ref().ok_or_else(gone)?;
            claimed.write(&data).map_err(|e| io::Error::other(e.to_string()))?;
            shared.written.store(claimed.written(), Ordering::Release);
            Ok(())
        })
        .await?
    }

    async fn finish(&mut self) -> io::Result<()> {
        let shared = Arc::clone(&self.shared);
        off_thread(move || {
            let claimed = shared.claimed.lock().unwrap_or_else(PoisonError::into_inner).take().ok_or_else(gone)?;
            claimed.finish().map_err(|e| io::Error::other(e.to_string()))
        })
        .await?
    }

    async fn discard(&mut self) {
        let shared = Arc::clone(&self.shared);
        // Without the lock held across the await: the blocking task takes it.
        let discarded = off_thread(move || {
            let claimed = shared.claimed.lock().unwrap_or_else(PoisonError::into_inner).take();
            claimed.map(ClaimedSave::discard)
        })
        .await;
        if let Ok(Some(Err(e))) = discarded {
            log::warn!("a save's temporary file could not be removed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use pistudiodesktop_shell::saves::{MAX_WRITE_BYTES, Saves};

    use super::*;

    fn run<T>(future: impl Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn a_file_is_read_whole_in_cut_reads_and_again_after_a_rewind_with_its_new_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.bin");
        std::fs::write(&path, b"0123456789").unwrap();
        run(async {
            let mut source = FileSource::open(path.clone()).await.unwrap();
            assert_eq!(source.size(), Some(10));
            let mut got = Vec::new();
            let mut buf = [0_u8; 4];
            loop {
                let read = source.read(&mut buf).await.unwrap();
                if read == 0 {
                    break;
                }
                got.extend_from_slice(&buf[..read]);
            }
            assert_eq!(got, b"0123456789");
            std::fs::write(&path, b"abc").unwrap();
            source.rewind().await.unwrap();
            assert_eq!(source.size(), Some(3), "the size is read again");
            let read = source.read(&mut buf).await.unwrap();
            assert_eq!(&buf[..read], b"abc");
        });
    }

    #[test]
    fn a_missing_file_and_a_directory_are_errors_that_name_no_path() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("no-such-file-marker-3f9a");
        let error = run(FileSource::open(missing)).err().unwrap().to_string();
        assert!(!error.contains("marker-3f9a") && !error.contains(dir.path().to_str().unwrap()), "{error}");
        let error = run(FileSource::open(dir.path().to_path_buf())).err().unwrap().to_string();
        assert!(error.contains("not a regular file"), "{error}");
    }

    #[test]
    fn an_empty_file_has_size_zero_and_reads_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty");
        std::fs::write(&path, b"").unwrap();
        run(async {
            let mut source = FileSource::open(path).await.unwrap();
            assert_eq!(source.size(), Some(0));
            assert_eq!(source.read(&mut [0_u8; 8]).await.unwrap(), 0);
        });
    }

    fn claimed(dir: &std::path::Path, name: &str) -> (Arc<Saves>, ClaimedSave, PathBuf) {
        let saves = Arc::new(Saves::open(&dir.join("config"), None));
        let destination = dir.join(name);
        let handle = saves.begin(&destination).unwrap();
        let claimed = saves.claim(&handle).unwrap();
        (saves, claimed, destination)
    }

    #[test]
    fn a_sink_counts_what_it_wrote_and_finish_puts_the_file_in_place() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("config")).unwrap();
        let (_saves, claimed, destination) = claimed(dir.path(), "out.txt");
        run(async {
            let mut sink = SaveSink::new(claimed);
            assert_eq!(sink.written(), 0);
            sink.write(b"hello ").await.unwrap();
            sink.write(&vec![b'x'; MAX_WRITE_BYTES + 1]).await.unwrap();
            assert_eq!(sink.written(), 6 + MAX_WRITE_BYTES as u64 + 1, "the engine's writes are not held to the page's chunk limit");
            sink.finish().await.unwrap();
            assert!(sink.write(b"late").await.is_err(), "a finished save takes no more");
            sink.discard().await;
        });
        assert_eq!(std::fs::metadata(&destination).unwrap().len(), 6 + MAX_WRITE_BYTES as u64 + 1);
    }

    #[test]
    fn a_discarded_sink_leaves_the_old_file_and_no_temporary_file_and_a_second_discard_is_harmless() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("config")).unwrap();
        std::fs::write(dir.path().join("out.txt"), b"old").unwrap();
        let (_saves, claimed, destination) = claimed(dir.path(), "out.txt");
        run(async {
            let mut sink = SaveSink::new(claimed);
            sink.write(b"new").await.unwrap();
            sink.discard().await;
            sink.discard().await;
        });
        assert_eq!(std::fs::read(&destination).unwrap(), b"old");
        let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert!(names.iter().all(|name| !name.starts_with(".pistudio-save-")), "{names:?}");
    }
}
