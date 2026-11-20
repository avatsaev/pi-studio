/**
 * Bookkeeping for documents a host `preview` of kind `origin` has mounted for the HTML viewer. Pure
 * so the release rules are unit-tested: the current document is released exactly once when a newer
 * one replaces it, a mount that resolves after it was superseded (or after `dispose`) is released
 * at once, and `dispose` releases the current document.
 */

export interface MountedDocument {
  url: string;
  release(): void;
}

export interface PreviewMounts {
  /** Start a mount attempt. Returns its token; any earlier attempt becomes stale. */
  begin(): number;
  /**
   * Hand over the result of attempt `token`. Returns `true` when it is now current. A stale attempt
   * is released immediately and returns `false`.
   */
  settle(token: number, doc: MountedDocument): boolean;
  /** Whether `token` is still the newest attempt (failures of stale attempts are ignored). */
  isCurrent(token: number): boolean;
  /** Release the current document and make every in-flight attempt stale. */
  dispose(): void;
}

export function createPreviewMounts(): PreviewMounts {
  let latest = 0;
  let current: MountedDocument | null = null;

  return {
    begin: () => ++latest,
    isCurrent: (token) => token === latest,
    settle: (token, doc) => {
      if (token !== latest) {
        doc.release();
        return false;
      }
      const previous = current;
      current = doc;
      if (previous && previous !== doc) previous.release();
      return true;
    },
    dispose: () => {
      latest++;
      const previous = current;
      current = null;
      previous?.release();
    },
  };
}
