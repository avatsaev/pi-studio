import { useEffect, useState } from "react";

import { formatShortcut } from "../lib/shortcuts";
import type { Menu } from "../lib/types";
import styles from "./MenuBar.module.css";

// The menus are data from the shell, generated from the command registry. This component adds
// nothing to them: it draws each entry and reports the id that was chosen.
export function MenuBar({ menus, mac, onInvoke }: { menus: Menu[]; mac: boolean; onInvoke: (id: string) => void }) {
  // Which menu is open is nobody else's business, so it stays here.
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const close = () => setOpen(null);
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeydown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKeydown);
    };
  }, []);

  function choose(id: string) {
    setOpen(null);
    onInvoke(id);
  }

  return (
    <nav className={styles.menubar} aria-label="Menu bar">
      {menus.map((menu) => (
        <div key={menu.label} className={styles.menu}>
          <button
            type="button"
            className={open === menu.label ? `${styles.top} ${styles.open}` : styles.top}
            aria-haspopup="menu"
            aria-expanded={open === menu.label}
            onClick={(event) => {
              // Keep this click from the window listener above, which would close the menu again.
              event.stopPropagation();
              setOpen(open === menu.label ? null : menu.label);
            }}
            onMouseEnter={() => {
              if (open) {
                setOpen(menu.label);
              }
            }}
          >
            {menu.label}
          </button>
          {open === menu.label && (
            <div className={styles.items} role="menu" aria-label={menu.label}>
              {menu.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role={item.checked === null ? "menuitem" : "menuitemcheckbox"}
                  aria-checked={item.checked ?? undefined}
                  disabled={!item.enabled}
                  title={item.reason ?? undefined}
                  onClick={() => choose(item.id)}
                >
                  <span className={styles.check} aria-hidden="true">
                    {item.checked ? "✓" : ""}
                  </span>
                  <span className={styles.label}>{item.label}</span>
                  {item.shortcut && <kbd>{formatShortcut(item.shortcut, mac)}</kbd>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
