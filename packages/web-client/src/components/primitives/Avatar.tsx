/**
 * ProjectAvatar — shows a data-URI image or a deterministic colored initial fallback.
 * ui-components.md § Surfaces / badges / chips / avatars
 */

import styles from "./Avatar.module.css";
import { avatarColor, avatarInitial } from "@pi-studio-ui/ui/avatar.js";

export interface AvatarProps {
  /** Project/entity key used to derive color + initial when no image. */
  projectKey: string;
  /** Optional data URI (or any image URL) to show instead of the fallback. */
  src?: string;
  /** Size in pixels (both width and height). */
  size?: number;
  className?: string;
}

export function Avatar({ projectKey, src, size = 32, className }: AvatarProps) {
  const initial = avatarInitial(projectKey);
  const bg = avatarColor(projectKey);
  const fontSize = Math.round(size * 0.4);

  return (
    <span
      className={`${styles.avatar}${className ? ` ${className}` : ""}`}
      style={{ width: size, height: size, backgroundColor: src ? undefined : bg }}
      aria-label={projectKey}
      role="img"
    >
      {src ? (
        <img src={src} alt={projectKey} className={styles.avatarImg} />
      ) : (
        <span className={styles.avatarFallback} style={{ fontSize }} aria-hidden>
          {initial}
        </span>
      )}
    </span>
  );
}
