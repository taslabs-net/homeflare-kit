---
'@homeflare/config': minor
---

Worker/TanStack apps can extend the toolchain without rewriting generated OpenAPI.

**`oxlintrc.app.json`** — library oxlint with `--deny-warnings` failed on correct
app code (measured 2026-09-16): `console.error` is Workers Logs, Alchemy/`Worker`
entry files export default, tests use `!`, Kumo initials triggers fail
`control-has-associated-label`. Apps extend this file, not the library preset.

**oxfmt ignores merge.** `checkProject()` no longer requires a byte-identical
`.oxfmtrc.json`. Extra `ignorePatterns` are allowed; dropping a house ignore or
changing `singleQuote` is still drift. House ignores now cover `vendor/`,
`**/generated/**`, `**/*.gen.ts`, and OpenAPI artefacts so a copy does not
format generated files.
