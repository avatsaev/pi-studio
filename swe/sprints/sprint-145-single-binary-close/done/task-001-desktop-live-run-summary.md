# Task 001 — The live run in the real webview — Summary

- **Sprint:** sprint-145-single-binary-close
- **Completed:** 2026-11-24
- **Status:** done

Two agents ran the rows in containers with the release app, real OpenSSH hosts and a local archive server; results are `desktop/docs/platform-checks.md` § Milestone 6 (local L1–L9, SSH 1–11), the recipe `desktop/docs/development.md` § Milestone 6, 33+149 screenshots kept under /tmp/live145-*-shots (not committed).

**Result:** every row passed on Linux. L8 (skipped-version line) not tried (it was seen in a browser in sprint 142). Not tried: macOS and Windows (D16), a 60 s stall, a full disk, a glibc too old, an app restart between a cut send and Retry, a jump host or password login for the install.

**Defects found and fixed (with tests):** a failed install was downloaded twice (the Daemons screen's open effect probed; `refreshesOnOpen`); a long state sentence ran out of the connection pill (CSS ellipsis, shared with the browser client); SSH first connect to an outdated daemon showed `running` (`open_daemon` queues the probe; new ssh test); the SSH checksum wording. **Decisions by the orchestrator:** Update dropped from a `stopped` local row; Check again on the tool's `installed` state; the rest listed under "Left as it is" in platform-checks. Spec corrections: ForceCommand ends `no_shell`; tmp cleanup is remembered-name plus age.
