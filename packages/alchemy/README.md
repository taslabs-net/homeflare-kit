# @homeflare/alchemy

Custom [Alchemy](https://alchemy.run) providers for gaps the vendor SDK leaves.

```sh
bun add @homeflare/alchemy alchemy@2.0.0-beta.79 effect@4.0.0-rc.115 \
        @effect/platform-node@4.0.0-rc.115 cloudflare@4.5.0 mime@4.1.0 \
        @distilled.cloud/cloudflare@1.0.0-rc.12
```

⛔ **Every one of those is required, and you also need an `overrides` block** — see
[Peers](#peers--and-one-override-you-need) below. The install succeeds without them and
the import throws.

★ **Why a custom provider at all.** When Alchemy has no property for something, the
alternative is a runbook step a human runs once — and a plan can never show a missing
runbook step. Covering the gap with a resource means the drift is visible in `plan` like
everything else.

## R2BucketLock

An R2 bucket's lock rules, declared rather than applied by hand. A lock rule is a
**retention floor**: while a rule covers an object, no API call, no lifecycle rule and no
credential can delete it.

```ts
import { R2BucketLock } from '@homeflare/alchemy/cloudflare';

export class BackupLock extends R2BucketLock('backup-lock', {
  bucketName: 'my-backups',
  jurisdiction: 'default',
  rules: [{ id: 'keep-30d', enabled: true, condition: { type: 'Age', maxAgeSeconds: 2_592_000 } }],
}) {}
```

Add the provider layer to your stack:

```ts
import { providers } from '@homeflare/alchemy/cloudflare';
// …then provide `providers()` alongside Cloudflare.providers()
```

⚠️ **The rule set is REPLACE, not merge.** The API `PUT`s the whole set, so a rule omitted
from `rules` is a rule deleted. That is the same shape as the Cloudflare API itself.

⛔ **It retains on destroy.** Removing a lock is removing a retention floor, which is the one
operation this resource exists to make hard: dropping the declaration leaves the lock in place,
and only an explicit `RemovalPolicy.destroy()` reaches the unlocking `delete`.

## MeshNode

A Cloudflare Mesh node (a `warp_connector`), declared **without its token in state**. Alchemy's
`Cloudflare.Tunnel.WarpConnector` stores the node token in plaintext state on every read and has
no `ha`; this one never reads the token, and `ha` is a create-only prop.

```ts
import { MeshNode, providers } from '@homeflare/alchemy/cloudflare';

const door = yield * MeshNode('vault-door', { name: 'door-a', ha: false });
// door.id → the node id for the Gateway rules and for fetchMeshNodeToken
```

- **`name`** renames in place (`PATCH`); **`ha`** is required and replaces the node (delete-first
  while the name stays). Existing nodes are adopted by exact name, `Unowned` until `adopt(true)`.
- ⛔ **It retains on destroy** (deleting a node cuts every replica off the Mesh), so a same-name
  `ha` change refuses, writing nothing, until that deploy pipes `RemovalPolicy.destroy()`.
- ★ **A door (a node with no routes) is `ha: false`.** HA fails over routes, and each replica has
  its own Mesh IP; a second door is a second `MeshNode`.
- The account and credentials come from Alchemy's own Cloudflare environment, the same as
  `Cloudflare.providers()`.
- **`fetchMeshNodeToken({ accountId, id })`** returns the token `Redacted`, on demand, for a
  one-off enrolment step. ⛔ Write it to a root-owned `0600` file on the node and nowhere else.
  It refuses the Global API Key, an empty API token, and a set `DISTILLED_DEBUG_HTTP` (distilled
  would print the token).

Guide, the enrolment step and every replace case: [docs/mesh-node.md](./docs/mesh-node.md).

## Website.Astro / Website.Vite

House flags on Alchemy's own stacks — the two this estate actually ships.

```ts
import { astroWebsite, viteWebsite } from '@homeflare/alchemy/cloudflare';

const site = yield * astroWebsite('subnetcalc', { rootDir });
const app = yield * viteWebsite('aimto', { rootDir: webRoot });
```

⛔ Astro needs `disable_nodejs_process_v2` — workerd process-v2 makes every page return
`[object Object]`. Vite / TanStack Start does not. Alchemy injects
`@alchemy.run/frontend-frameworks/astro`; do not add `@astrojs/cloudflare`.

⛔ Not Nextjs. `Website.Nextjs` hashes source and plans as **create** against a live
Worker. Adopt that shape with `Worker`, not a helper here.

## OpenBao — `@homeflare/alchemy/openbao`

Vault objects as resources — mounts (with `remountFrom` moves), auth methods, policies, AppRole,
JWT/OIDC and Kubernetes roles, JWT auth config, login MFA (TOTP method + enforcement), PKI, SSH,
Cloudflare and Proxmox roles, plugins — plus `assertBaoIdentity` (call it first), the pure
`hostAppRoles` generator, and an AppRole login for scripts. A stack provides each
`Bao*Provider()` it uses, plus `FetchHttpClient.layer`.

⛔ **Metadata only.** Alchemy stores props and attributes unencrypted, so no secret, CA key,
plugin `env` or OIDC client secret is declarable. Every family defaults to `retain` on destroy.

★ **Usage lives beside the code**, so it ships in the tarball with it:
[src/openbao/README.md](./src/openbao/README.md). What each resource does on a rename is in
[src/openbao/REPLACE.md](./src/openbao/REPLACE.md) — read it before changing a path or name.

## launchd — `@homeflare/alchemy/launchd`

`LaunchdJob` and `HostFile` declare a Mac host's daemons and their config files. launchd has no SDK,
so the provider renders the plist and drives `launchctl`, all through one injectable `HostRunner`;
`launchdProviders()` provides both. An update restarts the job; a `label`/`domain` change replaces it
delete-first.

- ⛔ **No secrets in props** (state is unencrypted): declare the path a secret renderer writes.
- ⛔ **No silent sudo:** the system domain needs a deploy started as root, or a `privileged` runner.
- ⚠️ `org.nixos.*` jobs are never adopted. Guide and nix-darwin cutover: [docs/launchd.md](./docs/launchd.md).

## Caddy — `@homeflare/alchemy/caddy`

`CaddyConfig` declares a running Caddy's config as Caddyfile text, applied through Caddy's own admin
API: `POST /load` (graceful reload; Caddy keeps the old config if it refuses the new one, and the
deploy says why), `GET /config/` for drift. A running Caddy is adopted on first read.
`caddyWithFile()` also writes the file Caddy starts from, with `HostFile`; `caddyProviders()` provides
the transport, `http://127.0.0.1:2019` by default.

- ⛔ **No secrets in the Caddyfile** (state is unencrypted): `{env.NAME}` / `{file./path}` placeholders.
- ⛔ **The admin API stays on loopback or a unix socket**, and a Caddyfile that would move it is refused.
- ⛔ **Delete never unloads or stops Caddy.** Order of file and load, `--resume`: [docs/caddy.md](./docs/caddy.md).

## Credentials

`CLOUDFLARE_API_TOKEN` is read from the environment at call time, never at module scope.
`MeshNode` instead resolves credentials and the account the way `Cloudflare.providers()` does
(an Alchemy profile, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in CI).

⛔ **Mint a short-lived, scoped token** — do not reuse a long-lived one, and never a Global
API Key. An empty value fails closed with a message saying so, because an empty render is
a denied grant rather than a missing file, and `Bearer ` + nothing 401s in a way that reads
like a bad credential.

## Peers — and one override you need

```sh
bun add @homeflare/alchemy alchemy@2.0.0-beta.79 effect@4.0.0-rc.115 \
        @effect/platform-node@4.0.0-rc.115 cloudflare@4.5.0 mime@4.1.0 \
        @distilled.cloud/cloudflare@1.0.0-rc.12
```

⚠️ Peers, not dependencies: Alchemy's resource registry and Effect's context both break if
two copies load in one process.

⛔ **Add this to your `package.json`, or the install works and the import throws:**

```json
{
  "overrides": {
    "effect": "4.0.0-rc.115",
    "@effect/platform-node": "4.0.0-rc.115",
    "@effect/platform-node-shared": "4.0.0-rc.115",
    "@effect/platform-bun": "4.0.0-rc.115",
    "rolldown": "1.2.8"
  }
}
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

⚠️ So is `cloudflare`. It was marked optional in 0.1.1, which claimed the `/cloudflare`
subpath would degrade without it — measured 2026-09-16, the subpath does not load at all:
`Cannot find package 'cloudflare'`. An optional peer should mean a feature is absent, not
that an import fails.

## License

MIT © Timothy Schneider
