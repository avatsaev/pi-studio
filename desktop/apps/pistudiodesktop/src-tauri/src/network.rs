//! The network watcher: a thread that reads the machine's interface addresses every 5 s and tells
//! the page (`connection_resume`, reason `network`) when the set changed. The pure change
//! detector, [`NetworkWatcher`], lives in the shell crate; this file reads the addresses and emits
//! through the rate limit the wake ticker shares ([`resume::emit`]).
//!
//! Addresses are not secrets, but they are not logged: the log says that the set changed and how
//! many addresses there are.

use std::collections::BTreeSet;
use std::io;
use std::net::IpAddr;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::thread;
use std::time::Duration;

use pistudiodesktop_shell::resume::{NETWORK_PERIOD_MS, NETWORK_QUIET_MS, NetworkWatcher, Reason, ResumeSignals};
use tauri::{AppHandle, Manager as _, RunEvent, Runtime};

use crate::resume::{self, steady_ms};

/// The addresses of the interfaces that are up, without loopback and link-local ones (an IPv6
/// link-local address is on every interface and comes and goes without a route changing).
fn read_addresses() -> io::Result<BTreeSet<IpAddr>> {
    Ok(if_addrs::get_if_addrs()?.into_iter().filter(|i| i.is_oper_up() && !i.is_loopback() && !i.is_link_local()).map(|i| i.ip()).collect())
}

/// Logs a failing reading once, and again only after one succeeded.
#[derive(Default)]
struct FailureLog {
    failing: bool,
}

impl FailureLog {
    fn record(&mut self, reading: &io::Result<BTreeSet<IpAddr>>) {
        match reading {
            Ok(_) => self.failing = false,
            Err(e) if !self.failing => {
                self.failing = true;
                log::warn!("the network addresses could not be read: {e}; skipping readings until one works");
            }
            Err(_) => {}
        }
    }
}

/// One reading. A failed one is skipped (logged once). Returns the wait until the next.
fn poll(watcher: &mut NetworkWatcher, failures: &mut FailureLog, reading: io::Result<BTreeSet<IpAddr>>, now_ms: u64, mut emit: impl FnMut(u64)) -> Duration {
    failures.record(&reading);
    if let Ok(addrs) = reading {
        let count = addrs.len();
        if watcher.observe(now_ms, addrs) {
            log::info!("the network addresses changed ({count} now)");
            emit(now_ms);
        }
    }
    Duration::from_millis(if watcher.is_settling() { NETWORK_QUIET_MS } else { NETWORK_PERIOD_MS })
}

/// The wait to the next reading, cut short to when the rate limit lets a deferred signal through.
fn sooner_if_pending(wait: Duration, pending_wait_ms: Option<u64>) -> Duration {
    // At least 1 ms: a limit that is open is flushed by the next loop, not by spinning.
    pending_wait_ms.map_or(wait, |ms| wait.min(Duration::from_millis(ms.max(1))))
}

/// Call `work` after each wait it returns, until `stop` is signalled or its sender is gone. The
/// wait is the channel's timeout, so a stop is heard at once.
fn run_until_stopped(stop: &Receiver<()>, first: Duration, mut work: impl FnMut() -> Duration) {
    let mut wait = first;
    while matches!(stop.recv_timeout(wait), Err(RecvTimeoutError::Timeout)) {
        wait = work();
    }
}

/// Start the thread; it ends with the app (see [`on_run_event`]).
pub fn start<R: Runtime>(handle: AppHandle<R>, signals: Arc<ResumeSignals>) -> Watch {
    let (stop, stopped) = channel();
    let spawned = thread::Builder::new().name("network-watcher".into()).spawn(move || {
        let mut watcher = NetworkWatcher::new();
        let mut failures = FailureLog::default();
        // The baseline.
        let first = read_addresses();
        failures.record(&first);
        if let Ok(addrs) = first {
            watcher.observe(steady_ms(), addrs);
        }
        run_until_stopped(&stopped, Duration::from_millis(NETWORK_PERIOD_MS), || {
            let wait = poll(&mut watcher, &mut failures, read_addresses(), steady_ms(), |now| {
                resume::emit(&handle, &signals, Reason::Network, now);
            });
            // A signal the limit deferred (this one or a wake) goes out when the limit opens.
            resume::flush(&handle, &signals, steady_ms());
            sooner_if_pending(wait, signals.pending_wait_ms(steady_ms()))
        });
        log::debug!("the network watcher stopped");
    });
    if let Err(e) = spawned {
        log::warn!("the network watcher did not start: {e}; the page gets no network signal");
    }
    Watch { stop }
}

/// The running watcher, managed by Tauri. Dropping it ends the thread.
pub struct Watch {
    stop: Sender<()>,
}

/// Stop the watcher when the app exits.
pub fn on_run_event<R: Runtime>(handle: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Exit)
        && let Some(watch) = handle.try_state::<Watch>()
    {
        // The thread may be gone already: nothing is left to stop.
        let _ = watch.stop.send(());
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::time::Instant;

    use super::*;

    fn set(addrs: &[&str]) -> BTreeSet<IpAddr> {
        addrs.iter().map(|a| a.parse().unwrap()).collect()
    }

    fn failed() -> io::Result<BTreeSet<IpAddr>> {
        Err(io::Error::other("no interface list"))
    }

    #[test]
    fn a_failed_reading_is_skipped_and_logged_once_until_one_works() {
        let mut failures = FailureLog::default();
        failures.record(&failed());
        assert!(failures.failing);
        // Whether it logs again is not observable here: the state is what carries it.
        failures.record(&failed());
        assert!(failures.failing);
        failures.record(&Ok(set(&[])));
        assert!(!failures.failing, "a good reading re-arms the log");
    }

    #[test]
    fn a_failed_reading_changes_nothing_and_keeps_the_period() {
        let mut watcher = NetworkWatcher::new();
        let mut failures = FailureLog::default();
        let mut sent = 0;
        let wait = poll(&mut watcher, &mut failures, Ok(set(&["10.0.0.1"])), 0, |_| sent += 1);
        assert_eq!(wait, Duration::from_millis(NETWORK_PERIOD_MS));
        // The failure sits between two identical readings: no change, no signal.
        let wait = poll(&mut watcher, &mut failures, failed(), 5_000, |_| sent += 1);
        assert_eq!(wait, Duration::from_millis(NETWORK_PERIOD_MS));
        poll(&mut watcher, &mut failures, Ok(set(&["10.0.0.1"])), 10_000, |_| sent += 1);
        assert_eq!(sent, 0);
    }

    #[test]
    fn a_change_reads_again_after_a_second_and_signals_once() {
        let mut watcher = NetworkWatcher::new();
        let mut failures = FailureLog::default();
        let mut sent = Vec::new();
        poll(&mut watcher, &mut failures, Ok(set(&["10.0.0.1"])), 0, |n| sent.push(n));
        let wait = poll(&mut watcher, &mut failures, Ok(set(&["10.0.0.2"])), 5_000, |n| sent.push(n));
        assert_eq!(wait, Duration::from_millis(NETWORK_QUIET_MS));
        let wait = poll(&mut watcher, &mut failures, Ok(set(&["10.0.0.2"])), 6_000, |n| sent.push(n));
        assert_eq!(wait, Duration::from_millis(NETWORK_PERIOD_MS));
        assert_eq!(sent, [6_000]);
    }

    #[test]
    fn the_real_reading_works_and_is_quick() {
        let start = Instant::now();
        let reading = read_addresses();
        let took = start.elapsed();
        // Some sandboxes refuse the call: then it is an error, not a panic.
        if let Ok(addrs) = reading {
            assert!(addrs.iter().all(|a| !a.is_loopback()));
        }
        assert!(took < Duration::from_secs(2), "one reading took {took:?}");
    }

    #[test]
    fn a_stop_is_heard_at_once_and_a_dropped_sender_ends_the_loop() {
        let (stop, stopped) = mpsc::channel();
        stop.send(()).unwrap();
        let mut calls = 0;
        run_until_stopped(&stopped, Duration::from_secs(60), || {
            calls += 1;
            Duration::from_secs(60)
        });
        assert_eq!(calls, 0);
        let (stop, stopped) = mpsc::channel::<()>();
        drop(stop);
        run_until_stopped(&stopped, Duration::from_secs(60), || Duration::from_secs(60));
    }

    #[test]
    fn the_loop_works_until_stopped() {
        let (stop, stopped) = mpsc::channel();
        let mut calls = 0;
        run_until_stopped(&stopped, Duration::from_millis(1), || {
            calls += 1;
            if calls == 3 {
                stop.send(()).unwrap();
            }
            Duration::from_millis(1)
        });
        assert_eq!(calls, 3);
    }

    #[test]
    fn a_pending_signal_cuts_the_wait_short() {
        let five = Duration::from_millis(NETWORK_PERIOD_MS);
        assert_eq!(sooner_if_pending(five, None), five);
        assert_eq!(sooner_if_pending(five, Some(3_000)), Duration::from_millis(3_000));
        assert_eq!(sooner_if_pending(Duration::from_secs(1), Some(3_000)), Duration::from_secs(1));
        assert_eq!(sooner_if_pending(five, Some(0)), Duration::from_millis(1));
    }
}
