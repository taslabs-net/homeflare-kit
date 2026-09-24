# Peers — and why each pin exists

The install line for `@homeflare/alchemy`, and why every peer on it and every entry in the
`overrides` block is required. The block itself, which every consumer copies, is in the
[README](../README.md#peers--and-one-override-you-need).

```sh
bun add @homeflare/alchemy alchemy@2.0.0-beta.79 effect@4.0.0-rc.115 \
        @effect/platform-node@4.0.0-rc.115 mime@4.1.0 \
        @distilled.cloud/cloudflare@1.0.0-rc.12 @distilled.cloud/forgejo@1.0.0-rc.12 \
        @distilled.cloud/argocd@1.0.0-rc.12 \
        @effect/sql-pg@4.0.0-rc.115
```

🔴 **Why, measured 2026-09-16 on 0.1.0 and re-checked 2026-09-17 against Alchemy 78.**
Effect's `rc` line is not semver-compatible with itself. Alchemy 78's peer is
`effect >= 4.0.0-rc.115`; an unlocked `@effect/platform-node-shared` still floats to the
next rc and breaks at import. Pin the whole set.

| what resolves                                                 | what happens                                           |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| Alchemy 77 + `effect` → rc.115 (measured 2026-09-16)          | `TypeError: Config.string is not a function` at import |
| `@effect/platform-node-shared` newer than the pinned `effect` | `Cannot find module 'effect/ByteSize'`                 |
| `rolldown` → 1.2.9 via vite's `~1.2.6` (measured 2026-09-16)  | `GET …/rolldown-1.2.9.tgz - 404` at `bun add`          |
| no `mime` (measured 2026-09-17 against Alchemy 78)            | `Cannot find package 'mime'` from cloudflare-runtime   |

Alchemy 78 adapted to rc.115 — that first row is why we used to pin 112, not a reason to
stay there. The override is still the only thing that holds the set together.

⚠️ `@effect/platform-node` is **required, not optional**: Alchemy's module graph reaches
`Cloudflare/Workers/WorkerBridge → @effect/platform-node/NodeServices` even when you only
import the Proxmox subpath.

⚠️ So is `mime`. Alchemy 78's `@alchemy.run/cloudflare-runtime` imported it without
declaring it (measured 2026-09-17). 79 declares it; the peer stays so a consumer
that followed the 78 README does not drop a required line.

★ `cloudflare` **is gone, not merely tolerated.** It was a required peer (marked optional in
0.1.1, which claimed the `/cloudflare` subpath would degrade without it — measured 2026-09-16,
the subpath did not load at all: `Cannot find package 'cloudflare'`) until 2026-09-23, when
`R2BucketLock` moved off the `cloudflare` npm SDK onto `@distilled.cloud/cloudflare/r2`, the same
one `MeshNode` already called. Nothing else in this package imported it, so the peer — and the
`client.ts` wrapper it existed for — were dropped rather than left declared and unused.

⚠️ **`@distilled.cloud/forgejo` (added 2026-09-23, moving `/forgejo` off a hand-rolled
`HttpClient` client) is required for the same reason `@distilled.cloud/cloudflare` is: it is
a plain dependency of this package, not something a hoisting installer can hide from a strict
one.** Pinned to `1.0.0-rc.12` — the distilled release's own lockstep version, not alchemy's,
since alchemy does not bundle a Forgejo SDK the way it bundles Cloudflare's.

⚠️ **`@effect/sql-pg` (added for `/postgres`, 2026-09-23) is required too, for the same
reason, not because every subpath imports it.** This package has one flat peer set for the
whole install, not one per subpath — `peers.test.ts`'s "no peer is marked optional" test
enforces it. `@effect/sql-pg` is optional on `alchemy`'s own manifest (its module graph
does not reach `SQL/Postgres` unless a stack imports it); here it stays a plain peer like
every other one.

⚠️ **`@distilled.cloud/argocd` (added 2026-09-24, `/argocd`) is required for the same
reason `@distilled.cloud/forgejo` is: a plain peer of this package, pinned to
`1.0.0-rc.12`. Unlike Forgejo, this family is credential-parameterized per
instance (`argocdCredentials` / `argocdProviders` take an `ArgoCDTarget`) —
Distilled's `CredentialsFromEnv` defaults the server to `localhost:8080`, which
is the wrong origin for a Talos cluster. The peer itself does not change for
that: it is still one package, one pin.

⚠️ **`@distilled.cloud/grafana` (added 2026-09-24, kit PR 222, ahead of `/grafana`) is
required for the same reason `@distilled.cloud/forgejo` is: a plain dependency of this
package, not something a hoisting installer can hide from a strict one.** Pinned to
`1.0.0-rc.12`, the same distilled release line as every other pin on this page. Unlike
Forgejo, this family is credential-parameterized per instance (`grafanaCredentials`/
`grafanaProviders` take a `GrafanaTarget`, not a fixed env-var pair) — see
[grafana.md](./grafana.md) for why one instance was never going to be enough for this
estate. The peer itself does not change for that: it is still one package, one pin.

★ **`@distilled.cloud/netbox` (added 2026-09-23, moving `/netbox` off a hand-rolled
`HttpClient` client the same way `/forgejo` did) is NOT on this install line, and that is
deliberate — see [distilled-interim.md](./distilled-interim.md).** The real
`@distilled.cloud/netbox` is not published upstream yet, so this package aliases it onto
`@homeflare/distilled-netbox@0.2.0`, a copy built the distilled way and shipped from this
monorepo, as a plain **`dependencies`** entry (not a peer). A `dependencies` entry resolves
automatically for every consumer that installs `@homeflare/alchemy` — nothing to add to a
peer install line, and nothing for `peers.test.ts` to check. When the real package ships
upstream, the alias's target changes (or the entry becomes a normal peer, matching
`@distilled.cloud/forgejo` above) and this line still does not change for it.

★ **`@distilled.cloud/litellm` (added 2026-09-24, moving `/litellm` off a hand-rolled
`HttpClient` client the same way `/netbox` did) is the same shape**: aliased onto
`@homeflare/distilled-litellm@0.2.0` as a plain `dependencies` entry, not a peer — nothing to
add here, nothing for `peers.test.ts` to check.
