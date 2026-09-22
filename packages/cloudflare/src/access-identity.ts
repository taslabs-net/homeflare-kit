/**
 * Access identity WITHOUT parsing a JWT — the path Cloudflare added in August 2026.
 *
 * ★ WHEN ACCESS PROTECTS A WORKER, the edge attaches the authenticated identity to the
 *   execution context: `ctx.access.getIdentity()` returns email, name and groups with no
 *   token handling at all. Verifying the assertion yourself is the OLDER path, and it is
 *   still correct for origins that have no `ctx.access` — see `verifyAccessJwt`.
 *
 * ⛔ THIS IS NOT A WEAKER CHECK. The edge has already refused the request if it did not
 *   pass the Access policy; `ctx.access` exists only on requests that passed. Parsing the
 *   JWT again re-verifies something the platform has already enforced.
 *
 * ⚠️ `ctx.access` IS NOT PROPAGATED THROUGH SERVICE BINDINGS OR RPC. A downstream Worker
 *   reached by binding sees `undefined`, even though the caller was authenticated — so a
 *   service-bound Worker that needs identity must be told, or must sit behind its own
 *   Access application. Measured from Cloudflare's own documentation, 2026-08-14.
 *
 * ★ GROUPS COME FROM get-identity, NOT FROM THE TOKEN. Cloudflare trims the JWT's `custom`
 *   claim at roughly 1 KB, silently, so group membership read from a token can be
 *   incomplete — which is an authorization bug that only appears for users in many groups.
 */

/** What `ctx.access.getIdentity()` resolves. Narrowed to the fields worth depending on. */
export interface AccessIdentityInfo {
  readonly email: string | undefined;
  readonly name: string | undefined;
  readonly groups: readonly string[];
  /** Everything else the platform returned, for callers needing a field not named here. */
  readonly raw: Readonly<Record<string, unknown>>;
}

/**
 * The slice of the execution context this module uses.
 * ⚠️ Declared structurally rather than imported from `@cloudflare/workers-types`: this
 *   package should not force a types dependency on a consumer for one optional field.
 */
export interface AccessContext {
  readonly access?: {
    readonly aud?: string;
    readonly getIdentity: () => Promise<Record<string, unknown> | null | undefined>;
  };
}

/** True when the request reached this Worker through Cloudflare Access. */
export function hasAccess(ctx: AccessContext): boolean {
  return ctx.access !== undefined;
}

/**
 * The authenticated identity, or `undefined` when the request did not come through Access.
 *
 * ```ts
 * const who = await accessIdentity(ctx);
 * if (who === undefined) return new Response('Access did not run', { status: 401 });
 * ```
 *
 * ⛔ RETURNS undefined RATHER THAN THROWING, deliberately — unlike `verifyAccessJwt`. A
 *   Worker may legitimately serve both protected and open routes, so "no Access here" is
 *   a branch rather than a failure. The caller decides what an unauthenticated request
 *   means, and that decision is visible at the call site.
 */
export async function accessIdentity(ctx: AccessContext): Promise<AccessIdentityInfo | undefined> {
  const access = ctx.access;
  if (access === undefined) return undefined;

  const raw = (await access.getIdentity()) ?? {};
  const groups = raw['groups'];

  return {
    email: typeof raw['email'] === 'string' ? raw['email'] : undefined,
    name: typeof raw['name'] === 'string' ? raw['name'] : undefined,
    // ⚠️ Always an array, never undefined: a caller writing `groups.includes(…)` on a
    //   missing field would throw at exactly the moment authorization is being decided.
    groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [],
    raw,
  };
}
