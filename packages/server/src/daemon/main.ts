#!/usr/bin/env node
/**
 * Production daemon entry point — starts the REAL daemon (real Pi provider, disk persistence, full
 * RPC surface). Listen address: `PI_STUDIO_LISTEN` → `config.json` `daemon.listen` → `127.0.0.1:6767`.
 */
import { runDaemon } from "./run.js";

runDaemon();
