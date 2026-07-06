/**
 * HomeScreen — /h/:serverId/open-project and /open-project (global).
 * Tile-based landing page with quick actions.
 * app-navigation-screens.md § Open-project (host home)
 */

import { useMemo } from "react";
import styles from "./HomeScreen.module.css";
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
      <div className={styles.logo} aria-hidden>
        <svg viewBox="0 0 48 48" width="48" height="48">
          <circle cx="24" cy="24" r="20" fill="var(--pi-color-accent, #20744a)" opacity="0.15" />
          <circle cx="24" cy="24" r="9" fill="var(--pi-color-accent, #20744a)" />
        </svg>
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

      <div className={styles.communityLinks}>
        <span>Docs</span>
        <span>Community</span>
      </div>
    </div>
  );
}
