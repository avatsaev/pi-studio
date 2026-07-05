#!/usr/bin/env node
import { createDaemonRuntimeInfo } from "./index.js";

const info = createDaemonRuntimeInfo({ mode: "development", listen: process.env.PI_STUDIO_LISTEN ?? "0.0.0.0:6767" });
console.log(`pi-studio dev daemon scaffold listening on ${info.listen.host}:${info.listen.port}`);
