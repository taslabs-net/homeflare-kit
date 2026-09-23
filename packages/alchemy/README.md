# @homeflare/alchemy

Custom [Alchemy](https://alchemy.run) providers for gaps the vendor SDK leaves.

```sh
bun add @homeflare/alchemy alchemy@2.0.0-beta.79 effect@4.0.0-rc.115 \
        @effect/platform-node@4.0.0-rc.115 mime@4.1.0 \
        @distilled.cloud/cloudflare@1.0.0-rc.12 @distilled.cloud/forgejo@1.0.0-rc.12 \
        @effect/sql-pg@4.0.0-rc.115
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

⛔ **Nothing is adopted without `--adopt`** (0.9.0, first published as 0.10.0), for every family and even when the live object
is identical to the declaration; an interrupted create of this stack's own resumes when its row
can prove it (one killed while a prop was an `Output` needs `--adopt`). The same rule holds for
`HostFile`, `LaunchdJob`, `CaddyConfig` and `ProxmoxLxc`: [docs/ownership.md](./docs/ownership.md).

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
- ★ `claimPorts()` refuses two of a stack's own jobs on one port, in the stack program, before any
  is declared: [docs/launchd-ports.md](./docs/launchd-ports.md).

### Deploying as yourself — `sudoRunner()`

```ts
launchdProviders(sudoRunner({ prefixes: ['/Library/LaunchDaemons', '/opt/example'] }));
```

The deploy runs as you. Only `launchctl bootstrap | bootout | kickstart` in the system domain, and
`install` / `rm` of a file under a declared prefix, go through `sudo -n`, in exact argv shapes. Each
one is logged (argv only, never content) before it runs. A plan never calls sudo.

- ⛔ **Opt-in, never a fallback**, and it never prompts: if sudo needs a password, the call fails at
  once and says to run `sudo -v`, or to grant exactly these commands `NOPASSWD`.
- ⚠️ Refused before sudo is asked: any other argv, a prefix — or any directory below it on the way
  to the file — that is not a real directory only root may write, a root-owned file that would be
  group/world-writable, setuid or setgid, a path outside every prefix that needs root, a file you
  could not read back, and another user's `gui/<uid>`. A plan that will write runs the same checks.
- Full list, sudoers cautions and limits: [docs/launchd-sudo.md](./docs/launchd-sudo.md).

## Linux hosts — `@homeflare/alchemy/linux`

The same `HostRunner` seam, over ssh, plus the three families the launchd subpath had no Linux twin
for: `HostDirectory` (because no file resource creates a parent), `RemoteFile` (a whole file, or one
**managed block** inside a file somebody else owns) and `SystemdUnit` / `SystemdTimer`.
`linuxProviders(await sshRunner({ host }))` provides all four.

```ts
RemoteFile('block', { path: '/etc/example.conf', region: { name: 'homeflare' }, content: 'a line\n' });
SystemdUnit('thing', { name: 'thing.service', sections: [...], restartOn: [config.sha256] });
```

- ⛔ **A deploy never mass-restarts.** A unit restarts only when its own file changed, when state or
  systemd says the loaded copy is stale, or when a digest the declaration listed changed. An adopted
  unit that already matches is not restarted, reloaded or started.
- ⛔ **Every byte outside a managed region is identical**, and a delete removes only the block.
- ⛔ **Fail closed over ssh:** `BatchMode=yes`, host verification untouched, and a remote result
  without its framing marker is an Error — never "nothing is there".
- ⛔ **No silent sudo:** a root-owned path needs a root ssh destination or your own privileged runner.
- ⛔ **The directive set is systemd's:** unit files render verbatim; nothing here invents a schema.
- Guide, the measured `systemctl` shapes and the limits: [docs/linux-host.md](./docs/linux-host.md).

## Release binaries — `@homeflare/alchemy/release`

`ReleaseBinary` installs one binary out of a pinned release archive into a directory you declare,
verified twice. The pins are props; each vendor's pinned versions are a data set beside it
(`VICTORIA_RELEASES` and `OPENBAO_RELEASES`). `releaseProviders(runner)` provides it.

```ts
const request = {
  package: 'vmutils',
  version: '1.151.0',
  platform: 'darwin-arm64',
  binary: 'vmalert',
};
ReleaseBinary('vmalert', { ...catalogBinary(VICTORIA_RELEASES, request), directory: dir.path });
```

- ⛔ **It installs; it never starts.** Put `binary.path` in your job's argv; that orders the two.
- ⛔ **Pinned in code, never fetched:** a version the data set does not pin fails the plan. Exact
  asset names, the archive verified before unpacking and the binary before writing, only the
  declared member extracted, one writer (`HostRunner.writeFileAtomic`).
- Guide: [docs/release-binary.md](./docs/release-binary.md) · data sets and adding a vendor:
  [docs/release-binary-catalogs.md](./docs/release-binary-catalogs.md) · measured:
  [docs/release-binary-measured.md](./docs/release-binary-measured.md) · upstream:
  [docs/release-binary-upstream.md](./docs/release-binary-upstream.md).

## Caddy — `@homeflare/alchemy/caddy`

`CaddyConfig` declares a running Caddy's config as Caddyfile text, applied through Caddy's own admin
API: `POST /load` (graceful reload; Caddy keeps the old config if it refuses the new one, and the
deploy says why), `GET /config/` for drift. `caddyWithFile()` also writes the file Caddy starts from,
with `HostFile`; `caddyProviders()` provides the transport, `http://127.0.0.1:2019` by default.

- ⛔ **Nothing is adopted silently:** a running Caddy whose config is not the declared one plans as
  `Unowned`, and the deploy needs `--adopt`.
- ⛔ **No secrets in the Caddyfile** (state is unencrypted): `{env.NAME}` / `{file./path}` placeholders.
- ⛔ **The admin API stays on loopback or a unix socket**, and a Caddyfile that would move it is refused.
- ⛔ **Delete never unloads or stops Caddy.** Order of file and load: [docs/caddy.md](./docs/caddy.md).
- ★ **Managed Caddies run `--resume` with their own `XDG_CONFIG_HOME`**, so a restart runs the last
  config Caddy accepted — and after one, SIGUSR1 has no file to reload. Why, and the rest: same doc.

## PostgreSQL — `@homeflare/alchemy/postgres`

`Postgres.Database`: create-and-assert over a self-hosted PostgreSQL 18 cluster, over
`@effect/sql-pg` — the same client upstream's own `alchemy/SQL/Postgres` binding uses. No
`ALTER DATABASE`, no password prop, and `delete` always refuses: [docs/postgres.md](./docs/postgres.md).

## Proxmox — `@homeflare/alchemy/proxmox`

PVE and PBS objects over the PVE API, `ProxmoxLxc` for containers, and the provisioning baseline
every cluster needs first. What it never does to a guest, and why: [docs/proxmox.md](./docs/proxmox.md).

## NetBox — `@homeflare/alchemy/netbox`

`Netbox.Prefix` declares one IP prefix and the decision recorded against it — including
`status: 'deprecated'`, which is how a retired range stops being folklore. Every write is checked
against a table generated from NetBox's own OpenAPI document before the request is built.
⛔ Adopt-first, `retain` on removal, and read/write shapes that differ: [docs/netbox.md](./docs/netbox.md).

## Paperless — `@homeflare/alchemy/paperless`

`Tag`, `DocumentType`, `StoragePath` and `CustomField` — the taxonomy Paperless-ngx writes
through Django's internal models, create-or-update and never deleted. Every write is checked
against a table generated from Paperless-ngx's own served OpenAPI document, and the request/
response types are generated from it too, not hand-typed. ⛔ Every create carries `owner`
(null when undeclared — omitting it lets the vendor default to the token user), `read` answers
`Unowned` on every match (never a silent adopt), and a custom field's `dataType` is refused at
plan time rather than PATCHed or replaced: [docs/paperless.md](./docs/paperless.md).

## LiteLLM — `@homeflare/alchemy/litellm`

`LiteLLM.PassThroughEndpoint` declares one route on LiteLLM's proxy that forwards to an
upstream target, generated from LiteLLM 1.100.0's own OpenAPI document. ⛔ Every pass-through
endpoint lives in ONE `general_settings` field (a whole-list read-modify-write), a path already
declared in `config.yaml` is refused rather than silently overridden, and a literal secret in a
forwarded header is refused at plan: [docs/litellm.md](./docs/litellm.md).

## GitHub — `@homeflare/alchemy/github`

`declareRepoPolicy` declares one repository's merge policy and its default-branch ruleset in a
single call: squash-only, auto-merge, head branches deleted, no deletion or force pushes, the
checks you name required. ⛔ Auto-merge with nothing required merges **immediately**, and Alchemy's
`Ruleset` creates a duplicate rather than adopting one: [docs/repo-policy.md](./docs/repo-policy.md).

## Adopt verifier — `hf-adopt-verify` / `@homeflare/alchemy/verify`

⛔ A plan prints `adopted` for a match and for a drift alike. Before a gated deploy run
`bunx --bun hf-adopt-verify --config alchemy.run.ts --stage live`: Alchemy's planner, no writes,
each row's own diff, exit 0 only when all are no-ops. [docs/adopt-verify.md](./docs/adopt-verify.md)

## Credentials

⛔ **Mint a short-lived, scoped token** — never a long-lived one, never a Global API Key. How each
subpath reads its credential, and why an empty one fails closed: [docs/credentials.md](./docs/credentials.md).

## Peers — and one override you need

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

Why each peer is required and each pin exists — the measurements, and the error a missing one
produces: [docs/peers.md](./docs/peers.md).

## License

MIT © Timothy Schneider
