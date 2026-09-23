---
'@homeflare/config': patch
---

Fix two shared pre-commit bugs, both measured 2026-09-23:

- A staged file wholly excluded by oxfmt's or oxlint's own `ignorePatterns` (a vendored,
  ignored path, say) made the commit fail with "oxfmt could not format the staged files",
  even though there was nothing left to format. Both tools now run with their own
  documented `--no-error-on-unmatched-pattern`, so the step passes and says
  `no formattable staged files`; a real formatting or lint failure still fails exactly as
  before.
- The hook ran bare `oxfmt`, which auto-discovers only `.oxfmtrc.json`/`.oxfmtrc.jsonc`
  (checked against the pinned version). A repo configured with `.oxfmtrc.mjs` got
  formatted with oxfmt's built-in defaults instead of its own style, silently. The hook
  now resolves the repo's actual `.oxfmtrc.*` and passes it with `--config`; two or more
  unrecognized configs fail the commit loudly instead of guessing which one governs.
