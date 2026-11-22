//! A connection's task: wait for the page, run the two directions, and end both legs as § 3's table
//! says.
//!
//! | What happens | The page sees | The daemon sees |
//! |---|---|---|
//! | The daemon closes with a code and reason | The same code and reason | The answer to its close |
//! | The page closes with a code and reason | Its close completed | The same code and reason; the wait for the answer is bounded |
//! | The daemon's leg ends without a close frame | Its socket dropped (1006) | Nothing |
//! | The page's leg ends without a close frame | Nothing | Close 1001 |
//! | `close_all`, or no page in time | Its socket dropped | Close 1001 |
//! | A message above the limit | Close 1009 | Close 1009 |

use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt as _;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Notify, oneshot};
use tokio::task::{JoinError, JoinHandle};
use tokio_tungstenite::tungstenite::protocol::CloseFrame;

use super::accept::{PageSocket, accept_page};
use super::close::{refuse_oversize, relay_close, say_goodbye};
use super::conn::{Conn, Dir, Leg};
use super::gate::{Gate, Refusal};
use super::pump::{Event, Loss, Pumped, pump};
use super::{EndCode, Shared};
use crate::dial::Socket;
use crate::limits::Limits;
use crate::stream::Stream;

/// Everything a connection's task owns.
pub(super) struct Task {
    pub(super) shared: Arc<Shared>,
    pub(super) key: u64,
    pub(super) id: String,
    pub(super) conn: Arc<Conn>,
    pub(super) shutdown: Arc<Notify>,
    pub(super) listener: TcpListener,
    pub(super) gate: Gate,
    pub(super) daemon: Socket,
}

/// What the steps share.
struct Ctx<'a> {
    shared: &'a Shared,
    id: &'a str,
    conn: &'a Arc<Conn>,
    limits: Limits,
}

impl Ctx<'_> {
    /// A line for the log: the entry's id and a fixed text. Never the token, the address or a
    /// peer's words.
    fn say(&self, text: &str) {
        self.shared.say(self.id, text);
    }
}

/// Forgets the connection when the task ends, even by a panic, so that its place in the set is
/// never lost.
struct Registered {
    shared: Arc<Shared>,
    key: u64,
    end: Option<EndCode>,
}

impl Drop for Registered {
    fn drop(&mut self) {
        self.shared.forget(self.key, self.end);
    }
}

pub(super) async fn run(task: Task) {
    let Task { shared, key, id, conn, shutdown, listener, gate, daemon } = task;
    let mut registered = Registered { shared: shared.clone(), key, end: None };
    let ctx = Ctx { shared: &shared, id: &id, conn: &conn, limits: shared.limits };
    registered.end = match wait_for_page(&ctx, listener, gate, &shutdown).await {
        Ok(page) => {
            conn.opened();
            relay(&ctx, daemon, page, &shutdown).await
        }
        Err(Missing::Expired) => {
            ctx.say("the page did not connect in time");
            goodbye(&ctx, daemon).await;
            // A page that tried and was refused is a different story from one that never came.
            Some(if conn.refusals() > 0 { EndCode::PageRefused } else { EndCode::PageTimeout })
        }
        Err(Missing::Shutdown) => {
            ctx.say("shut down before the page connected");
            goodbye(&ctx, daemon).await;
            None
        }
    };
}

/// Why no page came.
enum Missing {
    Expired,
    Shutdown,
}

async fn wait_for_page(ctx: &Ctx<'_>, listener: TcpListener, gate: Gate, shutdown: &Notify) -> Result<PageSocket, Missing> {
    let refused = |refusal: Refusal| ctx.say(&format!("refused an upgrade: {}", refusal.why()));
    let accepting = accept_page(listener, Arc::new(gate), ctx.conn, &ctx.limits, &refused);
    tokio::select! {
        biased;
        () = shutdown.notified() => Err(Missing::Shutdown),
        accepted = tokio::time::timeout(ctx.limits.page_wait, accepting) => accepted.map_err(|_| Missing::Expired),
    }
}

/// The daemon is told 1001 and given the close wait.
async fn goodbye(ctx: &Ctx<'_>, mut daemon: Socket) {
    ctx.conn.closing();
    say_goodbye(&mut daemon, ctx.limits.close_wait).await;
}

type ToPage = Result<Pumped<Stream, TcpStream>, JoinError>;
type ToDaemon = Result<Pumped<TcpStream, Stream>, JoinError>;

/// Stops a direction, or first lets it end by itself for `grace`, and takes its result.
async fn stopped<T>(handle: &mut JoinHandle<T>, stop: oneshot::Sender<()>, grace: Option<Duration>) -> Result<T, JoinError> {
    if let Some(grace) = grace
        && let Ok(joined) = tokio::time::timeout(grace, &mut *handle).await
    {
        return joined;
    }
    let _ = stop.send(());
    handle.await
}

/// A direction that found its sink closing is waiting for the other direction to report the close.
fn grace_for<A, B>(first: &Result<Pumped<A, B>, JoinError>, limits: &Limits) -> Option<Duration> {
    first.as_ref().ok().filter(|pumped| pumped.event == Event::SinkClosing).map(|_| limits.close_wait)
}

/// Runs both directions until one ends (or the connection is shut down), then stops the other.
/// The first of the answers is the direction that ended first, `None` for a shutdown.
async fn run_pumps(ctx: &Ctx<'_>, daemon: Socket, page: PageSocket, shutdown: &Notify) -> (Option<Dir>, ToPage, ToDaemon) {
    let (daemon_sink, daemon_stream) = daemon.split();
    let (page_sink, page_stream) = page.split();
    let (stop_page, stop_page_rx) = oneshot::channel();
    let (stop_daemon, stop_daemon_rx) = oneshot::channel();
    let mut to_page = tokio::spawn(pump(daemon_stream, page_sink, Dir::ToPage, ctx.conn.clone(), ctx.limits, stop_page_rx));
    let mut to_daemon = tokio::spawn(pump(page_stream, daemon_sink, Dir::ToDaemon, ctx.conn.clone(), ctx.limits, stop_daemon_rx));
    tokio::select! {
        biased;
        () = shutdown.notified() => {
            let page = stopped(&mut to_page, stop_page, None).await;
            (None, page, stopped(&mut to_daemon, stop_daemon, None).await)
        }
        first = &mut to_page => {
            let grace = grace_for(&first, &ctx.limits);
            (Some(Dir::ToPage), first, stopped(&mut to_daemon, stop_daemon, grace).await)
        }
        first = &mut to_daemon => {
            let grace = grace_for(&first, &ctx.limits);
            (Some(Dir::ToDaemon), stopped(&mut to_page, stop_page, grace).await, first)
        }
    }
}

/// The event that says why the connection ends, and the direction that reported it: not a stop,
/// and not "my sink is closing" while the other direction has the close. `None` for a shutdown.
fn verdict(first: Option<Dir>, to_page: Event, to_daemon: Event) -> Option<(Dir, Event)> {
    let mut candidates =
        if first == Some(Dir::ToDaemon) { [(Dir::ToDaemon, to_daemon), (Dir::ToPage, to_page)] } else { [(Dir::ToPage, to_page), (Dir::ToDaemon, to_daemon)] };
    let said = |(_, event): &(Dir, Event)| !matches!(event, Event::Stopped | Event::SinkClosing);
    let pick = candidates.iter().position(said).or_else(|| candidates.iter().position(|(_, event)| *event == Event::SinkClosing))?;
    Some(std::mem::replace(&mut candidates[pick], (Dir::ToPage, Event::Stopped)))
}

/// The page is connected: pump until something ends it, then end both legs.
async fn relay(ctx: &Ctx<'_>, daemon: Socket, page: PageSocket, shutdown: &Notify) -> Option<EndCode> {
    let (first, to_page, to_daemon) = run_pumps(ctx, daemon, page, shutdown).await;
    let (Ok(to_page), Ok(to_daemon)) = (to_page, to_daemon) else {
        ctx.say("a pump task failed");
        return Some(EndCode::UpstreamLost);
    };
    let (page_event, daemon_event) = (to_page.event, to_daemon.event);
    // Each leg's two halves are in different directions' results.
    let legs = (to_daemon.to.reunite(to_page.from), to_page.to.reunite(to_daemon.from));
    let (Ok(daemon), Ok(page)) = legs else {
        ctx.say("a leg could not be put back together");
        return Some(EndCode::UpstreamLost);
    };
    end_legs(ctx, verdict(first, page_event, daemon_event), daemon, page).await
}

fn leg_name(leg: Leg) -> &'static str {
    match leg {
        Leg::Daemon => "daemon",
        Leg::Page => "page",
    }
}

/// Ends both legs for `verdict`; the answer is the abnormal end to record, if any.
async fn end_legs(ctx: &Ctx<'_>, verdict: Option<(Dir, Event)>, daemon: Socket, page: PageSocket) -> Option<EndCode> {
    let Some((dir, event)) = verdict else {
        ctx.say("shut down");
        drop(page);
        goodbye(ctx, daemon).await;
        return None;
    };
    match event {
        Event::Close(frame) => {
            close_by(ctx, dir.source(), frame, daemon, page).await;
            None
        }
        Event::SourceLost(loss) => lost(ctx, dir.source(), loss, daemon, page).await,
        Event::SinkLost | Event::SinkClosing => lost(ctx, dir.sink(), Loss::Reset, daemon, page).await,
        Event::TooLarge => {
            ctx.say(&format!("a message from the {} is above the limit", leg_name(dir.source())));
            ctx.conn.closing();
            let wait = ctx.limits.close_wait;
            let (mut daemon, mut page) = (daemon, page);
            match dir.source() {
                Leg::Daemon => refuse_oversize(&mut daemon, &mut page, wait).await,
                Leg::Page => refuse_oversize(&mut page, &mut daemon, wait).await,
            }
            Some(EndCode::TooLarge)
        }
        Event::Stopped => {
            drop(page);
            goodbye(ctx, daemon).await;
            None
        }
    }
}

/// `closer` sent a close frame: it goes to the other leg. Not an abnormal end: what follows is the
/// workbench's reconnect.
async fn close_by(ctx: &Ctx<'_>, closer: Leg, frame: Option<CloseFrame>, mut daemon: Socket, mut page: PageSocket) {
    ctx.say(&format!("the {} closed with code {}", leg_name(closer), frame.as_ref().map_or(1005, |f| u16::from(f.code))));
    ctx.conn.closing();
    let wait = ctx.limits.close_wait;
    match closer {
        Leg::Daemon => relay_close(&mut daemon, &mut page, frame, wait).await,
        Leg::Page => relay_close(&mut page, &mut daemon, frame, wait).await,
    }
}

/// `leg` ended without a close frame. The daemon's leg takes the page's with it (dropped, so the
/// page sees 1006); the page's leg ends with 1001 to the daemon. A page that reloads is normal; one
/// that broke the protocol is recorded.
async fn lost(ctx: &Ctx<'_>, leg: Leg, loss: Loss, daemon: Socket, page: PageSocket) -> Option<EndCode> {
    ctx.say(&format!("the {}'s leg ended without a close frame", leg_name(leg)));
    match leg {
        Leg::Daemon => Some(EndCode::UpstreamLost),
        Leg::Page => {
            drop(page);
            goodbye(ctx, daemon).await;
            (loss == Loss::Invalid).then_some(EndCode::PageRefused)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_event_that_says_why_wins_over_a_stop_and_over_a_sink_that_is_only_closing() {
        let close = || Event::Close(None);
        // The other direction has the close; this one only found its sink closing.
        assert_eq!(verdict(Some(Dir::ToDaemon), close(), Event::SinkClosing), Some((Dir::ToPage, close())));
        assert_eq!(verdict(Some(Dir::ToPage), Event::SinkClosing, close()), Some((Dir::ToDaemon, close())));
        // Nothing else to go on: the sink is treated as gone.
        assert_eq!(verdict(Some(Dir::ToPage), Event::SinkClosing, Event::Stopped), Some((Dir::ToPage, Event::SinkClosing)));
        // The direction that ended first is believed when both have something to say.
        assert_eq!(verdict(Some(Dir::ToDaemon), Event::TooLarge, close()), Some((Dir::ToDaemon, close())));
        assert_eq!(verdict(Some(Dir::ToPage), Event::TooLarge, close()), Some((Dir::ToPage, Event::TooLarge)));
        // A shutdown: both were stopped.
        assert_eq!(verdict(None, Event::Stopped, Event::Stopped), None);
        // A shutdown that lost the race to a real ending still reports the ending.
        assert_eq!(verdict(None, Event::Stopped, Event::SourceLost(Loss::Reset)), Some((Dir::ToDaemon, Event::SourceLost(Loss::Reset))));
    }
}
