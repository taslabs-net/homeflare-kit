/**
 * The HomeFlare Cloudflare provider collection, in the shape `LiteLLM.providers()` has.
 *
 * ⚠️ THIS IS NOT `alchemy/Cloudflare`'s COLLECTION AND DOES NOT REPLACE IT. A stack that declares
 *   both a `Cloudflare.R2.Bucket` and this lock merges the two:
 *   `Layer.mergeAll(Cloudflare.providers(), HomeflareCloudflare.providers())` — the shape
 *   a consuming stack names for one talking to more than one account.
 *
 * ★ ONE CREDENTIAL PATH NOW, NOT TWO. Until 2026-09-23 `R2BucketLock` ran over the `cloudflare`
 *   npm SDK with its own `CLOUDFLARE_API_TOKEN` read (`client.ts`, since deleted) while `MeshNode`
 *   ran over `@distilled.cloud/cloudflare` through `Cloudflare.CloudflareApiLive()`. Both
 *   providers now call distilled, so both resolve credentials and the account the same way
 *   `Cloudflare.providers()` does (an Alchemy profile, or `CLOUDFLARE_API_TOKEN` +
 *   `CLOUDFLARE_ACCOUNT_ID` in CI) — a lock and the Gateway rules that reference the same bucket
 *   land in the same account.
 * ⚠️ THE LAYER IS BUILT TWICE ON PURPOSE, once per provider, even when the stack also merges
 *   `Cloudflare.providers()`. `Layer.provide`, not `provideMerge`: each feeds its own provider
 *   only and adds nothing to the stack's context.
 */
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Provider from 'alchemy/Provider';
import * as Layer from 'effect/Layer';
import { MeshNode, MeshNodeProvider } from './mesh-node.ts';
import { R2BucketLock, R2BucketLockProvider } from './r2-bucket-lock.ts';

export class Providers extends Provider.ProviderCollection<Providers>()('HomeflareCloudflare') {}

// ⛔ `orDie` ON BOTH, as `Cloudflare.providers()` ends with: a stack's providers layer must not
//   fail, and a profile that cannot resolve is a defect carrying Alchemy's own sentence.
export const providers = () =>
  Layer.effect(Providers, Provider.collection([R2BucketLock, MeshNode])).pipe(
    Layer.provide(
      Layer.mergeAll(
        R2BucketLockProvider().pipe(Layer.provide(Cloudflare.CloudflareApiLive()), Layer.orDie),
        MeshNodeProvider().pipe(Layer.provide(Cloudflare.CloudflareApiLive()), Layer.orDie),
      ),
    ),
  );
