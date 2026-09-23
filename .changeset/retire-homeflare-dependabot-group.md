---
'@homeflare/config': minor
---

`repo-shape` no longer renders a `homeflare` Dependabot group or
`.github/workflows/dependabot-automerge.yml`. `taslabs-net/homeflare-bumper` carries a
kit release into each consumer now, dispatched from the kit's own `release.yml`
(`notify-consumers`) with a schedule backstop — Dependabot's job is everything else.

The bun `updates` block gains `ignore: [{ dependency-name: '@homeflare/*' }]` so
Dependabot never proposes what the bumper already owns (the two would otherwise race and
occasionally open two pull requests for the same bump), and drops back to a weekly
schedule — the daily cadence existed only to catch a kit release quickly, which is now
the bumper's job over a channel Dependabot never sees.

A repository on the old shape loses its `homeflare` group and its
`dependabot-automerge.yml` on the next `bun run repo-shape:refresh`; nothing else in
`RepoShape` changes, so no repository needs a code change to pick this up.
