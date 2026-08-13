import type { ExtensionPacksListResponse, ExtensionPacksSetResponse } from "@av-pi-studio/protocol";

import type { Logger } from "../logging/logger.js";
import type { HandlerRegistry } from "../ws/router.js";
import { CURATED_PACKS, selectEntries } from "./curated-packs.js";
import type { ExtensionsDescribe, ExtensionsService } from "./extensions-service.js";
import { toExtensionPackInfoList } from "./wire.js";

/**
 * `extension_packs_list_request`/`extension_packs_set_request` (swe/features/
 * preinstalled-extensions.md § RPC surface). Thin orchestration only — every decision (statuses,
 * installs) already lives in the planner/executor behind `ExtensionsService`; this module maps
 * server types to wire types and nothing else.
 */

export interface ExtensionsRpcDeps {
  service: ExtensionsService;
  logger?: Logger;
}

/** The list-response fields, shared verbatim by both the list response and the set response
 *  (which carries them plus `ok`/`error`/`report`) — computed fresh from `describe()` so a `set`
 *  response reflects state *after* the sync it triggered completes, never a stale pre-sync view. */
function toListFields(
  described: ExtensionsDescribe,
): Omit<ExtensionPacksListResponse, "type" | "requestId"> {
  return {
    autoSync: described.autoSync,
    selected: described.selected,
    packs: toExtensionPackInfoList(CURATED_PACKS, described.entries),
    ...(described.lastSync ? { lastSync: described.lastSync } : {}),
  };
}

/** `ctx.message` is an unvalidated `Record<string, unknown>` (`ws/router.ts`), so the handler must
 *  check `packs`'s shape itself rather than trust the wire schema a conforming client used. */
function isSlugArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((slug) => typeof slug === "string");
}

export function registerExtensionsHandlers(
  registry: HandlerRegistry,
  deps: ExtensionsRpcDeps,
): void {
  const { service, logger } = deps;

  registry.register(
    "extension_packs_list_request",
    async (): Promise<Omit<ExtensionPacksListResponse, "requestId">> => {
      const described = await service.describe();
      return { type: "extension_packs_list_response", ...toListFields(described) };
    },
  );

  registry.register(
    "extension_packs_set_request",
    async (ctx): Promise<Omit<ExtensionPacksSetResponse, "requestId">> => {
      const packs = ctx.message.packs;

      // Absent `packs` ⇒ the manual-sync trigger: no validation, no persistence, ungated sync.
      if (packs === undefined) {
        const report = await service.sync("manual");
        const described = await service.describe();
        return {
          type: "extension_packs_set_response",
          ...toListFields(described),
          ok: true,
          report,
        };
      }

      // A malformed `packs` is a domain failure, NOT a silent "deselect everything": coercing it
      // would persist an empty selection and sync over it. Only a client bypassing the protocol
      // schema (`packs: z.array(z.string()).optional()`) can send this, so this is
      // defense-in-depth — but the daemon must never act on a shape it cannot read.
      if (!isSlugArray(packs)) {
        logger?.warn({ packs }, "extension_packs_set_request: rejecting malformed packs");
        const described = await service.describe();
        return {
          type: "extension_packs_set_response",
          ...toListFields(described),
          ok: false,
          error: "invalid packs: expected an array of pack slugs",
        };
      }

      const { unknownSlugs } = selectEntries(CURATED_PACKS, packs);
      if (unknownSlugs.length > 0) {
        logger?.warn(
          { unknownSlugs },
          "extension_packs_set_request: rejecting unknown pack slug(s)",
        );
        // Domain failure ⇒ `ok: false` + `error`, never `rpc_error` (transport-level only). No
        // persistence, no sync — the current (unchanged) state is still echoed back.
        const described = await service.describe();
        return {
          type: "extension_packs_set_response",
          ...toListFields(described),
          ok: false,
          error: `unknown pack: ${unknownSlugs.join(", ")}`,
        };
      }

      await service.setSelectedPacks(packs);
      const report = await service.sync("selection");
      const described = await service.describe();
      return {
        type: "extension_packs_set_response",
        ...toListFields(described),
        ok: true,
        report,
      };
    },
  );
}
