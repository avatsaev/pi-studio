use std::sync::Arc;

use pistudiodesktop_engine::Session;
use pistudiodesktop_model::is_usage_id;
use pistudiodesktop_secrets::MemoryStore;
use serde_json::{Value, json};

use super::*;
use crate::{Request, Services, control, page};

const T0: u64 = 1_800_000_000_000;
const HOUR: u64 = 60 * 60 * 1000;

fn facts() -> Facts {
    Facts { os: "linux".into(), arch: "x86_64".into(), version: "1.2.3".into(), install_kind: "appimage".into(), locale: Some("en-US".into()) }
}

fn hook() -> UsageHook {
    Arc::new(|_, _| Ok(()))
}

fn launch_at(now_ms: u64) -> Launch {
    Launch { now_ms, facts: facts(), ..Launch::default() }
}

/// An app on a writable folder, with a sender unless `hook` is false.
fn app_on(dir: &std::path::Path, with_hook: bool) -> AppShell {
    let (session, _) = Session::with_config_dir(dir, Arc::new(MemoryStore::new()));
    AppShell::new(session, Services { usage: with_hook.then(hook), ..Services::default() })
}

fn body(request: &UsageRequest) -> Value {
    serde_json::from_str(&request.body).unwrap()
}

fn switch(app: &mut AppShell, on: bool) {
    app.run("settings.set", json!({"key": "shareUsageData", "value": on})).unwrap();
}

mod blocking {
    use super::*;

    fn inputs(has_token: bool, test_build: bool, dnt: Option<&str>, ci: Option<&str>, scripted: bool) -> BlockInputs {
        BlockInputs { has_token, test_build, do_not_track: dnt.map(str::to_owned), ci: ci.map(str::to_owned), scripted }
    }

    #[test]
    fn a_build_without_a_token_is_blocked_whatever_else_holds() {
        for test_build in [false, true] {
            for dnt in [None, Some("1")] {
                for ci in [None, Some("true")] {
                    for scripted in [false, true] {
                        assert_eq!(blocked(&inputs(false, test_build, dnt, ci, scripted)), Some(Blocked::Build));
                    }
                }
            }
        }
    }

    #[test]
    fn the_order_is_do_not_track_then_ci_then_scripted() {
        assert_eq!(blocked(&inputs(true, false, Some("1"), Some("true"), true)), Some(Blocked::DoNotTrack));
        assert_eq!(blocked(&inputs(true, false, None, Some("true"), true)), Some(Blocked::Ci));
        assert_eq!(blocked(&inputs(true, false, None, None, true)), Some(Blocked::Scripted));
        assert_eq!(blocked(&inputs(true, false, None, None, false)), None);
    }

    #[test]
    fn do_not_track_is_off_only_when_unset_empty_or_zero() {
        for off in [None, Some(""), Some("0")] {
            assert_eq!(blocked(&inputs(true, false, off, None, false)), None, "{off:?}");
        }
        for on in ["1", "true", "yes", "00", " ", "false"] {
            assert_eq!(blocked(&inputs(true, false, Some(on), None, false)), Some(Blocked::DoNotTrack), "{on:?}");
        }
    }

    #[test]
    fn ci_is_off_when_unset_empty_false_or_zero() {
        for off in [None, Some(""), Some("false"), Some("0")] {
            assert_eq!(blocked(&inputs(true, false, None, off, false)), None, "{off:?}");
        }
        for on in ["1", "true", "yes", "True", "FALSE"] {
            assert_eq!(blocked(&inputs(true, false, None, Some(on), false)), Some(Blocked::Ci), "{on:?}");
        }
    }

    #[test]
    fn a_test_build_ignores_ci_and_scripted_but_not_do_not_track() {
        assert_eq!(blocked(&inputs(true, true, None, Some("true"), true)), None);
        assert_eq!(blocked(&inputs(true, true, Some("1"), Some("true"), true)), Some(Blocked::DoNotTrack));
        assert_eq!(blocked(&inputs(true, true, Some("0"), None, false)), None);
    }

    #[test]
    fn every_combination_matches_the_rule_written_out() {
        let values = [None, Some(""), Some("0"), Some("false"), Some("1")];
        for has_token in [false, true] {
            for test_build in [false, true] {
                for dnt in values {
                    for ci in values {
                        for scripted in [false, true] {
                            let expected = if !has_token {
                                Some(Blocked::Build)
                            } else if matches!(dnt, Some(v) if !v.is_empty() && v != "0") {
                                Some(Blocked::DoNotTrack)
                            } else if !test_build && matches!(ci, Some(v) if !v.is_empty() && v != "false" && v != "0") {
                                Some(Blocked::Ci)
                            } else if !test_build && scripted {
                                Some(Blocked::Scripted)
                            } else {
                                None
                            };
                            assert_eq!(
                                blocked(&inputs(has_token, test_build, dnt, ci, scripted)),
                                expected,
                                "{has_token} {test_build} {dnt:?} {ci:?} {scripted}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn an_app_without_the_hook_is_blocked_as_a_build() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), false);
        assert!(on_launch(&mut app, &launch_at(T0)).is_none());
        assert_eq!(app.usage.blocked(), Some(Blocked::Build));
        assert!(app.session.settings().usage_id.is_none(), "no ID is made while blocked");
    }

    #[test]
    fn names_in_json() {
        assert_eq!(json!([Blocked::Build, Blocked::DoNotTrack, Blocked::Ci, Blocked::Scripted]), json!(["build", "do_not_track", "ci", "scripted"]));
    }
}

mod schedule {
    use super::*;

    fn sending_run() -> (UsageRun, Settings) {
        (UsageRun::new(None, facts(), T0), Settings::default())
    }

    #[test]
    fn the_daily_event_is_due_at_24_hours_after_the_last_attempt() {
        let (mut run, settings) = sending_run();
        assert!(run.due_daily(&settings, T0), "no attempt yet");
        run.last_attempt_ms = Some(T0);
        assert!(!run.due_daily(&settings, T0), "right after the launch's event");
        assert!(!run.due_daily(&settings, T0 + HOUR));
        assert!(!run.due_daily(&settings, T0 + 23 * HOUR));
        assert!(run.due_daily(&settings, T0 + 24 * HOUR));
        assert!(run.due_daily(&settings, T0 + 5 * 24 * HOUR), "a wake after days");
    }

    #[test]
    fn a_clock_set_back_is_due() {
        let (mut run, settings) = sending_run();
        run.last_attempt_ms = Some(T0);
        assert!(run.due_daily(&settings, T0 - HOUR));
    }

    #[test]
    fn switched_off_nothing_is_due_and_switched_on_mid_run_the_first_check_is() {
        let (run, mut settings) = sending_run();
        settings.share_usage_data = false;
        assert!(!run.due_daily(&settings, T0 + 100 * HOUR));
        assert!(!run.sending(&settings));
        settings.share_usage_data = true;
        assert!(run.due_daily(&settings, T0 + HOUR));
    }

    #[test]
    fn a_blocked_run_is_never_due() {
        let run = UsageRun::new(Some(Blocked::Ci), facts(), T0);
        assert!(!run.due_daily(&Settings::default(), T0 + 100 * HOUR));
    }

    #[test]
    fn closed_is_taken_once_with_the_whole_seconds_of_the_run() {
        let (mut run, settings) = sending_run();
        assert_eq!(run.take_closed(&settings, T0 + 90_999), Some(90));
        assert_eq!(run.take_closed(&settings, T0 + 200_000), None);
    }

    #[test]
    fn closed_is_not_taken_while_switched_off_and_the_chance_is_gone() {
        let (mut run, mut settings) = sending_run();
        settings.share_usage_data = false;
        assert_eq!(run.take_closed(&settings, T0 + 1000), None);
        settings.share_usage_data = true;
        assert_eq!(run.take_closed(&settings, T0 + 2000), None);
    }

    #[test]
    fn a_launch_a_failed_attempt_and_a_tick_follow_the_rule_through_the_entry_points() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        let started = on_launch(&mut app, &launch_at(T0)).unwrap();
        assert_eq!(started.event, "app_started");
        assert!(on_tick(&mut app, T0 + HOUR).is_none());
        assert!(on_tick(&mut app, T0 + 23 * HOUR).is_none());
        // The launch's event failed in the app: an attempt counts all the same, so 24 h from launch.
        let daily = on_tick(&mut app, T0 + 24 * HOUR).unwrap();
        assert_eq!(daily.event, "app_daily");
        assert!(on_tick(&mut app, T0 + 25 * HOUR).is_none());
        assert!(on_tick(&mut app, T0 + 47 * HOUR).is_none());
        assert!(on_tick(&mut app, T0 + 10 * 24 * HOUR).is_some(), "a wake after days");
    }

    #[test]
    fn switched_on_mid_run_sends_no_started_and_the_next_tick_sends_daily() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        switch(&mut app, false);
        assert!(on_launch(&mut app, &launch_at(T0)).is_none());
        assert!(on_tick(&mut app, T0 + HOUR).is_none());
        switch(&mut app, true);
        assert_eq!(on_tick(&mut app, T0 + 2 * HOUR).unwrap().event, "app_daily");
        assert!(on_tick(&mut app, T0 + 3 * HOUR).is_none());
    }

    #[test]
    fn switched_off_mid_run_nothing_more_is_sent_not_even_closed() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        assert!(on_launch(&mut app, &launch_at(T0)).is_some());
        switch(&mut app, false);
        assert!(on_tick(&mut app, T0 + 48 * HOUR).is_none());
        assert!(on_close(&mut app, T0 + 49 * HOUR).is_none());
    }
}

mod closing {
    use super::*;

    #[test]
    fn one_closed_request_across_exit_and_update_restart() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        on_launch(&mut app, &launch_at(T0)).unwrap();
        let closed = on_close(&mut app, T0 + 125_400).unwrap();
        assert_eq!(closed.event, "app_closed");
        assert_eq!(closed.limit(), Duration::from_secs(2));
        assert_eq!(body(&closed)["batch"][0]["properties"]["duration_s"], 125);
        assert!(on_close(&mut app, T0 + 126_000).is_none(), "the exit after the update restart");
    }

    #[test]
    fn a_blocked_run_sends_no_closed() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        on_launch(&mut app, &Launch { do_not_track: Some("1".into()), ..launch_at(T0) });
        assert!(on_close(&mut app, T0 + 5000).is_none());
        assert!(app.session.settings().usage_id.is_none());
    }

    #[test]
    fn only_closed_has_the_short_limit() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        assert_eq!(on_launch(&mut app, &launch_at(T0)).unwrap().limit(), Duration::from_secs(10));
        assert_eq!(on_tick(&mut app, T0 + 24 * HOUR).unwrap().limit(), Duration::from_secs(10));
    }
}

mod event {
    use super::*;

    fn inputs<'a>(facts: &'a Facts, name: EventName, duration_s: Option<u64>) -> EventInputs<'a> {
        EventInputs {
            name,
            id: "123e4567-e89b-42d3-a456-426614174000",
            session: "223e4567-e89b-42d3-a456-426614174000",
            facts,
            counts: Counts { local: 1, direct: 2, relay: 3, ssh: 4 },
            duration_s,
            now_ms: 1_764_066_030_123,
            event_uuid: "323e4567-e89b-42d3-a456-426614174000",
            request_id: "423e4567-e89b-42d3-a456-426614174000",
        }
    }

    #[test]
    fn the_body_is_exactly_the_spec() {
        let f = facts();
        let request = build_request(&inputs(&f, EventName::Daily, None));
        assert_eq!(
            body(&request),
            json!({
                "created_at": "2025-11-25T10:20:30.123Z",
                "batch": [{
                    "event": "app_daily",
                    "uuid": "323e4567-e89b-42d3-a456-426614174000",
                    "distinct_id": "123e4567-e89b-42d3-a456-426614174000",
                    "timestamp": "2025-11-25T10:20:30.123Z",
                    "session_id": "223e4567-e89b-42d3-a456-426614174000",
                    "options": { "process_person_profile": false },
                    "properties": {
                        "os": "linux", "arch": "x86_64", "app_version": "1.2.3", "install_kind": "appimage", "locale": "en-US",
                        "daemons_local": 1, "daemons_direct": 2, "daemons_relay": 3, "daemons_ssh": 4,
                    },
                }],
            })
        );
        assert!(request.body.len() <= 2048);
    }

    #[test]
    fn closed_adds_duration_and_nothing_else() {
        let f = facts();
        let with = body(&build_request(&inputs(&f, EventName::Closed, Some(42))));
        let without = body(&build_request(&inputs(&f, EventName::Started, None)));
        assert_eq!(with["batch"][0]["event"], "app_closed");
        assert_eq!(with["batch"][0]["properties"]["duration_s"], 42);
        let mut props = with["batch"][0]["properties"].as_object().unwrap().clone();
        props.remove("duration_s");
        assert_eq!(&Value::Object(props), &without["batch"][0]["properties"]);
        assert!(without["batch"][0]["properties"].get("duration_s").is_none());
    }

    #[test]
    fn the_locale_is_left_out_when_unknown_empty_or_long() {
        for locale in [None, Some(String::new()), Some("x".repeat(36))] {
            let f = Facts { locale, ..facts() };
            let props = &body(&build_request(&inputs(&f, EventName::Started, None)))["batch"][0]["properties"];
            assert!(props.get("locale").is_none());
        }
        let f = Facts { locale: Some("x".repeat(35)), ..facts() };
        assert!(body(&build_request(&inputs(&f, EventName::Started, None)))["batch"][0]["properties"].get("locale").is_some());
    }

    #[test]
    fn the_headers_carry_the_spec_values() {
        let f = facts();
        let request = build_request(&inputs(&f, EventName::Daily, None));
        let header = |name: &str| request.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str());
        assert_eq!(header("Content-Type"), Some("application/json"));
        assert_eq!(header("User-Agent"), Some("pistudiodesktop/1.2.3"));
        assert_eq!(header("PostHog-Sdk-Info"), Some("pistudiodesktop/1.2.3"));
        assert_eq!(header("PostHog-Request-Id"), Some("423e4567-e89b-42d3-a456-426614174000"));
        assert_eq!(header("PostHog-Attempt"), Some("1"));
        assert_eq!(header("PostHog-Request-Timestamp"), Some("2025-11-25T10:20:30.123Z"));
        assert_eq!(request.headers.len(), 6, "the token's header is the app's");
    }

    #[test]
    fn rfc3339_covers_the_epoch_leap_days_and_the_end_of_a_year() {
        assert_eq!(rfc3339_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(rfc3339_ms(951_782_400_000 + 5), "2000-02-29T00:00:00.005Z");
        assert_eq!(rfc3339_ms(1_709_164_799_999), "2024-02-28T23:59:59.999Z");
        assert_eq!(rfc3339_ms(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
        assert_eq!(rfc3339_ms(1_767_225_599_000), "2025-12-31T23:59:59.000Z");
        assert_eq!(rfc3339_ms(4_102_444_800_000), "2100-01-01T00:00:00.000Z");
    }

    #[test]
    fn registry_entries_are_counted_and_none_of_their_text_is_sent() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        let added = |app: &mut AppShell, params: Value| app.run("daemon.add", params).unwrap();
        added(&mut app, json!({"kind": "direct", "name": "MARKER-NAME-ONE", "address": "marker-one.example:6767", "password": "MARKER-SECRET"}));
        added(&mut app, json!({"kind": "direct", "name": "MARKER-NAME-TWO", "address": "marker-two.example:6767"}));
        added(&mut app, json!({"kind": "ssh", "name": "MARKER-SSH", "host": "marker-host.example", "user": "marker-user"}));
        let request = on_launch(&mut app, &launch_at(T0)).unwrap();
        let props = &body(&request)["batch"][0]["properties"];
        assert_eq!(
            (props["daemons_local"].clone(), props["daemons_direct"].clone(), props["daemons_relay"].clone(), props["daemons_ssh"].clone()),
            (json!(1), json!(2), json!(0), json!(1))
        );
        let everything = format!("{} {:?}", request.body, request.headers);
        for marker in ["MARKER", "marker", "example"] {
            assert!(!everything.contains(marker), "{marker}");
        }
    }

    #[test]
    fn a_request_debug_shows_no_body() {
        let f = facts();
        let request = build_request(&inputs(&f, EventName::Started, None));
        let shown = format!("{request:?}");
        assert!(!shown.contains("123e4567") && shown.contains("app_started"));
    }

    #[test]
    fn a_request_survives_the_control_reply() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        let reply = app.answer(&Request::Usage(UsageOp::Launch(launch_at(T0))));
        let request = UsageRequest::from_reply(&reply).unwrap();
        assert_eq!(request.event, "app_started");
        assert_eq!(serde_json::to_value(&request).unwrap()["limitMs"], 10_000);
        let none = app.answer(&Request::Usage(UsageOp::Tick { now_ms: T0 + HOUR }));
        assert_eq!(none, json!({"ok": true, "result": null}));
        assert!(UsageRequest::from_reply(&none).is_none());
    }
}

mod id {
    use super::*;

    #[test]
    fn new_uuids_are_lower_case_hyphenated_v4_and_differ() {
        let (a, b) = (new_uuid().unwrap(), new_uuid().unwrap());
        assert!(is_usage_id(&a) && is_usage_id(&b));
        assert_ne!(a, b);
    }

    #[test]
    fn no_id_is_made_while_blocked_or_switched_off() {
        for case in 0..3 {
            let dir = tempfile::tempdir().unwrap();
            let mut app = app_on(dir.path(), case != 0);
            if case == 1 {
                switch(&mut app, false);
            }
            let launch = if case == 2 { Launch { ci: Some("true".into()), ..launch_at(T0) } } else { launch_at(T0) };
            assert!(on_launch(&mut app, &launch).is_none(), "{case}");
            assert!(on_tick(&mut app, T0 + 48 * HOUR).is_none());
            assert!(on_close(&mut app, T0 + 49 * HOUR).is_none());
            assert!(app.session.settings().usage_id.is_none(), "{case}");
            assert!(!dir.path().join("settings.json").exists() || !std::fs::read_to_string(dir.path().join("settings.json")).unwrap().contains("usageId"));
        }
    }

    #[test]
    fn the_first_send_stores_one_and_every_later_event_and_run_uses_it() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        let first = on_launch(&mut app, &launch_at(T0)).unwrap();
        let id = app.session.settings().usage_id.clone().unwrap();
        assert!(is_usage_id(&id));
        assert_eq!(body(&first)["batch"][0]["distinct_id"], id.as_str());
        let stored: Value = serde_json::from_str(&std::fs::read_to_string(dir.path().join("settings.json")).unwrap()).unwrap();
        assert_eq!(stored["usageId"], id.as_str(), "written before the request is handed out");
        let daily = on_tick(&mut app, T0 + 24 * HOUR).unwrap();
        assert_eq!(body(&daily)["batch"][0]["distinct_id"], id.as_str());
        // The ID is kept while the switch is off and on again, and across runs.
        switch(&mut app, false);
        switch(&mut app, true);
        let mut again = app_on(dir.path(), true);
        let next = on_launch(&mut again, &launch_at(T0 + 1000)).unwrap();
        assert_eq!(body(&next)["batch"][0]["distinct_id"], id.as_str());
        assert_ne!(body(&next)["batch"][0]["session_id"], body(&first)["batch"][0]["session_id"], "each run has its own session");
        assert_eq!(body(&daily)["batch"][0]["session_id"], body(&first)["batch"][0]["session_id"]);
    }

    #[test]
    fn an_invalid_stored_id_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        app.session.store_usage_id("not-an-id").unwrap();
        let request = on_launch(&mut app, &launch_at(T0)).unwrap();
        let id = app.session.settings().usage_id.clone().unwrap();
        assert!(is_usage_id(&id));
        assert_eq!(body(&request)["batch"][0]["distinct_id"], id.as_str());
    }

    #[test]
    fn a_failed_store_sends_nothing_and_counts_no_attempt_and_the_next_event_tries_again() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        let file = dir.path().join("settings.json");
        std::fs::create_dir_all(&file).unwrap();
        std::fs::write(file.join("keep"), b"k").unwrap();
        assert!(on_launch(&mut app, &launch_at(T0)).is_none());
        assert!(app.session.settings().usage_id.is_none());
        assert!(app.usage.due_daily(app.session.settings(), T0 + HOUR), "no attempt was made");
        std::fs::remove_dir_all(&file).unwrap();
        assert_eq!(on_tick(&mut app, T0 + HOUR).unwrap().event, "app_daily");
        assert!(app.session.settings().usage_id.is_some());
    }
}

mod views {
    use super::*;

    #[test]
    fn ui_inspect_has_no_id_and_boot_has_it_once_made() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        assert_eq!(page::boot(&mut app)["usage"], json!({"enabled": true, "sending": false, "blocked": "build"}), "before the launch");
        on_launch(&mut app, &launch_at(T0)).unwrap();
        let id = app.session.settings().usage_id.clone().unwrap();
        assert_eq!(page::boot(&mut app)["usage"], json!({"enabled": true, "sending": true, "id": id}));
        let inspected = control::handle(&mut app, "ui.inspect", &Value::Null);
        assert_eq!(inspected["result"]["usage"], json!({"enabled": true, "sending": true}));
        assert!(!inspected.to_string().contains(&id), "the ID is nowhere in ui.inspect");
    }

    #[test]
    fn the_view_says_off_and_why() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        on_launch(&mut app, &Launch { do_not_track: Some("1".into()), ..launch_at(T0) });
        switch(&mut app, false);
        assert_eq!(page::boot(&mut app)["usage"], json!({"enabled": false, "sending": false, "blocked": "do_not_track"}));
        switch(&mut app, true);
        assert_eq!(
            control::handle(&mut app, "ui.inspect", &Value::Null)["result"]["usage"],
            json!({"enabled": true, "sending": false, "blocked": "do_not_track"})
        );
    }

    #[test]
    fn an_invalid_stored_id_is_not_shown() {
        let dir = tempfile::tempdir().unwrap();
        let mut app = app_on(dir.path(), true);
        app.session.store_usage_id("garbage").unwrap();
        assert!(page::boot(&mut app)["usage"].get("id").is_none());
    }
}
