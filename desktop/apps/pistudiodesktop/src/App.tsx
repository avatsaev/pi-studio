import { useEffect, useState } from "react";

import styles from "./App.module.css";
import { Items } from "./components/Items";
import { MenuBar } from "./components/MenuBar";
import { StatusBar } from "./components/StatusBar";
import { findShortcut, isMac } from "./lib/shortcuts";
import type { Backend, View } from "./lib/types";

const mac = isMac();

export function App({ backend }: { backend: Backend }) {
  // The whole screen is a function of this one value, which the shell owns and sends.
  const [view, setView] = useState<View | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let stop = () => {};
    let gone = false;
    void backend
      .onView((next) => setView(next))
      .then((unlisten) => {
        if (gone) {
          unlisten();
        } else {
          stop = unlisten;
        }
      });
    void backend.control("ui.inspect").then((reply) => {
      if (gone) {
        return;
      }
      if (!reply.ok) {
        setFailure(reply.error);
      } else {
        // A `view` event that arrived first is newer than this answer.
        setView((current) => current ?? (reply.result as View));
      }
    });
    return () => {
      gone = true;
      stop();
    };
  }, [backend]);

  const theme = view?.ui.theme;
  useEffect(() => {
    if (theme) {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  const menus = view?.menus;
  useEffect(() => {
    if (!menus) {
      return;
    }
    const onKeydown = (event: KeyboardEvent) => {
      const id = findShortcut(menus, event, mac);
      if (id) {
        event.preventDefault();
        void backend.invoke(id);
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [menus, backend]);

  if (!view) {
    return <p className={styles.loading}>{failure || "Loading Pi Studio…"}</p>;
  }
  return (
    <div className={styles.app}>
      <MenuBar menus={view.menus} mac={mac} onInvoke={(id) => void backend.invoke(id)} />
      <main className={styles.main}>
        <Items document={view.document} hideDone={view.ui.hideDone} backend={backend} />
      </main>
      <StatusBar document={view.document} status={view.ui.status} />
    </div>
  );
}
