#!/usr/bin/env node
import { createDaemonRuntimeInfo } from "./index.js";

const info = createDaemonRuntimeInfo({ mode: "production" });
console.log(`pi-studio daemon scaffold listening on ${info.listen.host}:${info.listen.port}`);
