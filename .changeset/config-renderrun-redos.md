---
'@homeflare/config': patch
---

Fix CodeQL alert 5, js/polynomial-redos (high), in `renderRun`
(`packages/config/src/repo-shape/yaml.ts`, in from PR 125 / commit bc3e1fa). It ran
`command.replace(/\n+$/, '')` on repository-configured step text, and that regex
backtracks polynomially on a long run of trailing `\n`.

Trailing `\n` characters are now trimmed with a linear loop, `trimTrailingNewlines`,
the same pattern as `normalizeBaseUrl` in `packages/distilled-netbox/src/credentials.ts`
(PR 184). Behaviour is byte-identical: a test compares it against the old regex over
seven edge cases plus a 100,000-newline input, and asserts the long input stays fast.
