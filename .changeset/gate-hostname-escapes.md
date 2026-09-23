---
'@homeflare/typesafe': patch
---

Fix `packages/typesafe/src/gate/generated/gitleaks-rules-emitted.ts`'s `sidekiq-sensitive-url`
and `slack-webhook-url` rules to escape the literal `.` in their hostname literals
(`gems.contribsys.com`, `enterprise.contribsys.com`, `hooks.slack.com`), addressing CodeQL's
"Incomplete regular expression for hostnames" alerts on PR 162. Fixed in the generator
(`HOSTNAME_DOT_ESCAPES` in `packages/typesafe/scripts/gen-gate-tables-rules.ts`), never by
hand-editing the generated file — an unescaped `.` in a secret DETECTOR widens the match
(as a regex, `.` matches any character, `\.` only a literal dot), so this was not a validation
bypass. One narrow caveat found on adversarial review and recorded in
`HOSTNAME_DOT_ESCAPES`'s own comment: `gate/scan.ts` normalizes input with NFKC only, which
does not fold IDNA-equivalent full-stop lookalikes (U+3002, U+FF61) to ASCII `.` — a real,
IDNA-resolvable URL spelled with one of those was incidentally caught by the old loose `.` and
is not caught by `\.` for these two rules. Not new: `microsoft-teams-webhook` already escapes
its dots upstream and already has this gap on main; not fixed here, since folding IDNA
lookalikes belongs in `scan.ts`'s normalization, a broader change than this generator fix.
