# task-001-live-check — Summary

- **Sprint:** sprint-158-usage-data-close
- **Completed:** 2026-11-25

## Result
Run on real windows in the pi-desktop-xvfb container with a test build (token phc_test, endpoint a local recorder). All bullets passed: first start one app_started with a body per spec 2, same ID on the second start; quit sends one app_closed (27 ms normally, 2026 ms with a stalled server); the Privacy switch off sends nothing at tick or quit and on again keeps the ID; DO_NOT_TRACK=1 sends nothing, makes no usageId and the panel says so; a second launch sends nothing; 401, 500 and refused connections show nothing in the window and log only status_401 / status_500 / offline codes (no URL, ID or token); a normal build reports blocked=build and its binary holds neither the token nor the endpoint; the web client shows no Privacy category and its home and Settings screens match HEAD except a port digit (connected view not compared).
- RunEvent::Exit DOES fire on Restart to update on Linux (one app_closed for the old run, the new process sends its own app_started). Not run: macOS/Windows, a stalled server during restart.
- locale appears when the system has one (LANG=de_DE.UTF-8 gave de-DE). U3 confirmed: a test build with CI, --control and --config-dir still sends.
- No source touched, no bug found. Throwaway files deleted.
