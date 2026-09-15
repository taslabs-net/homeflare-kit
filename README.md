# homeflare-kit

The HomeFlare shared packages. One repo, one toolchain, one release stream — so that
every app and Worker in the estate is scaffolded the same way.

| package                                          | what it is                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| [`@homeflare/kit`](./packages/kit)               | Runtime-neutral primitives: env parsing, HTTP. Runs anywhere.              |
| [`@homeflare/cloudflare`](./packages/cloudflare) | Workers helpers: Access JWT, structured logging.                           |
| [`@homeflare/ui`](./packages/ui)                 | React components on [Cloudflare Kumo](https://github.com/cloudflare/kumo). |
| [`@homeflare/config`](./packages/config)         | Shared tsconfig, oxlint and oxfmt presets.                                 |

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

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow and [AGENTS.md](./AGENTS.md)
for the reasoning behind the toolchain. Security: [SECURITY.md](./packages/kit/SECURITY.md).

## License

MIT © Timothy Schneider
