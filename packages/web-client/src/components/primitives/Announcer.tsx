/**
 * Announcer — the app's one off-screen `aria-live` region for `features/agent-ui/announce.ts`'s
 * § 08 pending-question transitions and § 11 `notify`/`set_editor_text` copy (sprint-069/task-008).
 * Mount exactly once, at the app-shell level — `WorkspacePage.tsx`, alongside `ToastViewport`.
 *
 * Two separate always-mounted regions, one `role="status"` (`aria-live="polite"`) and one
 * `role="alert"` (implicit `aria-live="assertive"`) — toggling a single element's `aria-live`
 * value at runtime is not reliably picked up by assistive tech, so `announcer-store.ts`'s
 * `politeness` instead selects which of these two ever receives text; the other is left empty,
 * which is itself silent (removing/never-setting content is not announced).
 */

import { useAnnouncerStore } from "@pi-studio-ui/stores/announcer-store.js";
import styles from "./Announcer.module.css";

export function Announcer() {
  const message = useAnnouncerStore((s) => s.message);
  const politeness = useAnnouncerStore((s) => s.politeness);

  return (
    <>
      <span className={styles.visuallyHidden} role="status" aria-live="polite">
        {politeness === "polite" ? message : ""}
      </span>
      <span className={styles.visuallyHidden} role="alert">
        {politeness === "assertive" ? message : ""}
      </span>
    </>
  );
}
