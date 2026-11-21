use std::collections::HashSet;

use super::*;

fn origin_store() -> Previews {
    Previews::new(Kind::Origin)
}

#[test]
fn the_origin_constant_is_the_scheme_and_the_host() {
    assert_eq!(ORIGIN, format!("{SCHEME}://{HOST}"));
}

#[test]
fn a_mounted_document_is_got_until_it_is_released() {
    let store = origin_store();
    let id = store.mount("<p>hi</p>".into()).unwrap();
    assert_eq!(store.get(&id).as_deref().map(String::as_str), Some("<p>hi</p>"));
    assert_eq!((store.len(), store.bytes()), (1, 9));
    store.release(&id);
    assert!(store.get(&id).is_none());
    assert_eq!((store.len(), store.bytes()), (0, 0));
    store.release(&id);
    store.release("not an id");
    assert!(store.is_empty(), "releasing an unknown id changes nothing");
}

#[test]
fn the_store_refuses_a_33rd_document_and_released_space_is_reusable() {
    let store = origin_store();
    let ids: Vec<String> = (0..MAX_DOCUMENTS).map(|n| store.mount(format!("doc {n}")).unwrap()).collect();
    assert_eq!(store.mount("one too many".into()), Err(MountError::TooMany));
    assert_eq!(store.len(), MAX_DOCUMENTS, "a refused mount keeps nothing");
    store.release(&ids[7]);
    assert!(store.mount("fits again".into()).is_ok());
    assert_eq!(store.mount("full again".into()), Err(MountError::TooMany));
}

#[test]
fn the_store_refuses_a_mount_that_passes_32_mib_and_released_space_is_reusable() {
    let store = origin_store();
    let half = "a".repeat(MAX_BYTES / 2);
    let first = store.mount(half.clone()).unwrap();
    store.mount(half).unwrap();
    assert_eq!(store.bytes(), MAX_BYTES);
    assert_eq!(store.mount("b".into()), Err(MountError::TooLarge), "one byte past the total");
    assert_eq!((store.len(), store.bytes()), (2, MAX_BYTES), "a refused mount keeps nothing");
    store.release(&first);
    assert!(store.mount("c".repeat(MAX_BYTES / 2)).is_ok(), "the released space is reusable");
    assert_eq!(store.mount("a".repeat(MAX_BYTES + 1)), Err(MountError::TooLarge), "one document over the cap");
    assert_eq!(store.mount(String::new()).map(|_| ()), Ok(()), "an empty document takes no space");
}

#[test]
fn ids_are_32_lowercase_hex_characters_and_never_collide() {
    let store = origin_store();
    let mut seen = HashSet::new();
    for _ in 0..10_000 {
        let id = store.mount("x".into()).unwrap();
        assert!(is_id(&id), "{id}");
        assert!(seen.insert(id.clone()), "{id} was made twice");
        store.release(&id);
    }
}

#[test]
fn clear_drops_every_document() {
    let store = origin_store();
    let id = store.mount("<p>hi</p>".into()).unwrap();
    store.clear();
    assert!(store.get(&id).is_none());
    assert_eq!((store.len(), store.bytes()), (0, 0));
    assert_eq!(store.serve("GET", &format!("/{id}")), not_found(), "a URL from before answers 404");
    assert!(store.mount("again".into()).is_ok(), "and the store is usable after");
}

#[test]
fn a_mounted_id_is_served_with_the_four_headers() {
    let store = origin_store();
    let id = store.mount("<script>1</script>".into()).unwrap();
    let served = store.serve("GET", &format!("/{id}"));
    assert_eq!(served.status, 200);
    assert_eq!(served.body, b"<script>1</script>");
    assert_eq!(
        served.headers,
        [
            ("Content-Type", "text/html; charset=utf-8"),
            ("Content-Security-Policy", "sandbox allow-scripts"),
            ("Cache-Control", "no-store"),
            ("X-Content-Type-Options", "nosniff"),
        ]
    );
}

#[test]
fn an_unknown_id_another_path_and_another_method_answer_404() {
    let store = origin_store();
    let id = store.mount("<p>hi</p>".into()).unwrap();
    let unknown = "0".repeat(32);
    let upper = id.to_uppercase();
    let refused = [
        ("GET", format!("/{unknown}")),
        ("GET", "/".to_string()),
        ("GET", String::new()),
        ("GET", id.clone()),
        ("GET", format!("/{id}/")),
        ("GET", format!("/{id}/extra")),
        ("GET", format!("/{id}x")),
        ("GET", format!("/{}", &id[1..])),
        ("GET", format!("/{upper}")),
        ("GET", "/index.html".to_string()),
        ("GET", "/../../etc/passwd".to_string()),
        ("POST", format!("/{id}")),
        ("HEAD", format!("/{id}")),
        ("get", format!("/{id}")),
        ("PUT", format!("/{id}")),
        ("DELETE", format!("/{id}")),
    ];
    for (method, path) in refused {
        let served = store.serve(method, &path);
        assert_eq!(served, not_found(), "{method} {path}");
        assert_eq!(served.status, 404);
        assert!(served.body.is_empty());
    }
    assert_eq!(store.serve("GET", &format!("/{id}")).status, 200, "and the document is still served");
}

#[test]
fn a_refusal_carries_no_document_and_still_isolates() {
    let refusal = not_found();
    assert!(refusal.headers.contains(&("Content-Security-Policy", "sandbox")));
    assert!(refusal.headers.contains(&("X-Content-Type-Options", "nosniff")));
}

#[test]
fn urls_are_built_and_read_back_in_one_form_only() {
    let id = "0123456789abcdef0123456789abcdef";
    let url = url_for(id);
    assert_eq!(url, "pi-preview://localhost/0123456789abcdef0123456789abcdef");
    assert_eq!(id_of(&url), Some(id));
    for other in [
        "",
        "pi-preview://localhost",
        "pi-preview://localhost/",
        "pi-preview://localhost/short",
        "pi-preview://localhost/0123456789abcdef0123456789abcdef/",
        "pi-preview://localhost/0123456789abcdef0123456789abcdef?x",
        "pi-preview://localhost:80/0123456789abcdef0123456789abcdef",
        "pi-preview://evil/0123456789abcdef0123456789abcdef",
        "http://pi-preview.localhost/0123456789abcdef0123456789abcdef",
        "tauri://localhost/0123456789abcdef0123456789abcdef",
    ] {
        assert_eq!(id_of(other), None, "{other}");
    }
}

#[test]
fn release_url_drops_only_a_url_of_the_origin() {
    let store = origin_store();
    let id = store.mount("a".into()).unwrap();
    let keep = store.mount("b".into()).unwrap();
    store.release_url("https://example.com/");
    store.release_url(&format!("tauri://localhost/{id}"));
    store.release_url("pi-preview://localhost/ffffffffffffffffffffffffffffffff");
    assert_eq!(store.len(), 2, "foreign and unknown URLs are ignored");
    store.release_url(&url_for(&id));
    assert!(store.get(&id).is_none());
    assert!(store.get(&keep).is_some());
}

#[test]
fn only_linux_is_measured_and_everything_else_is_inert() {
    assert_eq!(kind_for("linux"), Kind::Origin);
    for os in ["macos", "windows", "freebsd", "android", "ios", ""] {
        assert_eq!(kind_for(os), Kind::Inert, "{os:?}");
    }
    assert_eq!((Kind::Origin.as_str(), Kind::Inert.as_str()), ("origin", "inert"));
    assert_eq!(Previews::default().kind(), kind());
}

#[test]
fn an_inert_platform_refuses_every_mount() {
    let store = Previews::new(Kind::Inert);
    assert_eq!(store.mount("<p>hi</p>".into()), Err(MountError::Inert));
    assert!(store.is_empty());
    assert!(MountError::Inert.to_string().contains("not supported on this platform"));
}

#[test]
fn a_refusal_names_the_cap_and_never_the_document() {
    let secret = "SECRET-DOCUMENT-TEXT";
    let store = origin_store();
    for n in 0..MAX_DOCUMENTS {
        store.mount(format!("{secret}{n}")).unwrap();
    }
    let too_many = store.mount(secret.into()).unwrap_err().to_string();
    assert!(too_many.contains("32 previews"), "{too_many}");
    let too_large = Previews::new(Kind::Origin).mount("x".repeat(MAX_BYTES + 1)).unwrap_err().to_string();
    assert!(too_large.contains("32 MiB"), "{too_large}");
    assert!(!too_many.contains(secret) && !too_large.contains(secret));
}
