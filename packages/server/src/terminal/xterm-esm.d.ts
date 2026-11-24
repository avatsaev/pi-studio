/**
 * Types for the deep ESM entry points `screen-buffer.ts` imports. `@xterm/headless` and
 * `@xterm/addon-serialize` have no `exports` map, so their `*.mjs` builds are importable by path
 * but carry no typings of their own; re-export the packages' published typings for them.
 */

declare module "@xterm/headless/lib-headless/xterm-headless.mjs" {
  export * from "@xterm/headless";
}

declare module "@xterm/addon-serialize/lib/addon-serialize.mjs" {
  export * from "@xterm/addon-serialize";
}
