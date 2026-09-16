---
'@homeflare/alchemy': patch
---

Fix the peer contract: 0.1.0 installed cleanly and threw at import.

Measured 2026-09-16 against the published 0.1.0 in a clean consumer install — three
defects, none of which failed at install time:

1. **`@effect/platform-node` was a devDependency**, so a consumer got
   `Cannot find module '@effect/platform-node/NodeServices'`. Alchemy's module graph
   reaches `Cloudflare/Workers/WorkerBridge` even when you only import `/proxmox`, so it
   is a required peer, not an optional one.
2. **The `effect` peer was ranged** `>=4.0.0-rc.112`, which resolves to rc.115 —
   `TypeError: Config.string is not a function`. Effect's rc line is not
   semver-compatible with itself, so a range is a promise this package cannot keep. Peers
   are pinned exactly now.
3. **`@effect/platform-node-shared` still resolves up** to rc.115 against effect rc.112
   (`Cannot find module 'effect/ByteSize'`), because `platform-bun@rc.112` asks for
   `^4.0.0-rc.112`. Only a consumer-side `overrides` block holds the set together, and the
   README now says so with the exact block to paste.

⛔ The smoke script was `echo '…exercised by the consuming stack'` — a check that cannot
fail, which is how all three shipped. It now packs the tarball, installs it the way the
README says, and **imports every subpath**, because each of these threw at import rather
than at install.
