use russh::keys::PrivateKey;

use crate::config::{Agent, Target};
use crate::fixtures::{Fixture, limits, server, target, target_with_keys};
use crate::testing::{Behavior, ENCRYPTED_KEY, ENCRYPTED_KEY_PASSPHRASE, ed25519, encrypted_key, write_private};
use crate::{Environment, Error, MAX_ATTEMPTS, Secrets, Session, Tried, connect};

async fn go(fixture: &Fixture, target: &Target, secrets: &Secrets) -> Result<Session, Error> {
    connect(target, secrets, &fixture.env(), &fixture.known_hosts(), &limits()).await
}

fn password(text: &str) -> Secrets {
    Secrets { password: Some(text.to_owned()), passphrase: None }
}

fn passphrase(text: &str) -> Secrets {
    Secrets { password: None, passphrase: Some(text.to_owned()) }
}

fn accepting(key: &PrivateKey) -> impl FnOnce(&mut Behavior) + use<> {
    let public = key.public_key().clone();
    move |behavior| behavior.keys.push(public)
}

fn encrypted_file(fixture: &Fixture, name: &str) -> std::path::PathBuf {
    let file = fixture.home.join(".ssh").join(name);
    write_private(&file, ENCRYPTED_KEY.as_bytes()).expect("write key");
    file
}

#[tokio::test]
async fn a_key_file_logs_in() {
    let fixture = Fixture::new();
    let key = ed25519(1);
    let (server, _) = server(&fixture, 100, accepting(&key)).await;
    let file = fixture.key_file("id_work", &key);
    let session = go(&fixture, &target_with_keys(&server, &[&file]), &Secrets::default()).await.expect("login");
    assert!(!session.is_closed());
    assert!(server.seen().offered_key(key.public_key()));
}

#[tokio::test]
async fn a_default_key_file_is_tried_when_none_is_named() {
    let fixture = Fixture::new();
    let key = ed25519(1);
    let (server, _) = server(&fixture, 100, accepting(&key)).await;
    fixture.key_file("id_ed25519", &key);
    go(&fixture, &target(server.port()), &Secrets::default()).await.expect("the default key logs in");
}

#[tokio::test]
async fn an_encrypted_key_opens_with_the_stored_passphrase() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, accepting(&encrypted_key())).await;
    let file = encrypted_file(&fixture, "id_enc");
    go(&fixture, &target_with_keys(&server, &[&file]), &passphrase(ENCRYPTED_KEY_PASSPHRASE)).await.expect("login with the passphrase");
}

#[tokio::test]
async fn an_encrypted_key_without_its_passphrase_is_passphrase_needed() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, accepting(&encrypted_key())).await;
    let file = encrypted_file(&fixture, "id_enc");
    let target = target_with_keys(&server, &[&file]);
    for secrets in [Secrets::default(), passphrase("not the passphrase")] {
        let error = go(&fixture, &target, &secrets).await.expect_err("no passphrase");
        assert_eq!(error.code(), "passphrase_needed");
        assert!(matches!(&error, Error::PassphraseNeeded { hop: 0, file } if file == "id_enc"), "{error:?}");
        assert!(!error.to_string().contains("not the passphrase"));
    }
    assert_eq!(server.seen().attempts(), 0, "a key that cannot be opened is never offered");
}

#[tokio::test]
async fn a_key_that_needs_a_passphrase_gives_way_to_a_login_that_works() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, |behavior| behavior.password = Some("hunter2".to_owned())).await;
    let file = encrypted_file(&fixture, "id_enc");
    go(&fixture, &target_with_keys(&server, &[&file]), &password("hunter2")).await.expect("the password logs in");
}

#[tokio::test]
async fn a_password_logs_in() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, |behavior| behavior.password = Some("hunter2".to_owned())).await;
    go(&fixture, &target(server.port()), &password("hunter2")).await.expect("login");
    assert_eq!(server.seen().passwords, 1);
}

#[tokio::test]
async fn a_wrong_password_is_auth_failed_and_the_message_lists_what_was_tried() {
    let fixture = Fixture::new();
    let key = ed25519(3);
    let (server, _) = server(&fixture, 100, |behavior| behavior.password = Some("hunter2".to_owned())).await;
    let file = fixture.key_file("id_work", &key);
    let error = go(&fixture, &target_with_keys(&server, &[&file]), &password("wrong-secret")).await.expect_err("refused");
    assert_eq!(error.code(), "auth_failed");
    let Error::AuthFailed { hop: 0, tried } = &error else { panic!("{error:?}") };
    assert_eq!(tried, &[Tried::KeyFile("id_work".to_owned()), Tried::Password]);
    let text = error.to_string();
    assert!(text.contains("key file id_work") && text.contains("password"), "{text}");
    assert!(!text.contains("wrong-secret") && !text.contains(&fixture.home.to_string_lossy().into_owned()), "{text}");
}

#[tokio::test]
async fn nothing_to_try_is_auth_failed() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, |_| {}).await;
    let error = go(&fixture, &target(server.port()), &Secrets::default()).await.expect_err("nothing to offer");
    assert!(matches!(&error, Error::AuthFailed { tried, .. } if tried.is_empty()), "{error:?}");
}

#[tokio::test]
async fn a_named_key_file_that_is_missing_or_unreadable_is_key_unreadable() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, |_| {}).await;
    let missing = fixture.home.join(".ssh").join("id_gone");
    let garbage = fixture.home.join(".ssh").join("id_garbage");
    write_private(&garbage, b"this is not a key\n").expect("write file");
    for file in [&missing, &garbage] {
        let error = go(&fixture, &target_with_keys(&server, &[file]), &Secrets::default()).await.expect_err("unreadable");
        assert_eq!(error.code(), "key_unreadable");
        assert!(matches!(&error, Error::KeyUnreadable { hop: 0, .. }), "{error:?}");
        assert!(!error.to_string().contains(&fixture.home.to_string_lossy().into_owned()), "no directory in the message");
    }
}

#[tokio::test]
async fn an_unreadable_default_key_file_is_skipped() {
    let fixture = Fixture::new();
    let key = ed25519(4);
    let (server, _) = server(&fixture, 100, accepting(&key)).await;
    write_private(&fixture.home.join(".ssh").join("id_ed25519"), b"garbage\n").expect("write file");
    fixture.key_file("id_ecdsa", &key);
    go(&fixture, &target(server.port()), &Secrets::default()).await.expect("the next default key logs in");
}

#[cfg(unix)]
async fn agent_with(fixture: &Fixture, keys: &[PrivateKey]) -> (crate::testing::AgentSocket, Environment) {
    let socket = fixture.home.join("agent.sock");
    let agent = crate::testing::AgentSocket::start(&socket, keys).await.expect("agent");
    let mut env = fixture.env();
    env.vars.insert("SSH_AUTH_SOCK".to_owned(), agent.path().as_os_str().to_owned());
    (agent, env)
}

#[cfg(unix)]
fn agent_target(port: u16) -> Target {
    Target { agent: Agent::Default, ..target(port) }
}

#[cfg(unix)]
#[tokio::test]
async fn an_agent_signs_the_login() {
    let fixture = Fixture::new();
    let key = ed25519(2);
    let (server, _) = server(&fixture, 100, accepting(&key)).await;
    let (_agent, env) = agent_with(&fixture, std::slice::from_ref(&key)).await;
    connect(&agent_target(server.port()), &Secrets::default(), &env, &fixture.known_hosts(), &limits()).await.expect("login");
    assert!(server.seen().offered_key(key.public_key()));
}

#[cfg(unix)]
#[tokio::test]
async fn an_agent_with_no_identity_or_no_socket_is_skipped() {
    let fixture = Fixture::new();
    let key = ed25519(2);
    let (server, _) = server(&fixture, 100, accepting(&key)).await;
    let file = fixture.key_file("id_work", &key);
    let target = Target { agent: Agent::Default, ..target_with_keys(&server, &[&file]) };
    let (_agent, env) = agent_with(&fixture, &[]).await;
    connect(&target, &Secrets::default(), &env, &fixture.known_hosts(), &limits()).await.expect("the key file logs in");
    let mut missing = fixture.env();
    missing.vars.insert("SSH_AUTH_SOCK".to_owned(), fixture.home.join("nothing.sock").into_os_string());
    connect(&target, &Secrets::default(), &missing, &fixture.known_hosts(), &limits()).await.expect("no socket is no agent");
}

#[cfg(unix)]
#[tokio::test]
async fn the_order_is_agent_then_key_files_then_password() {
    let fixture = Fixture::new();
    let (agent_key, file_key) = (ed25519(5), ed25519(6));
    let (server, _) = server(&fixture, 100, |behavior| behavior.password = Some("hunter2".to_owned())).await;
    let (_agent, env) = agent_with(&fixture, std::slice::from_ref(&agent_key)).await;
    let file = fixture.key_file("id_work", &file_key);
    let target = Target { agent: Agent::Default, ..target_with_keys(&server, &[&file]) };
    connect(&target, &password("hunter2"), &env, &fixture.known_hosts(), &limits()).await.expect("the password logs in last");
    let seen = server.seen();
    let order: Vec<bool> = seen.offered.iter().map(|key| key.key_data() == agent_key.public_key().key_data()).collect();
    assert_eq!(order, [true, false], "the agent's key, then the file's");
    assert_eq!(seen.passwords, 1);
}

#[cfg(unix)]
#[tokio::test]
async fn a_login_that_works_stops_the_order() {
    let fixture = Fixture::new();
    let (agent_key, file_key) = (ed25519(5), ed25519(6));
    let (server, _) = server(&fixture, 100, accepting(&agent_key)).await;
    let (_agent, env) = agent_with(&fixture, std::slice::from_ref(&agent_key)).await;
    let file = fixture.key_file("id_work", &file_key);
    let target = Target { agent: Agent::Default, ..target_with_keys(&server, &[&file]) };
    connect(&target, &password("unused"), &env, &fixture.known_hosts(), &limits()).await.expect("the agent logs in");
    let seen = server.seen();
    assert!(!seen.offered_key(file_key.public_key()), "the key file is not offered");
    assert_eq!(seen.passwords, 0);
}

#[cfg(unix)]
#[tokio::test]
async fn identities_only_skips_the_agent() {
    let fixture = Fixture::new();
    let key = ed25519(2);
    let (server, _) = server(&fixture, 100, accepting(&key)).await;
    let (_agent, env) = agent_with(&fixture, std::slice::from_ref(&key)).await;
    let target = Target { identities_only: true, ..agent_target(server.port()) };
    let error = connect(&target, &Secrets::default(), &env, &fixture.known_hosts(), &limits()).await.expect_err("agent skipped");
    assert_eq!(error.code(), "auth_failed");
    assert!(!server.seen().offered_key(key.public_key()), "the agent's key is never offered");
    // The same agent logs in when IdentitiesOnly is off.
    connect(&agent_target(server.port()), &Secrets::default(), &env, &fixture.known_hosts(), &limits()).await.expect("agent");
}

#[tokio::test]
async fn at_most_six_attempts_are_made() {
    let fixture = Fixture::new();
    let seeds: Vec<u8> = (10..17).collect();
    let keys: Vec<PrivateKey> = seeds.iter().map(|seed| ed25519(*seed)).collect();
    let (server, _) = server(&fixture, 100, accepting(&keys[MAX_ATTEMPTS])).await;
    let files: Vec<std::path::PathBuf> = keys.iter().enumerate().map(|(index, key)| fixture.key_file(&format!("id_{index}"), key)).collect();
    let refs: Vec<&std::path::Path> = files.iter().map(std::path::PathBuf::as_path).collect();
    let error = go(&fixture, &target_with_keys(&server, &refs), &Secrets::default()).await.expect_err("the seventh key is never offered");
    assert_eq!(error.code(), "auth_failed");
    let seen = server.seen();
    assert_eq!(seen.attempts(), MAX_ATTEMPTS);
    assert!(!seen.offered_key(keys[MAX_ATTEMPTS].public_key()));
}

#[tokio::test]
async fn the_password_counts_against_the_limit() {
    let fixture = Fixture::new();
    let keys: Vec<PrivateKey> = (20..26).map(ed25519).collect();
    let (server, _) = server(&fixture, 100, |behavior| behavior.password = Some("hunter2".to_owned())).await;
    let files: Vec<std::path::PathBuf> = keys.iter().enumerate().map(|(index, key)| fixture.key_file(&format!("id_{index}"), key)).collect();
    let refs: Vec<&std::path::Path> = files.iter().map(std::path::PathBuf::as_path).collect();
    let error = go(&fixture, &target_with_keys(&server, &refs), &password("hunter2")).await.expect_err("six keys use the attempts up");
    assert_eq!(error.code(), "auth_failed");
    assert_eq!(server.seen().passwords, 0);
}

#[tokio::test]
async fn the_error_is_never_a_secret() {
    let fixture = Fixture::new();
    let (server, _) = server(&fixture, 100, |_| {}).await;
    let secrets = Secrets { password: Some("pw-secret".to_owned()), passphrase: Some("pp-secret".to_owned()) };
    let text = format!("{:?}", go(&fixture, &target(server.port()), &secrets).await.expect_err("refused"));
    assert!(!text.contains("pw-secret") && !text.contains("pp-secret"), "{text}");
    let shown = format!("{secrets:?}");
    assert!(!shown.contains("pw-secret") && !shown.contains("pp-secret"), "{shown}");
}
