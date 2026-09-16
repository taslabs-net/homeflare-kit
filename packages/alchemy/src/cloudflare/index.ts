/**
 * Cloudflare providers for Alchemy — the gaps the vendor SDK leaves.
 *
 * ★ Built on the official `cloudflare` SDK, not hand-rolled HTTP: it already has
 *   `r2.buckets.locks.update/get` over the documented endpoints, so there is no path
 *   string this package invents.
 */
export type { R2LockRule } from './lock-rules.ts';
export { R2BucketLock, type R2BucketLockProps } from './r2-bucket-lock.ts';
export { providers } from './providers.ts';
export {
  astroWebsite,
  viteWebsite,
  type AstroWebsiteProps,
  type ViteWebsiteProps,
} from './website.ts';
