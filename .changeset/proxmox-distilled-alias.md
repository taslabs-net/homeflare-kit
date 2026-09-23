---
'@homeflare/alchemy': patch
---

`packages/alchemy` now depends on `@distilled.cloud/proxmox`, aliased per
`packages/alchemy/docs/distilled-interim.md`'s interim-package route onto
the published `@homeflare/distilled-proxmox@0.2.0`
(`"npm:@homeflare/distilled-proxmox@0.2.0"` in `dependencies`, not
`peerDependencies` — the package needs it resolved, not left to whoever
installs it). This is the follow-up PR `distilled-proxmox-interim.md`
called out: the alias, plus `src/proxmox/distilled-task-await.test.ts`
(ported off draft PR 182's dev-only `link:` dependency onto the real alias,
assertions unchanged) proving `awaitTask`'s poll-until-exitstatus loop
against a fake PVE — success only on `exitstatus` exactly `"OK"`,
`"OK (warnings)"` fails, and a bare 400 is the non-retryable `BadRequest`
(that last case already lives in `packages/distilled-proxmox/src/protocol.test.ts`,
merged with the package itself).

No existing `packages/alchemy/src/proxmox/*` resource is touched or moved
onto the distilled package — that migration is still a separate, later PR.
Because `@homeflare/distilled-proxmox` is also a sibling workspace package,
bun resolves the alias to the local workspace copy rather than fetching the
npm tarball (same unmodified code either way); that local copy has no
prebuilt `dist` by default, and `tsc`'s `moduleResolution: "bundler"`
follows the alias's `exports["."].types` straight to `dist/index.d.ts` when
typechecking the new test file — `bun test` itself needs no such build
(it resolves the package's own `bun` export condition straight to `src`).
`packages/alchemy/package.json` gets a `pretypes` script
(`bun run --filter '@homeflare/distilled-proxmox' build`) so `bun run
types` — and therefore `bun run check` — builds that one dependency first;
nothing else changes.
