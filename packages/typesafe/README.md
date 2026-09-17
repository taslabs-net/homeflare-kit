# @homeflare/typesafe

The official [TypeSafe](https://docs.typesafe.ai/introduction) System One SDK, pinned
and constructed for HomeFlare Workers.

```sh
bun add @homeflare/typesafe
```

⛔ **Not a replacement client.** Questions, answers, and `systemOne()` come from
`@typesafe-ai/sdk`. This package pins that SDK and requires an explicit API key.

⛔ **Server-only.** The official constructor refuses the browser. Pass the key from a
Worker secret / binding — Workers have no `process.env.TYPESAFE_API_KEY`.

```ts
import { choice, createTypeSafeClientFromBinding, noul } from '@homeflare/typesafe';

const client = createTypeSafeClientFromBinding(env);
const { answers } = await client.systemOne({
  state: { ticket: text },
  questions: {
    billing: noul('Is this about billing?'),
    category: choice('What is this ticket about?', {
      billing: null,
      technical: null,
      other: null,
    }),
  },
});
```

★ Code owns routing and thresholds. TypeSafe returns typed judgments and probabilities —
not generated text to parse.

The value stays in OpenBao. Git only has the names:

| layer                                 | placeholder                                             |
| ------------------------------------- | ------------------------------------------------------- |
| OpenBao path                          | `kv/infra/typesafe/homeflare` (`TYPESAFE_OPENBAO_PATH`) |
| OpenBao field / Worker secret / `env` | `TYPESAFE_API_KEY`                                      |

This package never reads the vault and never logs the value.

## License

MIT © Timothy Schneider
