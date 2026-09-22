# homeflare-kit

[![ci](https://github.com/taslabs-net/homeflare-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/taslabs-net/homeflare-kit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@homeflare/kit?label=%40homeflare%2Fkit)](https://www.npmjs.com/package/@homeflare/kit)
[![license](https://img.shields.io/npm/l/@homeflare/kit)](./LICENSE)

The HomeFlare shared packages. One repo, one toolchain, one release stream — so that
every app and Worker that consumes them is scaffolded the same way.

| package                                          | what it is                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [`@homeflare/kit`](./packages/kit)               | Runtime-neutral primitives: env parsing, HTTP. Runs anywhere.                           |
| [`@homeflare/cloudflare`](./packages/cloudflare) | Workers helpers: Access JWT, structured logging.                                        |
| [`@homeflare/ui`](./packages/ui)                 | React components on [Cloudflare Kumo](https://github.com/cloudflare/kumo).              |
| [`@homeflare/auth`](./packages/auth)             | D1 storage for official Better Auth. Not a factory.                                     |
| [`@homeflare/typesafe`](./packages/typesafe)     | Official TypeSafe System One SDK, Worker key required.                                  |
| [`@homeflare/alchemy`](./packages/alchemy)       | Custom Alchemy providers: Cloudflare, Proxmox, OpenBao, Forgejo, Talos, launchd, Caddy. |
| [`@homeflare/site`](./packages/site)             | One typed site config; hostnames and addresses derived, the rest pinned.                |
| [`@homeflare/config`](./packages/config)         | Shared tsconfig, oxlint and oxfmt presets.                                              |

## Using them

```sh
bun add @homeflare/kit          # or pnpm / npm — the published tarball is plain ESM
```

```ts
import { parseEnv, client } from '@homeflare/kit';

const config = parseEnv(
  { API_URL: { type: 'string' }, PORT: { type: 'number', default: 8787 } },
  env, // a Worker binding, or process.env
);

const api = client(config.API_URL);
```

⛔ **`@homeflare/kit` stays runtime-neutral** — no `bun:*`, no `node:*`, no filesystem.
Anything Workers-specific lives in `@homeflare/cloudflare`.

## For coding agents

[`llms.txt`](./llms.txt) is one page to paste into an agent working in a consuming
repo: the API surface, the house versions, the traps worth knowing, and how to report
a gap instead of hand-rolling one locally.

Working **in this repo** instead? [AGENTS.md](./AGENTS.md) is the entry point.

## What `@homeflare/alchemy` covers of the Proxmox API

[`docs/api-coverage.md`](./docs/api-coverage.md) maps **every PVE and PBS endpoint that can change
state** to the Resource that owns it, or to nothing. It is generated from the vendor schemas named
in [`schemas/manifest.json`](./schemas/manifest.json) — product version and sha256 included — so it
is a fact about a stated cluster version rather than a hand-counted list that drifts.
[`docs/api-coverage.json`](./docs/api-coverage.json) is the complete machine-readable record.

```sh
bun run api:coverage          # regenerate from the cached vendor schemas
bun run api:coverage --check  # writes nothing; exits 1 when the committed report is stale
```

⛔ **It is generated, so it is never hand-edited**, and `tests/api-coverage.test.ts` fails if a
Resource claims an endpoint the schema no longer has. [`schemas/README.md`](./schemas/README.md)
has the read-only fetch commands and why the raw documents stay out of git.

## Developing

```sh
bun install
bun run check    # lint + types + build + tests
bun run smoke    # pack, install and use the real tarball under bun AND node
bun run verify   # check + smoke — the full pre-publish gate
bun run changeset
```

★ **Bun is the toolchain, not the runtime.** Bun installs, builds and tests this code;
consumers install the published tarball with whatever they like.

### Fast path for a first contribution

```sh
git clone https://github.com/taslabs-net/homeflare-kit && cd homeflare-kit
bun install && bun run verify     # ~30s, and proves your machine is set up
```

Then: change something, `bun run changeset`, open a PR. CI reports four separate checks —
**lint**, **types**, **tests**, **consumer smoke test** — so a red X names what broke
without opening a log, and the run summary lists what each package weighs.

★ **One rule worth knowing before you start:** `@homeflare/kit` stays runtime-neutral, so
anything touching `bun:*`, `node:*` or a filesystem belongs in `@homeflare/cloudflare`
instead. Everything else is in [CONTRIBUTING.md](./CONTRIBUTING.md), and the reasoning
behind the toolchain is in [AGENTS.md](./AGENTS.md).

Security: [SECURITY.md](./packages/kit/SECURITY.md) — please don't open a public issue.

## License

MIT © Timothy Schneider
