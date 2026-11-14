# Summary — sprint-089 task-005 token-guard-checker (implemented by subagent ImperialDragonfly)

## What was built
Pure, node-free `findTokenProblems(files)` in `theme/token-guard.ts` (kinds: `dangling-var`, `illegal-key`, `literal-font-size`, `unknown-font-rung`) plus `countTokenUsage`, exported from `/theme`. Library test: in-memory fixtures (clean, dynamic `${` ref skipped, commented ref, `var(--pi-color-nope)`, `font-size: 12px`, bad rung) + a real-tree scan of `packages/ui-library/src` (test files excluded because they hold deliberately bad fixtures) + the BUTTON_FONT_SIZE rung test. web-client `design-tokens.test.ts` is now a thin caller over web-client src only (`font-scale.test.ts` deleted; its checks live in the checker + library test). Interim double-root scan removed.

## Acceptance criteria
- [x] AC7: injecting a dangling var or literal font size fails the checker (in-memory tests); both package trees pass. [x] Checker has no `node:` imports.
- Gallery guard test is s090/task-001.

## Commands run
Full suite 258 files / 3532 tests; `npx tsc -b` clean.
