import type {
  SkillsInstallResponse,
  SkillsListResponse,
  SkillsPreviewResponse,
  SkillsRemoveResponse,
  SkillsSetEnabledResponse,
  SkillsUpdateAllResponse,
} from "@av-pi-studio/protocol";

import type { Logger } from "../logging/logger.js";
import type { HandlerRegistry } from "../ws/router.js";
import type { ResourceService } from "./resource-service.js";

/**
 * `skills_list_request`/`skills_set_enabled_request`/`skills_remove_request`/
 * `skills_update_all_request`/`skills_preview_request`/`skills_install_request`
 * (swe/architecture/pi-resource-management.md § Wire family `skills_*`). Thin orchestration only —
 * every decision (catalog resolution, toggle pattern derivation, remove strategy, source
 * detection, spawn/queue/watcher/broadcast) already lives behind `ResourceService`; this module
 * maps its results onto the wire response shape and validates the requests this family's
 * untyped `ctx.message` can't guarantee the shape of.
 */

export interface SkillsRpcDeps {
  service: ResourceService;
  logger?: Logger;
}

export function registerSkillsHandlers(registry: HandlerRegistry, deps: SkillsRpcDeps): void {
  const { service, logger } = deps;

  registry.register(
    "skills_list_request",
    async (): Promise<Omit<SkillsListResponse, "requestId">> => {
      const result = await service.list();
      return { type: "skills_list_response", ...result };
    },
  );

  registry.register(
    "skills_set_enabled_request",
    async (ctx): Promise<Omit<SkillsSetEnabledResponse, "requestId">> => {
      const { path, enabled } = ctx.message;

      // `ctx.message` is an unvalidated `Record<string, unknown>` (`ws/router.ts`), so the
      // handler must check `path`/`enabled`'s shape itself rather than trust the wire schema a
      // conforming client used — same posture as `extensions-rpc.ts`'s `isSlugArray`. Only a
      // client bypassing the protocol schema (`path: z.string()`, `enabled: z.boolean()`, both
      // required) can reach this branch.
      if (typeof path !== "string" || typeof enabled !== "boolean") {
        logger?.warn(
          { message: ctx.message },
          "skills_set_enabled_request: rejecting malformed request",
        );
        const result = await service.list();
        return {
          type: "skills_set_enabled_response",
          ...result,
          ok: false,
          error: "invalid request: expected a string path and boolean enabled",
        };
      }

      const result = await service.setEnabled(path, enabled);
      return { type: "skills_set_enabled_response", ...result };
    },
  );

  registry.register(
    "skills_remove_request",
    async (ctx): Promise<Omit<SkillsRemoveResponse, "requestId">> => {
      const { path, packageSource } = ctx.message;

      // Same posture as `skills_set_enabled_request` above: `ctx.message` is unvalidated, so the
      // handler re-checks the wire schema's xor (`path` XOR `packageSource`, both strings) itself.
      // Only a client bypassing `skillsRemoveRequestSchema` can reach this branch.
      const hasPath = typeof path === "string";
      const hasPackageSource = typeof packageSource === "string";
      if (hasPath === hasPackageSource) {
        logger?.warn(
          { message: ctx.message },
          "skills_remove_request: rejecting malformed request",
        );
        const result = await service.list();
        return {
          type: "skills_remove_response",
          ...result,
          ok: false,
          error: "invalid request: expected exactly one of a string path or packageSource",
        };
      }

      const result = hasPath
        ? await service.remove({ path })
        : await service.remove({ packageSource: packageSource as string });
      return { type: "skills_remove_response", ...result };
    },
  );

  registry.register(
    "skills_update_all_request",
    async (): Promise<Omit<SkillsUpdateAllResponse, "requestId">> => {
      const result = await service.updateAll();
      return { type: "skills_update_all_response", ...result };
    },
  );

  registry.register(
    "skills_preview_request",
    async (ctx): Promise<Omit<SkillsPreviewResponse, "requestId">> => {
      const { source } = ctx.message;
      if (typeof source !== "string") {
        logger?.warn(
          { message: ctx.message },
          "skills_preview_request: rejecting malformed request",
        );
        return {
          type: "skills_preview_response",
          ok: false,
          error: "invalid request: expected a string source",
          kind: "invalid_source",
          source: typeof source === "string" ? source : "",
          skills: [],
        };
      }
      const result = await service.preview(source);
      return { type: "skills_preview_response", ...result };
    },
  );

  registry.register(
    "skills_install_request",
    async (ctx): Promise<Omit<SkillsInstallResponse, "requestId">> => {
      const { source, skills, replace } = ctx.message;
      const hasSkills = skills === undefined || Array.isArray(skills);
      if (
        typeof source !== "string" ||
        !hasSkills ||
        (Array.isArray(skills) && !skills.every((s) => typeof s === "string")) ||
        (replace !== undefined && typeof replace !== "boolean")
      ) {
        logger?.warn(
          { message: ctx.message },
          "skills_install_request: rejecting malformed request",
        );
        const listed = await service.list();
        return {
          type: "skills_install_response",
          ok: false,
          error: "invalid request: expected a string source and optional skills[]/replace",
          results: [],
          skills: listed.skills,
          packages: listed.packages,
        };
      }
      const result = await service.install(
        source,
        skills as string[] | undefined,
        replace as boolean | undefined,
      );
      return { type: "skills_install_response", ...result };
    },
  );
}
