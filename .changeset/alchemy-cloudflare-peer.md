---
'@homeflare/alchemy': patch
---

`cloudflare` is a required peer, not an optional one.

Measured 2026-09-16 against the published 0.1.1 in a clean consumer install: importing
`@homeflare/alchemy/cloudflare` without it throws `Cannot find package 'cloudflare'`.
Marking it optional claimed the subpath would degrade gracefully; it does not load at all.
An optional peer should mean a _feature_ is absent, not that an import fails.

⛔ **Why this got through, and what now stops it.** The README's pinned install command and
the smoke test's install command disagreed — the smoke test installed `cloudflare`, the
README never mentioned it, and nothing compared the two. So the gate proved an install no
consumer would ever perform.

`tests/peers.test.ts` now asserts the manifest, the README and the smoke script agree:
every declared peer appears in all three, peers are pinned rather than ranged, and none is
marked optional.
