/**
 * AppearancePanel — the Settings dialog's Appearance category: the theme (a card per named theme,
 * each a small preview drawn in that theme's own colours, plus "match the system") and the
 * window's zoom. Client-only: nothing here talks to the daemon.
 *
 * The theme goes through ui-library's appearance controller (`useAppearanceControls`), which
 * applies and stores it. The zoom is the workbench's (`zoom-store.ts`) and needs the host's
 * `zoom`; a browser has no such member and keeps its own zoom, so the panel says where it is.
 */

import { Minus, Plus } from "lucide-react";
import { clsx } from "clsx";
import {
  Button,
  IconButton,
  Icon,
  Switch,
  THEME_NAMES,
  THEME_VARIANTS,
  useAppearance,
  useAppearanceControls,
  type ThemeName,
} from "@av-pi-studio/ui-library";
import { getHost } from "../../host/install.js";
import { useZoomStore, ZOOM_LEVELS } from "../../stores/zoom-store.js";
import styles from "./AppearancePanel.module.css";

const THEME_LABELS: Record<ThemeName, string> = {
  dark: "Dark",
  light: "Light",
  zinc: "Zinc",
  midnight: "Midnight",
  claude: "Claude",
  ghostty: "Ghostty",
};

/** Dark first: the default theme leads, then the rest in the registry's order. */
const THEME_ORDER: readonly ThemeName[] = [
  "dark",
  ...THEME_NAMES.filter((name) => name !== "dark"),
];

const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

/** A miniature window in `name`'s own colours: a sidebar, a title, a text line and the ANSI dots. */
function ThemePreview({ name }: { name: ThemeName }) {
  const c = THEME_VARIANTS[name].colors;
  const dots = [
    c.terminal.red,
    c.terminal.yellow,
    c.terminal.green,
    c.terminal.cyan,
    c.terminal.blue,
    c.terminal.magenta,
  ];
  return (
    <span
      className={styles.preview}
      style={{ background: c.surface0, borderColor: c.border }}
      aria-hidden
    >
      <span
        className={styles.previewSidebar}
        style={{ background: c.surfaceSidebar, borderColor: c.border }}
      >
        <span className={styles.previewRow} style={{ background: c.accent }} />
        <span className={styles.previewRow} style={{ background: c.surface2 }} />
        <span className={styles.previewRow} style={{ background: c.surface2 }} />
      </span>
      <span className={styles.previewMain}>
        <span className={styles.previewTitle} style={{ color: c.foreground }}>
          Aa
        </span>
        <span className={styles.previewLine} style={{ background: c.foregroundMuted }} />
        <span className={styles.previewDots}>
          {dots.map((color, i) => (
            <span key={i} className={styles.previewDot} style={{ background: color }} />
          ))}
        </span>
      </span>
    </span>
  );
}

function ThemeSection() {
  const { mode, resolvedTheme } = useAppearance();
  const { setMode } = useAppearanceControls();
  const followSystem = mode === "system";

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Theme</h3>
      <div className={styles.grid}>
        {THEME_ORDER.map((name) => {
          const selected = resolvedTheme.name === name;
          return (
            <button
              key={name}
              type="button"
              className={clsx(styles.card, selected && styles.cardSelected)}
              aria-pressed={selected}
              onClick={() => setMode(name)}
            >
              <ThemePreview name={name} />
              <span className={styles.cardLabel}>{THEME_LABELS[name]}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.name}>Match the system</span>
          <span className={styles.description}>
            Use Light or Dark, following your system's setting.
          </span>
        </div>
        <Switch
          checked={followSystem}
          onCheckedChange={(next) => setMode(next ? "system" : resolvedTheme.name)}
          aria-label="Match the system"
        />
      </div>
    </section>
  );
}

function ZoomSection() {
  const factor = useZoomStore((s) => s.factor);
  const apply = useZoomStore((s) => s.apply);
  const keys = (
    <>
      <kbd className={styles.kbd}>{MOD_KEY} + =</kbd>,{" "}
      <kbd className={styles.kbd}>{MOD_KEY} + −</kbd> and{" "}
      <kbd className={styles.kbd}>{MOD_KEY} + 0</kbd>
    </>
  );

  if (!getHost().zoom) {
    return (
      <section className={styles.section}>
        <h3 className={styles.heading}>Zoom</h3>
        <p className={styles.note}>Use your browser's zoom to scale the interface: {keys}.</p>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Zoom</h3>
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.name}>Interface scale</span>
          <span className={styles.description}>Zoom in, out and back to 100% with {keys}.</span>
        </div>
        <div className={styles.zoomControls}>
          <IconButton
            title="Zoom out"
            aria-label="Zoom out"
            disabled={factor <= ZOOM_LEVELS[0]!}
            onClick={() => apply("out")}
          >
            <Icon icon={Minus} size="sm" />
          </IconButton>
          <span className={styles.zoomValue} aria-live="polite">
            {Math.round(factor * 100)}%
          </span>
          <IconButton
            title="Zoom in"
            aria-label="Zoom in"
            disabled={factor >= ZOOM_LEVELS.at(-1)!}
            onClick={() => apply("in")}
          >
            <Icon icon={Plus} size="sm" />
          </IconButton>
          <Button size="xs" variant="ghost" disabled={factor === 1} onClick={() => apply("reset")}>
            Reset
          </Button>
        </div>
      </div>
    </section>
  );
}

export function AppearancePanel() {
  return (
    <div className={styles.panel}>
      <ThemeSection />
      <ZoomSection />
    </div>
  );
}
