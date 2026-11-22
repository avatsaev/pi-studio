//! `daemon.add`, `daemon.update` and `daemon.remove` as a job in three steps, so that the store
//! calls (which may block on a system prompt) never run on the thread that owns the session.
//!
//! 1. [`Session::plan_secret_command`](crate::Session::plan_secret_command), under the session's
//!    lock or on its thread: validates and builds a [`SecretJob`]; changes nothing.
//! 2. [`SecretJob::store`], on the caller's thread: the store calls that come before the file
//!    (set a secret, delete a cleared password).
//! 3. [`Session::commit_secret_job`](crate::Session::commit_secret_job), back under the lock: the
//!    registry is planned again against what it is now and written.
//! 4. [`SecretJob::finish`], on the caller's thread: the store calls that come after (a removed
//!    entry's items; taking back an added entry's secret when the file would not be written).
//!
//! [`Session::execute`](crate::Session::execute) runs the four in a row, which is right for a
//! caller that owns its thread; [`execute_unlocked`] does it for a `Mutex<Session>`, and the shell's
//! owner loop for the thread that owns the session.

use std::sync::Mutex;

use pistudiodesktop_model::{EntryId, NewEntry, Secret, Update};
use serde_json::{Value, json};

use crate::secret::{Slot, Vault};
use crate::{EngineError, Notice, Result, Session};

/// One store call: set the item to `secret`, or delete it when there is none.
pub(crate) struct Op {
    pub(crate) entry: EntryId,
    pub(crate) slot: Slot,
    pub(crate) secret: Option<Secret>,
}

/// The registry change a job commits, planned again when it is committed.
pub(crate) enum Work {
    Add { id: EntryId, new: Option<NewEntry> },
    Update { id: String, update: Option<Update> },
    Remove { id: String },
}

/// A `daemon.add`, `daemon.update` or `daemon.remove` in progress. It holds the secrets it will
/// store, so it has no `Debug` and is never cloned.
#[must_use = "a planned command does nothing until it is run"]
pub struct SecretJob {
    pub(crate) vault: Vault,
    pub(crate) entry: EntryId,
    pub(crate) work: Work,
    pub(crate) before: Vec<Op>,
    pub(crate) after: Vec<Op>,
}

fn code(code: &'static str) -> EngineError {
    EngineError::Other(code.to_owned())
}

impl SecretJob {
    fn run(&self, op: &Op) -> std::result::Result<(), &'static str> {
        match &op.secret {
            Some(secret) => self.vault.set(&op.entry, op.slot, secret),
            None => self.vault.delete(&op.entry, op.slot),
        }
    }

    /// Whether [`SecretJob::store`] has anything to do.
    pub fn has_store_step(&self) -> bool {
        !self.before.is_empty()
    }

    /// The store calls that come before the registry is written. May block: not on the thread that
    /// owns the session. `Err` is `secret_store_failed`, and nothing has been written.
    pub fn store(&self) -> Result<()> {
        self.before.iter().try_for_each(|op| self.run(op)).map_err(code)
    }

    /// Whether [`SecretJob::finish`] has store calls to make for this outcome of the commit.
    pub fn has_finish_step(&self, committed: &std::result::Result<Value, &'static str>) -> bool {
        match committed {
            Ok(_) => !self.after.is_empty(),
            Err(e) => self.takes_back(e),
        }
    }

    /// A secret stored for an entry that was not added (or that vanished meanwhile) is taken back.
    fn takes_back(&self, error: &str) -> bool {
        self.before.iter().any(|op| op.secret.is_some()) && (matches!(self.work, Work::Add { .. }) || error == "not_found")
    }

    /// The store calls that come after the registry write, and the command's answer. May block.
    /// A delete that fails is logged by the vault with the entry id and reported in the answer as
    /// a [`Notice::SecretNotRemoved`] under `notices`; the entry is removed all the same.
    pub fn finish(self, committed: std::result::Result<Value, &'static str>) -> Result<Value> {
        let mut answer = match committed {
            Ok(answer) => answer,
            Err(e) => {
                if self.takes_back(e) {
                    // Nothing keeps the entry, so nothing may keep its secret (the failure is logged).
                    for op in self.before.iter().filter(|op| op.secret.is_some()) {
                        let _ = self.vault.delete(&op.entry, op.slot);
                    }
                }
                return Err(code(e));
            }
        };
        let failed = self.after.iter().filter(|op| self.run(op).is_err()).count();
        if failed > 0
            && let Some(answer) = answer.as_object_mut()
        {
            answer.insert("notices".to_owned(), json!([Notice::SecretNotRemoved { entry: self.entry.as_str().to_owned() }.to_json()]));
        }
        Ok(answer)
    }

    /// The whole command in one go, blocking.
    pub(crate) fn run_inline(mut self, session: &mut Session) -> Result<Value> {
        self.store()?;
        let committed = session.commit_secret_job(&mut self);
        self.finish(committed)
    }
}

/// Run the command `id` on a shared session without holding its lock across a store call: planned
/// and committed under the lock, stored outside it. Any other command runs under the lock.
pub fn execute_unlocked(session: &Mutex<Session>, id: &str, params: Value) -> Result<Value> {
    let lock = || session.lock().unwrap_or_else(|e| e.into_inner());
    let mut job = {
        let mut guard = lock();
        match guard.plan_secret_command(id, &params) {
            None => return guard.execute(id, params),
            Some(planned) => planned?,
        }
    };
    job.store()?;
    let committed = lock().commit_secret_job(&mut job);
    job.finish(committed)
}
