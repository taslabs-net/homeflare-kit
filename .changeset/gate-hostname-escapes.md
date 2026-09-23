---
'@homeflare/typesafe': patch
---

Fix `packages/typesafe/src/gate/generated/gitleaks-rules-emitted.ts`'s `sidekiq-sensitive-url`
and `slack-webhook-url` rules to escape the literal `.` in their hostname literals
(`gems.contribsys.com`, `enterprise.contribsys.com`, `hooks.slack.com`), addressing CodeQL's
"Incomplete regular expression for hostnames" alerts on PR 162. Fixed in the generator
(`HOSTNAME_DOT_ESCAPES` in `packages/typesafe/scripts/gen-gate-tables-rules.ts`), never by
hand-editing the generated file — an unescaped `.` in a secret DETECTOR only widens the match
(more refusals, never a missed secret), so this was not a validation bypass, but an escaped `.`
is strictly more correct with no behavior change on any real input.
