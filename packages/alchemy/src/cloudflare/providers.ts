/**
 * The HomeFlare Cloudflare provider collection, in the shape `LiteLLM.providers()` has.
 *
 * ★ ONE LAYER, BUILT ONCE, so the single `Config.Redacted('CLOUDFLARE_API_TOKEN')` read is shared
 *   by every resource in the stack rather than repeated per resource.
 *
 * ⚠️ THIS IS NOT `alchemy/Cloudflare`'s COLLECTION AND DOES NOT REPLACE IT. A stack that declares
 *   both a `Cloudflare.R2.Bucket` and this lock merges the two:
 *   `Layer.mergeAll(Cloudflare.providers(), HomeflareCloudflare.providers())` — the shape
 *   a consuming stack names for one talking to more than one account.
 *
 * ★ TWO CREDENTIAL PATHS, ONE PER SDK. `R2BucketLock` uses the `cloudflare` SDK through
 *   `CloudflareApiLive` (`CLOUDFLARE_API_TOKEN`, fail-closed). `MeshNode` uses Alchemy's own SDK
 *   and resolves credentials and the account through `Cloudflare.CloudflareApiLive()` — the same
 *   source `Cloudflare.providers()` uses (an Alchemy profile, or `CLOUDFLARE_API_TOKEN` +
 *   `CLOUDFLARE_ACCOUNT_ID` in CI), so a node lands in the account its Gateway rules do.
 * ⚠️ That second layer is built again here even when the stack also merges
 *   `Cloudflare.providers()`. `Layer.provide`, not `provideMerge`: it feeds MeshNode only and adds
 *   nothing to the stack's context.
 */
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Provider from 'alchemy/Provider';
import * as Layer from 'effect/Layer';
import { CloudflareApiLive } from './client.ts';
import { MeshNode, MeshNodeProvider } from './mesh-node.ts';
import { R2BucketLock, R2BucketLockProvider } from './r2-bucket-lock.ts';

export class Providers extends Provider.ProviderCollection<Providers>()('HomeflareCloudflare') {}

export const providers = () =>
  Layer.effect(Providers, Provider.collection([R2BucketLock, MeshNode])).pipe(
    Layer.provide(
      Layer.mergeAll(
        R2BucketLockProvider(),
        // ⛔ `orDie`, as `Cloudflare.providers()` ends with: a stack's providers layer must not
        //   fail, and a profile that cannot resolve is a defect carrying Alchemy's own sentence.
        MeshNodeProvider().pipe(Layer.provide(Cloudflare.CloudflareApiLive()), Layer.orDie),
      ),
    ),
    Layer.provideMerge(CloudflareApiLive),
  );
