//! A source over bytes in memory, for tests of the engine (this crate's and the app's).

use std::io;

use super::UploadSource;

/// An [`UploadSource`] that reads from a `Vec`. [`claiming`](Self::claiming) makes it report a size
/// other than its length, as a file does that changed after its size was read.
#[derive(Debug, Clone)]
pub struct MemorySource {
    data: Vec<u8>,
    at: usize,
    size: Option<u64>,
}

impl MemorySource {
    /// A source of `data` that reports its length as its size.
    pub fn new(data: impl Into<Vec<u8>>) -> Self {
        let data = data.into();
        let size = u64::try_from(data.len()).ok();
        Self { data, at: 0, size }
    }

    /// Reports `size` (`None`: unknown) instead of the length.
    #[must_use]
    pub fn claiming(mut self, size: Option<u64>) -> Self {
        self.size = size;
        self
    }
}

impl UploadSource for MemorySource {
    fn size(&self) -> Option<u64> {
        self.size
    }

    async fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let rest = self.data.get(self.at..).unwrap_or_default();
        let count = rest.len().min(buf.len());
        if let (Some(from), Some(to)) = (rest.get(..count), buf.get_mut(..count)) {
            to.copy_from_slice(from);
        }
        self.at += count;
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn it_reads_in_pieces_to_the_end() {
        let mut source = MemorySource::new(vec![1, 2, 3, 4, 5]);
        assert_eq!(source.size(), Some(5));
        let mut buf = [0u8; 2];
        assert_eq!(source.read(&mut buf).await.unwrap(), 2);
        assert_eq!(buf, [1, 2]);
        assert_eq!(source.read(&mut buf).await.unwrap(), 2);
        assert_eq!(source.read(&mut buf).await.unwrap(), 1);
        assert_eq!(buf[0], 5);
        assert_eq!(source.read(&mut buf).await.unwrap(), 0);
        assert_eq!(source.read(&mut buf).await.unwrap(), 0);
    }

    #[test]
    fn it_can_claim_another_size_or_none() {
        assert_eq!(MemorySource::new(vec![0; 3]).claiming(Some(9)).size(), Some(9));
        assert_eq!(MemorySource::new(vec![0; 3]).claiming(None).size(), None);
    }
}
