/**
 * `useSkillsQuery`/`useSkillToggle`/`useSkillRemove`/`useSkillUpdateAll`/`useSkillPreview`/
 * `useSkillInstall` — `skills_list_request` as a TanStack Query (mirrors
 * `use-provider-auth-list.ts`'s convention), invalidated by the daemon's `skills_changed` push,
 * plus the mutations: an optimistic `skills_set_enabled_request` with exact-prior-value rollback
 * and a per-row inline error, `skills_remove_request` (single skill or whole package),
 * `skills_update_all_request`, `skills_preview_request`, and `skills_install_request` — all four
 * of the latter **replace** the cached `{skills, packages}` document with the response wholesale
 * on success — never optimistic, per swe/features/skills-manager.md § Data flow: "install/
 * remove/update replace query data with the response (never optimistic)". This is the
 * `use-skills.ts` half of § Data flow, § Toggle, § Remove, § Update all, § Install dialog.
 *
 * The optimistic row patch (`applyOptimisticSkillToggle`) is exported and tested standalone per
 * this package's no-jsdom convention (AGENTS.md § "Framework-free testing convention: no
 * jsdom") — the hooks themselves only wire it to `queryClient`/`client`, untested directly.
 *
 * `useSkillInstall` deliberately holds no "cancel" affordance — `InstallSkillDialog.tsx` is
 * mounted unconditionally by `SkillsPanel.tsx` (only its inner `<Dialog open>` toggles), so
 * closing it doesn't unmount this hook: an in-flight `install()` keeps running and its state
 * still lands here even while the dialog is visually closed, matching swe/features/
 * skills-manager.md § Install dialog: "closing does not cancel (queue continues; result arrives
 * via skills_changed)".
 */

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PiPackageInfo,
  SkillInfo,
  SkillsInstallResponse,
  SkillsListResponse,
  SkillsPreviewResponse,
  SkillsUpdateAllResponse,
} from "@av-pi-studio/protocol";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { rpcKeys } from "@pi-studio-ui/lib/connection/rpc-keys.js";
import { asListDocument, hasItemResults, skillErrorMessage } from "./skills-presentation.js";

/** Patches one skill's `enabled` field in an already-fetched list response — the optimistic half
 *  of a toggle, applied to `queryClient`'s cached data before the RPC resolves. */
export function applyOptimisticSkillToggle(
  data: SkillsListResponse,
  path: string,
  enabled: boolean,
): SkillsListResponse {
  return {
    ...data,
    skills: data.skills.map((s) => (s.path === path ? { ...s, enabled } : s)),
  };
}

/** `skills_list_request`, subscribed to `skills_changed` for the connection's lifetime so any
 *  window's mutation or an external `settings.json`/filesystem edit re-lists here too. */
export function useSkillsQuery() {
  const client = useConnectionStore((s) => s.client);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!client) return;
    return client.onSkillsChanged(() => {
      void queryClient.invalidateQueries({ queryKey: rpcKeys.skillsList() });
    });
  }, [client, queryClient]);

  return useQuery<SkillsListResponse>({
    queryKey: rpcKeys.skillsList(),
    queryFn: () => {
      if (!client) throw new Error("not connected");
      return client.listSkills();
    },
    enabled: Boolean(client),
  });
}

export interface UseSkillToggle {
  /** Per-skill-path inline error from the row's most recent failed toggle. */
  rowErrors: Record<string, string>;
  /** Per-skill-path in-flight flag — disables the row's switch while its own toggle is pending. */
  pending: Record<string, boolean>;
  toggle: (skill: SkillInfo, enabled: boolean) => Promise<void>;
  clearRowError: (path: string) => void;
}

/** `skills_set_enabled_request`: optimistic cache patch, replaced with the daemon's real
 *  post-mutation `{skills, packages}` document on success, rolled back to the exact prior cached
 *  value on a domain `{ok:false}` or a thrown transport error — with the failure surfaced as this
 *  row's `rowErrors[path]` rather than a toast (swe/features/skills-manager.md § Toggle, §
 *  Error handling: "Toggle fails | Row rolls back; inline error"). */
export function useSkillToggle(): UseSkillToggle {
  const client = useConnectionStore((s) => s.client);
  const queryClient = useQueryClient();
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  function clearRowError(path: string) {
    setRowErrors((errors) => {
      if (!(path in errors)) return errors;
      const next = { ...errors };
      delete next[path];
      return next;
    });
  }

  async function toggle(skill: SkillInfo, enabled: boolean) {
    if (!client) return;
    const path = skill.path;
    clearRowError(path);
    setPending((p) => ({ ...p, [path]: true }));

    const previous = queryClient.getQueryData<SkillsListResponse>(rpcKeys.skillsList());
    if (previous) {
      queryClient.setQueryData<SkillsListResponse>(
        rpcKeys.skillsList(),
        applyOptimisticSkillToggle(previous, path, enabled),
      );
    }

    try {
      const result = await client.setSkillEnabled(path, enabled);
      if (!result.ok) {
        if (previous) queryClient.setQueryData(rpcKeys.skillsList(), previous);
        setRowErrors((errors) => ({
          ...errors,
          [path]: skillErrorMessage(result.error, result.message) ?? "Failed to update skill.",
        }));
        return;
      }
      queryClient.setQueryData(rpcKeys.skillsList(), result);
    } catch (err) {
      if (previous) queryClient.setQueryData(rpcKeys.skillsList(), previous);
      setRowErrors((errors) => ({
        ...errors,
        [path]: err instanceof Error ? err.message : "Failed to update skill.",
      }));
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[path];
        return next;
      });
    }
  }

  return { rowErrors, pending, toggle, clearRowError };
}

/** The wire's `{path}|{packageSource}` xor target — a single skill or a whole package. */
export type SkillRemoveTarget =
  | { path: string; packageSource?: undefined }
  | { path?: undefined; packageSource: string };

function removeTargetKey(target: SkillRemoveTarget): string {
  return target.path ?? `package:${target.packageSource}`;
}

export interface UseSkillRemove {
  /** Per-target in-flight flag, keyed by skill path or `package:<source>`. */
  pending: Record<string, boolean>;
  /** Per-target inline error from the most recent failed remove. */
  errors: Record<string, string>;
  removeSkill: (skill: SkillInfo) => Promise<void>;
  removePackage: (pkg: PiPackageInfo) => Promise<void>;
  clearError: (key: string) => void;
}

/** `skills_remove_request` for a single skill (`{path}`) or a whole package (`{packageSource}`):
 *  no optimistic row removal — the response's `{skills, packages}` document replaces the cached
 *  list wholesale on success (swe/features/skills-manager.md § Data flow), with a domain
 *  `{ok:false}` or thrown transport error surfaced as `errors[key]` so the row/header stays in
 *  place with an inline message rather than vanishing speculatively. */
export function useSkillRemove(): UseSkillRemove {
  const client = useConnectionStore((s) => s.client);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  function clearError(key: string) {
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function run(target: SkillRemoveTarget) {
    if (!client) return;
    const key = removeTargetKey(target);
    clearError(key);
    setPending((p) => ({ ...p, [key]: true }));
    try {
      const result = await client.removeSkill(target);
      if (!result.ok) {
        setErrors((prev) => ({
          ...prev,
          [key]: skillErrorMessage(result.error, result.message) ?? "Failed to remove.",
        }));
        return;
      }
      queryClient.setQueryData(rpcKeys.skillsList(), result);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "Failed to remove.",
      }));
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  }

  return {
    pending,
    errors,
    clearError,
    removeSkill: (skill) => run({ path: skill.path }),
    removePackage: (pkg) => run({ packageSource: pkg.source }),
  };
}

export interface UseSkillUpdateAll {
  pending: boolean;
  result: SkillsUpdateAllResponse | null;
  error: string | null;
  updateAll: () => Promise<void>;
  clearResult: () => void;
}

/** `skills_update_all_request`: no per-row targeting, no optimistic patch — the response's
 *  `{skills, packages}` replaces the cached list wholesale on success, and the full response
 *  (including its per-engine `results[]`) is kept so the panel can render the two result rows
 *  (swe/features/skills-manager.md § Update all) until the next attempt or an explicit dismiss. */
export function useSkillUpdateAll(): UseSkillUpdateAll {
  const client = useConnectionStore((s) => s.client);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SkillsUpdateAllResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateAll() {
    if (!client) return;
    setPending(true);
    setError(null);
    try {
      const response = await client.updateAllSkills();
      if (!response.ok && !hasItemResults(response)) {
        setError(skillErrorMessage(response.error, response.message) ?? "Failed to update skills.");
        return;
      }
      setResult(response);
      queryClient.setQueryData(rpcKeys.skillsList(), asListDocument(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update skills.");
    } finally {
      setPending(false);
    }
  }

  return { pending, result, error, updateAll, clearResult: () => setResult(null) };
}

export interface UseSkillPreview {
  pending: boolean;
  result: SkillsPreviewResponse | null;
  error: string | null;
  preview: (source: string) => Promise<void>;
  reset: () => void;
}

/** `skills_preview_request`: `InstallSkillDialog.tsx`'s pick step. Never touches
 *  `rpcKeys.skillsList()` — a preview mutates nothing, so there is no list to patch. */
export function useSkillPreview(): UseSkillPreview {
  const client = useConnectionStore((s) => s.client);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SkillsPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function preview(source: string) {
    if (!client) return;
    setPending(true);
    setError(null);
    try {
      const response = await client.previewSkillSource(source);
      if (!response.ok) {
        setError(skillErrorMessage(response.error, response.message) ?? "Failed to preview.");
        return;
      }
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview.");
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    result,
    error,
    preview,
    reset: () => {
      setResult(null);
      setError(null);
    },
  };
}

export interface UseSkillInstall {
  pending: boolean;
  result: SkillsInstallResponse | null;
  error: string | null;
  install: (opts: { source: string; skills?: string[]; replace?: boolean }) => Promise<void>;
  reset: () => void;
}

/** `skills_install_request`: no optimistic patch — on success the response's `{skills,
 *  packages}` replaces the cached list wholesale, and the full response (including its per-item
 *  `results[]`) is kept so the dialog can render the results step until dismissed/reset. */
export function useSkillInstall(): UseSkillInstall {
  const client = useConnectionStore((s) => s.client);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SkillsInstallResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function install(opts: { source: string; skills?: string[]; replace?: boolean }) {
    if (!client) return;
    setPending(true);
    setError(null);
    try {
      const response = await client.installSkills(opts);
      if (!response.ok && !hasItemResults(response)) {
        setError(skillErrorMessage(response.error, response.message) ?? "Failed to install.");
        return;
      }
      setResult(response);
      queryClient.setQueryData(rpcKeys.skillsList(), asListDocument(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install.");
    } finally {
      setPending(false);
    }
  }

  return {
    pending,
    result,
    error,
    install,
    reset: () => {
      setResult(null);
      setError(null);
    },
  };
}
