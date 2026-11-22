//! Requests, their answers, and what happens to an answer that never comes.

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::time::{Instant, timeout};

use super::support::{ANSWERING, answer, assert_about, connect, request_id, rpc_error, upload_accepted};
use crate::connection::Connection;
use crate::error::Error;
use crate::wire::inbound::{Reply, UploadResponse};
use crate::wire::outbound;

type Asked = tokio::task::JoinHandle<Result<Reply, Error>>;

fn ask_to_upload(connection: &Arc<Connection>, path: &'static str) -> Asked {
    let connection = Arc::clone(connection);
    tokio::spawn(async move { connection.request(|id| outbound::upload_request(id, path, "t-1")).await })
}

#[tokio::test(start_paused = true)]
async fn a_request_gets_the_answer_that_carries_its_id() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let asked = ask_to_upload(&connection, "/tmp/a");
    let request = daemon.request().await;
    assert_eq!(request["type"], "file_upload_request");
    assert_eq!(request["path"], "/tmp/a");
    assert_eq!(request["transferId"], "t-1");
    assert_eq!(request["ack"], true);
    let id = request_id(&request);
    daemon.send_json(&upload_accepted(&id, 7));
    let reply = asked.await.unwrap().unwrap();
    assert_eq!(reply.request_id, id);
    assert_eq!(reply.upload_response().unwrap(), UploadResponse::Accepted { stream: 7 });
}

#[tokio::test(start_paused = true)]
async fn each_request_has_a_fresh_id() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let mut ids = Vec::new();
    for _ in 0..5 {
        let asked = ask_to_upload(&connection, "/tmp/a");
        let id = request_id(&daemon.request().await);
        daemon.send_json(&upload_accepted(&id, 1));
        asked.await.unwrap().unwrap();
        ids.push(id);
    }
    let mut unique = ids.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), ids.len(), "{ids:?}");
    assert!(ids.iter().all(|id| !id.is_empty()));
}

#[tokio::test(start_paused = true)]
async fn answers_are_matched_by_id_and_not_by_order() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let first = ask_to_upload(&connection, "/tmp/first");
    let second = ask_to_upload(&connection, "/tmp/second");
    let mut asked = [daemon.request().await, daemon.request().await];
    asked.sort_by_key(|request| request["path"].as_str().map(str::to_owned));
    let [first_request, second_request] = asked;
    // The daemon answers the second request first.
    daemon.send_json(&upload_accepted(&request_id(&second_request), 2));
    daemon.send_json(&upload_accepted(&request_id(&first_request), 1));
    assert_eq!(first.await.unwrap().unwrap().upload_response().unwrap(), UploadResponse::Accepted { stream: 1 });
    assert_eq!(second.await.unwrap().unwrap().upload_response().unwrap(), UploadResponse::Accepted { stream: 2 });
}

#[tokio::test(start_paused = true)]
async fn many_requests_in_flight_are_each_matched() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let mut asked = Vec::new();
    for _ in 0..40 {
        asked.push(ask_to_upload(&connection, "/tmp/a"));
    }
    let mut requests = Vec::new();
    for _ in 0..40 {
        requests.push(daemon.request().await);
    }
    // Answered in reverse; the stream carries the index of the request in the order it arrived.
    for (index, request) in requests.iter().enumerate().rev() {
        daemon.send_json(&upload_accepted(&request_id(request), u8::try_from(index).unwrap()));
    }
    let mut streams = Vec::new();
    for asked in asked {
        let UploadResponse::Accepted { stream } = asked.await.unwrap().unwrap().upload_response().unwrap() else { panic!("accepted") };
        streams.push(stream);
    }
    streams.sort_unstable();
    assert_eq!(streams, (0..40).collect::<Vec<u8>>(), "every answer went to a request, and none twice");
}

#[tokio::test(start_paused = true)]
async fn an_rpc_error_with_the_id_is_that_requests_error_and_only_its() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let failing = ask_to_upload(&connection, "/tmp/failing");
    let fine = ask_to_upload(&connection, "/tmp/fine");
    let mut requests = [daemon.request().await, daemon.request().await];
    requests.sort_by_key(|request| request["path"].as_str().map(str::to_owned));
    let [failing_request, fine_request] = requests;
    daemon.send_json(&rpc_error(&request_id(&failing_request), "handler_error", "no such file"));
    daemon.send_json(&upload_accepted(&request_id(&fine_request), 4));
    assert_eq!(failing.await.unwrap().unwrap_err(), Error::Rpc { code: "handler_error".into(), message: "no such file".into() });
    assert_eq!(fine.await.unwrap().unwrap().upload_response().unwrap(), UploadResponse::Accepted { stream: 4 });

    // The connection is as it was: the next request is answered.
    let next = ask_to_upload(&connection, "/tmp/a");
    daemon.accept_upload(9).await;
    assert!(next.await.unwrap().is_ok());
}

#[tokio::test(start_paused = true)]
async fn an_rpc_error_for_nobody_is_ignored() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let asked = ask_to_upload(&connection, "/tmp/a");
    let id = request_id(&daemon.request().await);
    daemon.send_json(&rpc_error("someone-else", "handler_error", "not yours"));
    daemon.send_json(&json!({ "type": "session", "message": { "type": "rpc_error", "code": "handler_error", "message": "no id at all" } }));
    daemon.send_json(&upload_accepted(&id, 3));
    assert!(asked.await.unwrap().is_ok());
}

#[tokio::test(start_paused = true)]
async fn an_answer_that_never_comes_fails_that_request_after_30_seconds_and_leaves_the_connection_open() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let start = Instant::now();
    let silent = ask_to_upload(&connection, "/tmp/silent");
    let silent_id = request_id(&daemon.request().await);
    let other = ask_to_upload(&connection, "/tmp/other");
    let other_id = request_id(&daemon.request().await);
    daemon.send_json(&upload_accepted(&other_id, 2));
    assert!(other.await.unwrap().is_ok(), "another request is answered meanwhile");

    assert_eq!(silent.await.unwrap().unwrap_err(), Error::Timeout);
    assert_about(start.elapsed(), Duration::from_secs(30));
    assert!(timeout(Duration::ZERO, connection.ended()).await.is_err(), "the connection is open");

    // The answer comes late: it is dropped, and the connection goes on.
    daemon.send_json(&upload_accepted(&silent_id, 9));
    let next = ask_to_upload(&connection, "/tmp/a");
    daemon.accept_upload(5).await;
    assert_eq!(next.await.unwrap().unwrap().upload_response().unwrap(), UploadResponse::Accepted { stream: 5 });
    assert!(timeout(Duration::ZERO, connection.ended()).await.is_err());
}

#[tokio::test(start_paused = true)]
async fn a_caller_that_stops_waiting_leaves_nothing_behind() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let abandoned = timeout(Duration::from_secs(1), connection.request(|id| outbound::upload_request(id, "/tmp/a", "t-1"))).await;
    assert!(abandoned.is_err(), "nobody answered within the second");
    let id = request_id(&daemon.request().await);
    daemon.send_json(&upload_accepted(&id, 1));

    let next = ask_to_upload(&connection, "/tmp/b");
    daemon.accept_upload(2).await;
    assert_eq!(next.await.unwrap().unwrap().upload_response().unwrap(), UploadResponse::Accepted { stream: 2 });
}

#[tokio::test(start_paused = true)]
async fn an_answer_of_the_wrong_kind_is_still_the_requests_answer_and_its_reader_says_so() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let asked = ask_to_upload(&connection, "/tmp/a");
    let id = request_id(&daemon.request().await);
    daemon.send_json(&answer(&id, "file_download_response", &json!({ "ok": false, "error": "not_found" })));
    let reply = asked.await.unwrap().unwrap();
    assert_eq!(reply.request_id, id);
    assert!(matches!(reply.upload_response().unwrap_err(), Error::Protocol(_)), "the typed reader checks the kind");
    assert!(reply.download_response().is_ok());
}
