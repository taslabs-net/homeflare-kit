/**
 * Better Auth on Workers/D1 — the official adapter, not a second Cloudflare stack.
 *
 * ★ WHY THIS EXISTS. An app team (AnyAuth, measured 2026-09-16) already used
 *   `better-auth/minimal` + `@better-auth/drizzle-adapter`. `@homeflare/auth` exported
 *   only VERSION and depended on `better-auth-cloudflare`, which takes over plugins,
 *   hooks, schema, baseURL and background tasks. They could not adopt it.
 *
 * ⛔ THIS WIRE IS THE WHOLE PACKAGE. We bind D1 via the official drizzle adapter and
 *   `waitUntil` via Better Auth's own `advanced.backgroundTasks.handler`. Everything
 *   else — plugins, hooks, schema extras, social providers, request-derived `baseURL`
 *   — stays on the options the app passed. Re-owning any of those is the same
 *   mistake as `better-auth-cloudflare`.
 *
 * ⚠️ `better-auth/minimal` omits Kysely. The full `better-auth` entry pulls it even
 *   when you never use it, which is the bundle you do not want on a Worker.
 */

import { type DB, drizzleAdapter } from '@better-auth/drizzle-adapter';
import { type BetterAuthOptions, betterAuth } from 'better-auth/minimal';

/** `ctx.waitUntil` on a Worker, or any function with that shape. */
export type WaitUntil = (promise: Promise<unknown>) => void;

/**
 * What the factory needs, plus every Better Auth option except `database`.
 * ⛔ `database` is reserved: it is always the official sqlite drizzle adapter.
 */
export type WorkersAuthOptions = Omit<BetterAuthOptions, 'database'> & {
  readonly db: DB;
  readonly schema?: Record<string, unknown>;
  readonly waitUntil: WaitUntil;
  /** Used only when the app did not pass `baseURL` — origin of this request. */
  readonly request?: Request;
};

/**
 * The slice an app needs. Better Auth's instance is generic over the exact options
 * object, which cannot be named here without a cast — ⚠️ that generic is invariant
 * on `database`, so `Auth<typeof constructed>` is not `Auth<BetterAuthOptions>`.
 */
export type WorkersAuth = {
  readonly handler: (request: Request) => Response | Promise<Response>;
  readonly options: BetterAuthOptions;
};

function originOf(request: Request): string {
  return new URL(request.url).origin;
}

/**
 * Wire Better Auth for a Worker that owns its schema, plugins and hooks.
 *
 * ```ts
 * const auth = createWorkersAuth({
 *   db, schema, waitUntil: ctx.waitUntil, secret: env.BETTER_AUTH_SECRET,
 *   request,                                    // or pass official baseURL yourself
 *   plugins: [organization(), twoFactor()],     // the app's
 * });
 * return auth.handler(request);
 * ```
 */
export function createWorkersAuth(options: WorkersAuthOptions): WorkersAuth {
  const { db, schema, waitUntil, request, advanced, baseURL, ...rest } = options;

  return betterAuth({
    ...rest,
    // ⛔ Official adapter, sqlite because D1 is sqlite. Schema is the app's.
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    // ★ Official request-derived baseURL wins; request origin is only a fallback.
    ...(baseURL !== undefined
      ? { baseURL }
      : request === undefined
        ? {}
        : { baseURL: originOf(request) }),
    advanced: {
      ...advanced,
      backgroundTasks: {
        ...advanced?.backgroundTasks,
        handler: waitUntil,
      },
    },
  }) as WorkersAuth;
}
