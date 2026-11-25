import type { ProcessHost } from "../daemon/run.js";

/** A {@link ProcessHost} that records its subscriptions and exits instead of touching `process`. */
export interface FakeProcessHost extends ProcessHost {
  /** The latest listener per event; call one to deliver that event. */
  handlers: Record<string, (arg?: unknown) => void>;
  /** Every `exit(code)` call, in order. */
  exits: number[];
  /** Resolves with the first exit code. */
  exited: Promise<number>;
}

export function fakeProcessHost(): FakeProcessHost {
  const exited = Promise.withResolvers<number>();
  const host: FakeProcessHost = {
    handlers: {},
    exits: [],
    exited: exited.promise,
    on: (event, listener) => {
      host.handlers[event] = listener;
    },
    exit: (code) => {
      host.exits.push(code);
      exited.resolve(code);
    },
  };
  return host;
}
