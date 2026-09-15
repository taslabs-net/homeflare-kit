# @homeflare/kit

Shared primitives for the HomeFlare estate. Bun-native to author, runtime-neutral to
consume — the published bundle runs on Cloudflare Workers, Node and Bun alike.

```sh
bun add @homeflare/kit     # or: pnpm add @homeflare/kit
```

## Usage

```ts
import { parseEnv } from '@homeflare/kit';

const config = parseEnv(
  {
    API_URL: { type: 'string' },
    PORT: { type: 'number', default: 8787 },
    DEBUG: { type: 'boolean', default: false },
  },
  env, // a Worker's env binding, or process.env
);

config.PORT; // number
config.DEBUG; // boolean — 'false' parses as false, not as a truthy string
```

`parseEnv` throws `EnvError` on the first key that is missing or malformed. The error
names the key and never the value.

## Development

```sh
bun install
bun run check    # lint + types + build + tests
bun run smoke    # pack, install and use the real tarball under bun AND node
bun run verify   # check + smoke — the full pre-publish gate
```

Changes are versioned with [changesets](https://github.com/changesets/changesets):

```sh
bun run changeset   # describe the change; commit the file with your PR
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow and the gates, and
[AGENTS.md](./AGENTS.md) for the toolchain rationale behind them.

Found a vulnerability? Please don't open a public issue — see
[SECURITY.md](./SECURITY.md).

## License

MIT © Timothy Schneider
