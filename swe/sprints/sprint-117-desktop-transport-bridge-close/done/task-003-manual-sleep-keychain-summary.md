# Task 003 summary — sleep and wake on real machines (waived in part)

- **Run by:** the owner, 2026-11-22, MacBook (M3 Pro), macOS arm64, direct entry to a daemon on another machine.
- **First build (run 45001626512): fail.** The connection came back after the wake, but the terminal took no input and the chat missed the turn that ran meanwhile. Cause in `packages/workbench`: the SDK reconnects in place and nothing subscribed again. Fixed in `e1ebf23` (`useOpenClient`, `use-session-resync.ts`), reproduced and checked on Linux in a browser first.
- **Second build (run 45008686113): pass.** Chat resumed and terminals took input after the wake.
- **Waived by the owner, accepted as working without a run:** M1 on Windows, macOS x64, a Linux desktop, and with a relay entry; M2–M6 (keychain items and prompts after an update, firewall or security prompts, the `bufferedAmount` pause on Windows).
- The spec's last Resume criterion stays unticked: shown on one machine only.
