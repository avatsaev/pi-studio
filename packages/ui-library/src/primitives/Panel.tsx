/**
 * Panel — full-height flex-column container, the shell every tab/sidebar panel starts from
 * (ChatPanel, FilePanel, MoleculeViewerPanel, RightSidebar, TextViewer, SessionList — all were
 * byte-identical local `.panel`/`.wrap` CSS classes). ui-components.md § Surfaces
 */

import { type HTMLAttributes } from "react";
import { clsx } from "clsx";
import styles from "./Panel.module.css";

export type PanelProps = HTMLAttributes<HTMLDivElement>;
export function Panel({ className, ...rest }: PanelProps) {
  return <div className={clsx(styles.panel, className)} {...rest} />;
}
