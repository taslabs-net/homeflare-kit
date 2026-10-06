# Hooks in a subdirectory package

⚠️ **A package in a subdirectory is not supported.** The wrapper and the `node_modules`
check look for `node_modules` at the repository root, because git runs a hook there. A
layout whose package lives in a subdirectory with its own `node_modules` would fail with
"run `bun install`" and no way for that to fix it. No estate repo has that layout, so it
is stated and not handled.

Moved out of [hooks.md](./hooks.md) so that document stays under its line cap. The
behaviour is unchanged.
