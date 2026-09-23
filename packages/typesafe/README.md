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

## Gateway transport

For a consumer that only has TypeSafe's key as BYOK behind an AI Gateway — not a raw
`api.typesafe.ai` key — `createTypeSafeGatewayClient` builds the same official
`TypeSafeClient`, wired through the SDK's own `fetch` option instead of a direct key:

```ts
import { createTypeSafeGatewayClient, noul } from '@homeflare/typesafe';

const client = createTypeSafeGatewayClient({
  accountId: '<cloudflare-account-id>',
  token: '<AI Gateway token: Workers AI Read + AI Gateway Run>',
  gatewayId: '<gateway-id>',
});

const { answers } = await client.systemOne({
  state: 'I was charged twice. Please help.',
  questions: { billing: noul('Is this about billing?') },
});
```

It still returns a plain `TypeSafeClient` — `systemOne()`, retries, parsing, and error
classes are all the official SDK's. What differs is only where the bytes go:

- Sends exactly `Authorization: Bearer <token>`, `cf-aig-gateway-id`,
  `cf-aig-no-wholesale: true`, `Content-Type: application/json`, `Accept` — measured
  2026-09-23. The SDK's own `Authorization`, `X-TypeSafe-*`, and `User-Agent` headers
  are never sent to Cloudflare.
- **Version pinning is unavailable on this route** (measured 2026-09-23): Cloudflare's
  `typesafe/jev` catalog input schema accepts only `{state, questions}` —
  `additionalProperties: false`, no `model` field — so a requested `model` is read and
  dropped, never forwarded, and a call is never refused because of it. The version that
  actually answered comes back on every response as `x-homeflare-gateway-key-source`'s
  sibling — read it via `.withResponse()`:

  ```ts
  const { data, response } = await client.systemOne({ ... }).withResponse();
  console.log(data.model, response.headers.get('x-homeflare-gateway-key-source'));
  ```

⛔ Not for `models.list()` or anything but `systemOne()` — the Cloudflare catalog route
covers only that one call; everything else gets a `NotFoundError` without a network call.

The value stays in OpenBao. Git only has the names:

| layer                                 | placeholder                                             |
| ------------------------------------- | ------------------------------------------------------- |
| OpenBao path                          | `kv/infra/typesafe/homeflare` (`TYPESAFE_OPENBAO_PATH`) |
| OpenBao field / Worker secret / `env` | `TYPESAFE_API_KEY`                                      |

This package never reads the vault and never logs the value.

## Payload gate

Decision 22 (2026-09-23): a PR body or a private-repo source excerpt may be sent to
TypeSafe only through `gate()` — it checks a caller-declared field allowlist (type,
length and count caps) and scans for secret-shaped content, and returns either a frozen
payload ready to send or a refusal that names a field path, a rule id and a reason —
never the text that tripped it.

```ts
import {
  createTypeSafeClientFromBinding,
  gate,
  noul,
  type JudgmentSpec,
} from '@homeflare/typesafe';

const PR_BODY_SPEC: JudgmentSpec = {
  body: { type: 'string', maxLength: 20000 },
};

const result = gate(PR_BODY_SPEC, {
  state: { body: prBody },
  questions: { risky: noul('Does this PR body describe a risky change?') },
});

if (result.kind !== 'send') {
  // result.reason / result.path / result.rule — never the matched text.
  throw new Error(`gate refused: ${result.reason} at ${result.path}`);
}

const client = createTypeSafeClientFromBinding(env);
const { answers } = await client.systemOne({ state: result.state, questions: result.questions });
```

⛔ **A secret-shape refusal refuses the whole call. It never redacts and sends.** Every
regex rule is translated from [gitleaks](https://github.com/gitleaks/gitleaks)'
`config/gitleaks.toml` (pinned tag, provenance in
`src/gate/generated/gitleaks-rules.ts`), plus Shannon-entropy detection
(reimplementing [detect-secrets](https://github.com/Yelp/detect-secrets)'
`Base64HighEntropyString` / `HexHighEntropyString`) and IANA-derived private-address
detection. Global and per-rule gitleaks allowlists are deliberately **not** applied,
which is stricter than gitleaks itself — so a full 40-character hex commit SHA in a PR
body is refused too; that is documented over-refusal, not a bug.

★ **The kit bakes in no estate values.** `options.internalHostnames` — an estate
domain suffix like `*.internal` — is entirely the caller's to pass; this public package
ships none.

## License

MIT © Timothy Schneider
