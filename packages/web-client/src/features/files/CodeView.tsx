/**
 * CodeView — highlighted, read-only file body with a line-number gutter (POC `showFile`/
 * `reloadFileInPanel`, chat.html ~line 812-828, POC_TO_APP_PLAN_UI.md §4.5). Built on CodeMirror 6
 * (`@uiw/react-codemirror`) rather than a hand-rolled `<pre>` + separate gutter `<pre>`: the two
 * previously drifted out of sync on scroll (independent scroll containers, no shared scroll
 * anchor) whenever content was long enough to scroll or lines wrapped. CodeMirror owns a single
 * scrollable viewport with gutter and content painted from the same layout pass, so this class of
 * bug cannot recur.
 */

import { useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { languages } from "@codemirror/language-data";
import { LanguageDescription, type LanguageSupport, foldGutter } from "@codemirror/language";
import { githubDark } from "@uiw/codemirror-theme-github";
import styles from "./CodeView.module.css";

export interface CodeViewProps {
  path: string;
  content: string;
}

// `LanguageDescription.support` is populated lazily by `.load()`, which dynamically imports the
// grammar the first time a given language is used and resolves instantly (cached) after that.
const supportCache = new Map<string, LanguageSupport>();

function useLanguageExtension(path: string): Extension[] {
  const [support, setSupport] = useState<LanguageSupport | null>(null);

  useEffect(() => {
    const desc = LanguageDescription.matchFilename(languages, path);
    if (!desc) {
      setSupport(null);
      return;
    }
    const cached = supportCache.get(desc.name);
    if (cached) {
      setSupport(cached);
      return;
    }
    let cancelled = false;
    setSupport(null);
    void desc.load().then((loaded) => {
      supportCache.set(desc.name, loaded);
      if (!cancelled) setSupport(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return support ? [support] : [];
}

export function CodeView({ path, content }: CodeViewProps) {
  const languageExt = useLanguageExtension(path);
  const extensions: Extension[] = [EditorView.lineWrapping, foldGutter(), ...languageExt];

  return (
    <div className={styles.wrap}>
      <CodeMirror
        value={content}
        theme={githubDark}
        extensions={extensions}
        editable={false}
        readOnly
        basicSetup={{
          highlightActiveLine: false,
          foldGutter: false,
          searchKeymap: false,
        }}
        height="100%"
      />
    </div>
  );
}
