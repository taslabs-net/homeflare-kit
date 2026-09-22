/**
 * House defaults on Alchemy's Website stacks — Astro and Vite, which is what we ship.
 *
 * ★ NOT Nextjs. The blog measured Website.Nextjs planning as **create** because it
 *   hashes source; adopt is `Worker`, not Nextjs. Do not add a Nextjs helper until an
 *   app actually deploys that way.
 *
 * ⛔ `disable_nodejs_process_v2` ON ASTRO IS LOAD-BEARING. Workerd process-v2 (compat
 *   date 2025-09-15) makes every Astro page return `[object Object]`. Vite/TanStack
 *   Start does not need that flag; it needs `nodejs_compat` (Alchemy already defaults
 *   it on Vite).
 *
 * ⛔ Alchemy injects `@alchemy.run/frontend-frameworks/astro`. Do not add
 *   `@astrojs/cloudflare` — that is the wrangler path.
 *
 * ★ Alchemy's Website props are an Effect-wrapped InputProps union. We do not re-export
 *   that type — isolatedDeclarations cannot name it. Extra Alchemy fields still pass
 *   through via the rest bag; the assertion is only at the call into Alchemy.
 */
import * as AdoptPolicy from 'alchemy/AdoptPolicy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';

const ASTRO_FLAGS: readonly string[] = ['nodejs_compat', 'disable_nodejs_process_v2'];

export interface AstroWebsiteProps {
  readonly rootDir?: string;
  readonly name?: string;
  readonly sessionKVBindingName?: string | false;
  readonly compatibility?: { readonly flags?: readonly string[]; readonly date?: string };
}

export interface ViteWebsiteProps {
  readonly rootDir?: string;
  readonly name?: string;
}

/**
 * `Cloudflare.Website.Astro` with house flags, no auto session KV, adopt+retain.
 *
 *     const site = yield* astroWebsite('subnetcalc', { rootDir });
 */
export function astroWebsite(
  name: string,
  props: AstroWebsiteProps,
): ReturnType<typeof Cloudflare.Website.Astro> {
  const flags = props.compatibility?.flags ?? ASTRO_FLAGS;
  const merged = {
    ...props,
    name: props.name ?? name,
    sessionKVBindingName: props.sessionKVBindingName ?? false,
    compatibility: { ...props.compatibility, flags: [...flags] },
  };
  return Cloudflare.Website.Astro(name, merged as never).pipe(
    AdoptPolicy.adopt(true),
    RemovalPolicy.retain(),
  );
}

/**
 * `Cloudflare.Website.Vite` — TanStack Start, SolidStart, static Vite.
 * `nodejs_compat` is Alchemy's Vite default; we do not add process-v2 here.
 *
 *     const app = yield* viteWebsite('aimto', { rootDir: webRoot });
 */
export function viteWebsite(
  name: string,
  props?: ViteWebsiteProps,
): ReturnType<typeof Cloudflare.Website.Vite> {
  const merged = { ...props, name: props?.name ?? name };
  return Cloudflare.Website.Vite(name, merged as never).pipe(
    AdoptPolicy.adopt(true),
    RemovalPolicy.retain(),
  );
}
