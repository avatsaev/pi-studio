# Summary — sprint-089 task-002 themeboundary-store-key

## What was built
`ThemeBoundary`'s `store` is optional (defaults to `localStorageKvStore`) and it takes a `storageKey`. `createAppearanceController(store, brandConfig?, { storageKey? })`; exported `DEFAULT_APPEARANCE_STORAGE_KEY = "pi-studio-appearance"` (unchanged, so saved web-client settings survive) and `AppearanceControllerOptions`. web-client `AppProviders` now renders `<ThemeBoundary>` with no props. Hoisted `resolveThemeName` and removed a shadowed param while touching the controller.

## Acceptance criteria
- [x] AC5: tests with an in-memory store: a value under the default key is honoured; with `storageKey: "other-app"` the default key is neither read nor written. [x] Existing appearance tests pass unchanged.

## Commands run
`npx vitest run` 258 files / 3532 tests; `npx tsc -b` (+ web-client) clean; oxfmt clean.
