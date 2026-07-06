/**
 * HomeScreen — /h/:serverId/open-project and /open-project (global).
 * Calm tile-based landing page. app-navigation-screens.md § Open-project.
 *
 * Paseo parity: quiet centered layout, generous whitespace, a single accent
 * CTA (the primary tile), muted secondary tiles. docs/design.md §1,§3,§7.
 */

import { useMemo } from "react";
import styles from "./HomeScreen.module.css";
import { ScreenTitle } from "../primitives/ScreenTitle.js";
import {
  visibleOpenProjectTiles,
  openProjectTileLayout,
  type OpenProjectContext,
  type OpenProjectTileId,
  type TileLayout,
} from "../../screens/open-project.js";

export interface HomeScreenProps {
  context: OpenProjectContext;
  /** Viewport width for tile layout. */
  width?: number;
  onTilePress: (tileId: OpenProjectTileId) => void;
}

export function HomeScreen({ context, width = 800, onTilePress }: HomeScreenProps) {
  const tiles = useMemo(() => visibleOpenProjectTiles(context), [context]);
  const layout: TileLayout = openProjectTileLayout(width);

  return (
    <div className={styles.container}>
      <div className={styles.hero}>
        <div className={styles.logo} aria-hidden>
          <svg viewBox="0 0 48 48" width="44" height="44">
            <circle cx="24" cy="24" r="20" fill="var(--pi-color-accent)" opacity="0.15" />
            <circle cx="24" cy="24" r="9" fill="var(--pi-color-accent)" />
          </svg>
        </div>
        <ScreenTitle className={styles.title}>Pi Studio</ScreenTitle>
        <p className={styles.subtitle}>A local-first AI coding agent you control.</p>
      </div>

      <div className={styles.tiles} data-layout={layout}>
        {tiles.map((tile) => (
          <button
            key={tile.id}
            className={`${styles.tile}${tile.accent ? ` ${styles.tileAccent}` : ""}`}
            onClick={() => onTilePress(tile.id)}
          >
            {tile.label}
          </button>
        ))}
      </div>

      <div className={styles.footer}>
        <span className={styles.footerLink}>Docs</span>
        <span className={styles.footerLink}>Community</span>
      </div>
    </div>
  );
}
