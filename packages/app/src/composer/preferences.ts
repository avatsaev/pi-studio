// Create-agent preferences store.
// clean-room-scope/features/composer-ui.md § Create-agent preferences

import type { LayoutStorage } from "../workspace/layout-store.js";

export type ProviderPreferences = {
  model?: string;
  mode?: string;
  thinkingByModel?: Record<string, string>;
  featureValues?: Record<string, unknown>;
};

export type FavoriteModel = { provider: string; modelId: string };

export type FormPreferences = {
  provider?: string;
  providerPreferences?: Record<string, ProviderPreferences>;
  favoriteModels?: FavoriteModel[];
  isolation?: "local" | "worktree";
};

export function prefStoreKey(projectKey: string): string {
  return `pi-studio-create-agent-prefs:${projectKey}`;
}

export class CreateAgentPrefsStore {
  constructor(private readonly storage: LayoutStorage) {}

  load(projectKey: string): FormPreferences {
    const raw = this.storage.getItem(prefStoreKey(projectKey));
    if (!raw) return {};
    try { return JSON.parse(raw) as FormPreferences; } catch { return {}; }
  }

  save(projectKey: string, prefs: FormPreferences): void {
    this.storage.setItem(prefStoreKey(projectKey), JSON.stringify(prefs));
  }

  setProvider(projectKey: string, provider: string): FormPreferences {
    const prefs = { ...this.load(projectKey), provider };
    this.save(projectKey, prefs);
    return prefs;
  }

  setModel(projectKey: string, provider: string, model: string): FormPreferences {
    const prefs = this.load(projectKey);
    const pp = { ...(prefs.providerPreferences?.[provider] ?? {}), model };
    const updated: FormPreferences = { ...prefs, providerPreferences: { ...prefs.providerPreferences, [provider]: pp } };
    this.save(projectKey, updated);
    return updated;
  }

  setMode(projectKey: string, provider: string, mode: string): FormPreferences {
    const prefs = this.load(projectKey);
    const pp = { ...(prefs.providerPreferences?.[provider] ?? {}), mode };
    const updated: FormPreferences = { ...prefs, providerPreferences: { ...prefs.providerPreferences, [provider]: pp } };
    this.save(projectKey, updated);
    return updated;
  }

  setThinking(projectKey: string, provider: string, model: string, thinkingLevel: string): FormPreferences {
    const prefs = this.load(projectKey);
    const existing = prefs.providerPreferences?.[provider] ?? {};
    const pp = { ...existing, thinkingByModel: { ...(existing.thinkingByModel ?? {}), [model]: thinkingLevel } };
    const updated: FormPreferences = { ...prefs, providerPreferences: { ...prefs.providerPreferences, [provider]: pp } };
    this.save(projectKey, updated);
    return updated;
  }

  toggleFavoriteModel(projectKey: string, provider: string, modelId: string): FormPreferences {
    const prefs = this.load(projectKey);
    const favorites = prefs.favoriteModels ?? [];
    const exists = favorites.some((f) => f.provider === provider && f.modelId === modelId);
    const updated: FormPreferences = {
      ...prefs,
      favoriteModels: exists ? favorites.filter((f) => !(f.provider === provider && f.modelId === modelId)) : [...favorites, { provider, modelId }],
    };
    this.save(projectKey, updated);
    return updated;
  }

  isFavorite(prefs: FormPreferences, provider: string, modelId: string): boolean {
    return prefs.favoriteModels?.some((f) => f.provider === provider && f.modelId === modelId) ?? false;
  }

  prefillDefaults(prefs: FormPreferences, provider: string): ProviderPreferences {
    return prefs.providerPreferences?.[provider] ?? {};
  }
}
