//! A client of the stand-in daemon built on `wire` and dialled through `net`.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use pistudiodesktop_net::{DialError, Socket, dial};
use tokio_tungstenite::tungstenite::Message;

use crate::limits::MAX_MESSAGE_BYTES;
use crate::testing::StandInDaemon;
use crate::wire::binary::{self, BeginMeta, FileFrame};
use crate::wire::inbound::{DownloadAccepted, DownloadRefused, DownloadResponse, Inbound, Reply, ServerInfo, UploadComplete, UploadResponse};
use crate::wire::outbound::{self, DownloadRequest, IfUnchanged};

/// How long a test waits for a frame it expects.
const WAIT: Duration = Duration::from_secs(5);

/// What the client sees on its socket.
#[derive(Debug)]
pub enum Event {
    Text(String),
    Binary(Vec<u8>),
    /// A close frame, with its code.
    Closed(Option<u16>),
    /// The socket failed or ended with no close frame (a reset, a refused frame).
    Failed,
}

/// A file-transfer frame, owned.
#[derive(Debug, PartialEq, Eq)]
pub enum Got {
    Begin { stream: u8, meta: BeginMeta },
    Chunk { stream: u8, data: Vec<u8> },
    End { stream: u8, ok: bool },
    Error { stream: u8, message: String },
}

impl Got {
    pub fn read(bytes: &[u8]) -> Self {
        match binary::decode(bytes).expect("the stand-in sends frames `wire` can read") {
            FileFrame::Begin { stream, meta } => Self::Begin { stream, meta },
            FileFrame::Chunk { stream, data } => Self::Chunk { stream, data: data.to_vec() },
            FileFrame::End { stream, ok } => Self::End { stream, ok },
            FileFrame::Error { stream, message } => Self::Error { stream, message },
        }
    }
}

/// A download that was accepted, as it arrived.
#[derive(Debug)]
pub struct Downloaded {
    pub accepted: DownloadAccepted,
    pub frames: Vec<Got>,
}

impl Downloaded {
    /// The file bytes of every `Chunk`, in order.
    pub fn bytes(&self) -> Vec<u8> {
        self.frames.iter().flat_map(|frame| if let Got::Chunk { data, .. } = frame { data.clone() } else { Vec::new() }).collect()
    }

    /// The frames by kind: `Begin`, `Chunk`, `End`, `Error`.
    pub fn kinds(&self) -> Vec<&'static str> {
        self.frames
            .iter()
            .map(|frame| match frame {
                Got::Begin { .. } => "Begin",
                Got::Chunk { .. } => "Chunk",
                Got::End { .. } => "End",
                Got::Error { .. } => "Error",
            })
            .collect()
    }
}

pub struct Client {
    ws: Socket,
    next_id: u32,
    /// Skip binary frames while waiting for an answer: set when downloads run alongside requests.
    pub skip_binary: bool,
}

impl Client {
    /// Dials without a handshake.
    pub async fn open(url: &str, password: Option<&str>) -> Result<Self, DialError> {
        Self::open_limited(url, password, MAX_MESSAGE_BYTES).await
    }

    pub async fn open_limited(url: &str, password: Option<&str>, max_message_bytes: usize) -> Result<Self, DialError> {
        Ok(Self { ws: dial(url, password, WAIT, max_message_bytes).await?, next_id: 0, skip_binary: false })
    }

    /// Dials, sends `hello` and reads the `status`.
    pub async fn connect(daemon: &StandInDaemon) -> Self {
        let mut client = Self::open(&daemon.url(), None).await.expect("the stand-in accepts the dial");
        client.handshake().await;
        client
    }

    /// Sends `hello` and reads the `status`.
    pub async fn handshake(&mut self) -> ServerInfo {
        self.send(outbound::hello("client-1", "0.2.0-test")).await;
        match self.text().await {
            Inbound::ServerInfo(info) => info,
            other => panic!("expected the status, got {other:?}"),
        }
    }

    pub fn id(&mut self) -> String {
        self.next_id += 1;
        format!("req-{}", self.next_id)
    }

    pub async fn send(&mut self, text: String) {
        self.ws.send(Message::text(text)).await.expect("the socket takes the frame");
    }

    pub async fn send_binary(&mut self, frame: Vec<u8>) {
        self.ws.send(Message::binary(frame)).await.expect("the socket takes the frame");
    }

    /// The next thing on the socket, if one comes within `wait`.
    pub async fn event_within(&mut self, wait: Duration) -> Option<Event> {
        loop {
            let message = tokio::time::timeout(wait, self.ws.next()).await.ok()?;
            return Some(match message {
                Some(Ok(Message::Text(text))) => Event::Text(text.as_str().to_owned()),
                Some(Ok(Message::Binary(bytes))) => Event::Binary(bytes.to_vec()),
                Some(Ok(Message::Close(frame))) => Event::Closed(frame.map(|frame| u16::from(frame.code))),
                Some(Ok(_)) => continue,
                Some(Err(_)) | None => Event::Failed,
            });
        }
    }

    pub async fn event(&mut self) -> Event {
        self.event_within(WAIT).await.expect("the stand-in sent nothing within five seconds")
    }

    /// Nothing arrives within a short time.
    pub async fn assert_silent(&mut self) {
        if let Some(event) = self.event_within(Duration::from_millis(300)).await {
            panic!("expected silence, got {event:?}");
        }
    }

    pub async fn raw_text(&mut self) -> String {
        match self.event().await {
            Event::Text(text) => text,
            other => panic!("expected a text frame, got {other:?}"),
        }
    }

    pub async fn text(&mut self) -> Inbound {
        Inbound::parse(&self.raw_text().await).expect("the stand-in sends frames `wire` can read")
    }

    pub async fn raw_binary(&mut self) -> Vec<u8> {
        match self.event().await {
            Event::Binary(bytes) => bytes,
            other => panic!("expected a binary frame, got {other:?}"),
        }
    }

    pub async fn frame(&mut self) -> Got {
        Got::read(&self.raw_binary().await)
    }

    pub async fn reply(&mut self) -> Reply {
        loop {
            match self.event().await {
                Event::Binary(_) if self.skip_binary => {}
                Event::Text(text) => match Inbound::parse(&text).expect("the stand-in sends frames `wire` can read") {
                    Inbound::Reply(reply) => return reply,
                    other => panic!("expected an answer, got {other:?}"),
                },
                other => panic!("expected an answer, got {other:?}"),
            }
        }
    }

    /// Sends a text frame and reads the answer to it.
    pub async fn ask(&mut self, build: impl FnOnce(&str) -> String) -> Reply {
        let id = self.id();
        self.send(build(&id)).await;
        let reply = self.reply().await;
        assert_eq!(reply.request_id, id, "the answer names its request");
        reply
    }

    // ---- uploads ----

    pub async fn open_upload(&mut self, path: &str, transfer_id: &str) -> UploadResponse {
        let reply = self.ask(|id| outbound::upload_request(id, path, transfer_id)).await;
        reply.upload_response().expect("an upload answer")
    }

    /// Opens an upload and returns its stream.
    pub async fn accepted_upload(&mut self, path: &str, transfer_id: &str) -> u8 {
        match self.open_upload(path, transfer_id).await {
            UploadResponse::Accepted { stream } => stream,
            other => panic!("expected the upload to be accepted, got {other:?}"),
        }
    }

    /// `Begin`, the `Chunk`s of at most `chunk` bytes, and the `End` of an upload.
    pub async fn send_upload(&mut self, stream: u8, transfer_id: &str, data: &[u8], chunk: usize) {
        self.send_binary(binary::encode_begin(stream, transfer_id)).await;
        for piece in data.chunks(chunk) {
            self.send_binary(binary::encode_chunk(stream, piece).expect("a small chunk")).await;
        }
        self.send_binary(binary::encode_end(stream, true)).await;
    }

    pub async fn upload_complete(&mut self) -> UploadComplete {
        match self.text().await {
            Inbound::UploadComplete(complete) => complete,
            other => panic!("expected file_upload_complete, got {other:?}"),
        }
    }

    // ---- downloads ----

    pub async fn request_download(
        &mut self,
        path: &str,
        stream: Option<u8>,
        offset: Option<u64>,
        length: Option<u64>,
        if_unchanged: Option<IfUnchanged>,
    ) -> DownloadResponse {
        let id = self.id();
        self.send(outbound::download_request(&DownloadRequest { request_id: &id, path, stream, offset, length, if_unchanged })).await;
        let reply = self.reply().await;
        assert_eq!(reply.request_id, id);
        reply.download_response().expect("a download answer")
    }

    /// Asks for a file and, when it is accepted, reads its frames up to the `End` or `Error`.
    pub async fn download(&mut self, path: &str, offset: Option<u64>, length: Option<u64>) -> Result<Downloaded, DownloadRefused> {
        match self.request_download(path, None, offset, length, None).await {
            DownloadResponse::Accepted(accepted) => {
                let frames = self.stream_frames().await;
                Ok(Downloaded { accepted, frames })
            }
            DownloadResponse::Refused(refused) => Err(refused),
        }
    }

    /// The binary frames up to and including the first `End` or `Error`.
    pub async fn stream_frames(&mut self) -> Vec<Got> {
        let mut frames = Vec::new();
        loop {
            let frame = self.frame().await;
            let last = matches!(frame, Got::End { .. } | Got::Error { .. });
            frames.push(frame);
            if last {
                return frames;
            }
        }
    }
}
