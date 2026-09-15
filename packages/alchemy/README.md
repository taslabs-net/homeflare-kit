# @homeflare/alchemy

Custom [Alchemy](https://alchemy.run) providers for gaps the vendor SDK leaves.

```sh
bun add @homeflare/alchemy alchemy cloudflare effect
```

★ **Why a custom provider at all.** When Alchemy has no property for something, the
alternative is a runbook step a human runs once — and a plan can never show a missing
runbook step. Covering the gap with a resource means the drift is visible in `plan` like
everything else.

## R2BucketLock

An R2 bucket's lock rules, declared rather than applied by hand. A lock rule is a
**retention floor**: while a rule covers an object, no API call, no lifecycle rule and no
credential can delete it.

```ts
import { R2BucketLock } from '@homeflare/alchemy';
import { providers } from '@homeflare/alchemy/providers';

export class BackupLock extends R2BucketLock('backup-lock', {
  bucketName: 'my-backups',
  jurisdiction: 'default',
  rules: [{ id: 'keep-30d', enabled: true, condition: { type: 'Age', maxAgeSeconds: 2_592_000 } }],
}) {}
```

Add the provider layer to your stack:

```ts
import { providers } from '@homeflare/alchemy/providers';
// …then provide `providers()` alongside Cloudflare.providers()
```

⚠️ **The rule set is REPLACE, not merge.** The API `PUT`s the whole set, so a rule omitted
from `rules` is a rule deleted. That is the same shape as the Cloudflare API itself.

⛔ **Deletion is refused by design.** Removing a lock is removing a retention floor, which
is the one operation this resource exists to make hard. It retains on destroy.

## Credentials

`CLOUDFLARE_API_TOKEN` is read from the environment at call time, never at module scope.

⛔ **Mint a short-lived, scoped token** — do not reuse a long-lived one, and never a Global
API Key. An empty value fails closed with a message saying so, because an empty render is
a denied grant rather than a missing file, and `Bearer ` + nothing 401s in a way that reads
like a bad credential.

## Peers

`alchemy` >= 2.0.0-beta.77 · `cloudflare` >= 4.5.0 · `effect` >= 4.0.0-rc.112

⚠️ Peers, not dependencies: Alchemy's resource registry and Effect's context both break if
two copies load in one process.

## License

MIT © Timothy Schneider
