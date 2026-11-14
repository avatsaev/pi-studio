# @av-pi-studio/ui-library

Reusable React UI primitives, theme system and global styles for Pi-Studio client apps.
Targets Vite web SPAs and Electron renderers. No SSR, no React Native.

## Install

```sh
npm i @av-pi-studio/ui-library react react-dom
```

Peer dependencies: `react` and `react-dom` `^19`. Radix (dialog, dropdown-menu, popover),
`lucide-react`, `clsx`, `zustand` and `zod` are regular dependencies.

## Quickstart

Import the library CSS **before your own CSS**. Library class names carry the `piui-` prefix and
design tokens are `--pi-*` CSS variables. `styles.css` is required; `reset.css` is an optional
global reset.

<!-- smoke:main.tsx -->
```tsx
import "@av-pi-studio/ui-library/reset.css";
import "@av-pi-studio/ui-library/styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  Announcer,
  Button,
  Switch,
  ThemeBoundary,
  ToastViewport,
  useToastStore,
} from "@av-pi-studio/ui-library";

function App() {
  const show = useToastStore((s) => s.show);
  return (
    <main style={{ padding: 16, display: "grid", gap: 12, justifyItems: "start" }}>
      <Button id="smoke-button" onClick={() => show("Hello from ui-library")}>
        Show toast
      </Button>
      <Switch checked onCheckedChange={() => {}} aria-label="Example switch" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeBoundary>
      <App />
      <ToastViewport />
      <Announcer />
    </ThemeBoundary>
  </StrictMode>,
);
```
<!-- /smoke:main.tsx -->

- `ThemeBoundary` applies the theme (light/dark/system) to the document and provides
  `useAppearance()`. Props (all optional):
  - `storageKey` — key the appearance JSON is stored under (default `pi-studio-appearance`).
  - `store` — a custom key-value store instead of `localStorage` (see `localStorageKvStore`).
  - `brandConfig` — e.g. `{ colors: { accent: "#7c3aed" } }` to re-theme the accent.
- `ToastViewport` and `Announcer` are **not** mounted automatically; mount them once, inside
  `ThemeBoundary`. Fire toasts with `useToastStore.getState().show("text")` (also `copied`,
  `error`) and screen-reader announcements with `speak()`.

### Switching the theme

`useAppearanceControls()` (root entry, under `ThemeBoundary`) returns `{ setMode, updateSettings }`;
changes are applied to the document and persisted. `useAppearance()` reads the current state.

```tsx
import { Button, THEME_NAMES, useAppearance, useAppearanceControls } from "@av-pi-studio/ui-library";

function ThemeSwitcher() {
  const { mode } = useAppearance();
  const { setMode } = useAppearanceControls();
  return (
    <>
      {(["system", ...THEME_NAMES] as const).map((name) => (
        <Button key={name} variant={name === mode ? "default" : "outline"} onClick={() => setMode(name)}>
          {name}
        </Button>
      ))}
    </>
  );
}
```

## Components

`Button`, `IconButton`, `Dialog`, `Menu*`, `Popover*`, `Panel`, `Surface`, `Select`, `Combobox`,
`Switch`, `Checkbox`, `TextInput`, `TextArea`, `Icon`, `Spinner`, `StatusDot`, `StatusBadge`,
`Avatar`, `EmptyState`, `ScrollArea`, `Divider`, `ResizeHandle`, `ShortcutHint`. Types ship
alongside (`ButtonProps`, ...).

`Menu*` is half of a menu: `MenuContent`, `MenuItem`, `MenuGroup`, `MenuSeparator` and
`MenuCursorTrigger` ship, but `Root`/`Trigger` do not — install `@radix-ui/react-dropdown-menu`
yourself and import `DropdownMenu.Root`/`.Trigger` from it.

## Entry points

Only these resolve (the `exports` map); deep imports such as `.../src/...` or `.../dist/...` are
rejected.

| Specifier | Contents |
| --- | --- |
| `@av-pi-studio/ui-library` | Everything: components, `ThemeBoundary`, hooks, stores, and the subpaths below |
| `.../theme` | Theme/appearance logic and token helpers (`findTokenProblems`), React-free |
| `.../ui` | Pure UI logic (button/toast helpers), React-free |
| `.../brand` | `BrandConfig` schema and accent derivation, React-free |
| `.../breakpoints` | Breakpoint constants, React-free |
| `.../styles.css` | Required global styles and `--pi-*` tokens |
| `.../reset.css` | Optional global reset |

## Constraints

- One `ThemeBoundary` per document.
- One copy of the package per app: the toast and announcer stores are module singletons.
- React `^19`.
- A bundler (Vite, etc.) is required: dev-only warnings read `process.env.NODE_ENV`, which the
  bundler folds. Loading the ESM unbundled would throw `ReferenceError: process` in dev.
- No SSR, no React Native.

## Dev-only warnings

In development builds the library logs a console warning when `styles.css` is not loaded, when a
second `ThemeBoundary` mounts, or when `brandConfig` is invalid. They are stripped from
production bundles.

## Verifying a release

`bash packages/ui-library/scripts/pack-smoke.sh` packs the library, installs the tarball into a
scratch Vite app outside the repo using the Quickstart snippet above, and checks types, build,
`exports` and CSS. `KEEP_DIR=1` keeps the scratch dir.
