# Task 001 — Relay transfer proof — Summary

- **Sprint:** sprints/sprint-101-relay-multi-client-close
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
Throwaway harness (`/tmp/relay-proof/run.mjs`, deleted): `pi-studio-relay` (`dist/relay-main.js`, `PI_STUDIO_RELAY_LISTEN`) and the production daemon (`dist/daemon/main.js`, scratch `PI_STUDIO_HOME`, `daemon.relay` enabled, own ports 7391/6871) as separate processes; SDK client through the pairing URL (`createRelayTransport` → `DaemonClient` → `FileTransferClient`); a 600 MiB random file; a second relay client sending `list_agents_request` every 500 ms for the whole run; RSS from `/proc/<pid>/status` every second.

## Results (loopback, Linux 7.0.14-28-pve, Node 24, 0.0.120 + feat/relay-multi-pair working tree)
| Check | Result |
|---|---|
| Download 600 MiB | SHA-256 matches; 4.2 s (~143 MiB/s) |
| Upload 600 MiB | SHA-256 of the landed file matches; 4.4 s (~138 MiB/s) |
| Download, client TCP socket paused 30 s at ~100 MiB | SHA-256 matches; 34.1 s total. Daemon RSS 184.8 → peak 236.4 MiB (+51.6 MiB). Relay RSS 123.3 MiB, no growth during the pause |
| Second client during all three transfers | 88 answers, p50 0.84 ms, worst 9.75 ms |
| Direct-connection figures (sprint-097, same method but 6 s pause) | ~890 MiB/s page-cache download; paused client daemon +37 MiB |

Relay throughput is ~6× below the direct figure (every byte is encrypted twice-hopped through the relay process, plus NaCl box on both ends); recorded, not gated (D18).

## Files created / changed
None in the repository (harness deleted).

## Build & test results
```
$ npm run build (before the run) -> success
$ node /tmp/relay-proof/run.mjs -> output summarised above
```

## Acceptance criteria
- [x] Both transfers finish with matching SHA-256
- [x] Peak RSS growth reported: daemon +51.6 MiB, relay 0 MiB beyond its 123 MiB level (far below 600 MiB)
- [x] Second client's answers keep arriving; worst 9.75 ms
- [x] Throughput both ways recorded next to the sprint-097 direct figures
- [x] Figures in this summary, harness deleted

## Follow-ups / TODO(verify)
- The relay's baseline RSS was sampled after the plain download and upload had run (123 MiB already reflects those transfers), so "no growth during the pause" means the pause added nothing above the earlier high-water mark; the RSS before any transfer was not measured. Memory is nonetheless bounded far below the file size.
- The sprint-097 direct figures used a 6 s pause and a differently-cached file; comparison is indicative only.
- Loopback only; LAN/WAN throughput through a real relay not measured.
