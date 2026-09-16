/**
 * The HomeFlare Cloudflare provider collection, in the shape `LiteLLM.providers()` has.
 *
 * ★ ONE LAYER, BUILT ONCE, so the single `Config.redacted('CLOUDFLARE_API_TOKEN')` read is shared
 *   by every resource in the stack rather than repeated per resource.
 *
 * ⚠️ THIS IS NOT `alchemy/Cloudflare`'s COLLECTION AND DOES NOT REPLACE IT. A stack that declares
 *   both a `Cloudflare.R2.Bucket` and this lock merges the two:
 *   `Layer.mergeAll(Cloudflare.providers(), HomeflareCloudflare.providers())` — the shape
 *   a consuming stack names for one talking to more than one account.
 */
import * as Provider from 'alchemy/Provider';
import * as Layer from 'effect/Layer';
import { CloudflareApiLive } from './client.ts';
import { R2BucketLock, R2BucketLockProvider } from './r2-bucket-lock.ts';

export class Providers extends Provider.ProviderCollection<Providers>()('HomeflareCloudflare') {}

export const providers = () =>
  Layer.effect(Providers, Provider.collection([R2BucketLock])).pipe(
    Layer.provide(R2BucketLockProvider()),
    Layer.provideMerge(CloudflareApiLive),
  );
