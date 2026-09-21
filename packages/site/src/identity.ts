/**
 * Compare the identity a site EXPECTS with the identity a live system REPORTS.
 *
 * ⛔ WHY EVERY LIVE PLAN CALLS THIS. An exported `BAO_ADDR` from another shell points a
 *   stack at a different vault with nothing else looking wrong: the token works, the
 *   mounts exist, and the plan reads that vault's objects as drift to "fix". Only the
 *   vault's own `cluster_name` (from `sys/health`) and the Cloudflare account id say which
 *   system is on the other end.
 *
 * ★ PURE. This module fetches nothing. The caller reads `sys/health` and the account with
 *   its own client (the kit's OpenBao and Cloudflare resources already have one) and hands
 *   the observed values in, so this runs anywhere and is trivial to test.
 */
import { SiteError, lookup } from './errors.ts';
import type { Site } from './schema.ts';

export interface Identity {
  /** `cluster_name` from the vault's `sys/health`. */
  readonly vaultClusterName?: string;
  /** The namespace the client is using. `''` is the root namespace. */
  readonly vaultNamespace?: string;
  /** The Cloudflare account the credential resolves to. */
  readonly cloudflareAccountId?: string;
}

export interface IdentityMismatch {
  readonly field: keyof Identity;
  readonly expected: string;
  /** `undefined` when the caller did not observe it — which is itself a mismatch. */
  readonly observed: string | undefined;
}

export interface ExpectedIdentityOptions {
  /** The account alias the plan targets. Omit to leave the account out of the compare. */
  readonly account?: string;
}

/** What the site says the live systems are. Throws `unknown-key` for an unknown alias. */
export function expectedIdentity(site: Site, options: ExpectedIdentityOptions = {}): Identity {
  const account =
    options.account === undefined
      ? undefined
      : lookup('cloudflare account', site.cloudflare.accounts, options.account).id;
  return {
    vaultClusterName: site.vault.clusterName,
    vaultNamespace: site.vault.namespace,
    ...(account === undefined ? {} : { cloudflareAccountId: account }),
  };
}

const FIELDS = ['vaultClusterName', 'vaultNamespace', 'cloudflareAccountId'] as const;

/**
 * Every field the expectation sets and the observation does not match.
 * ⛔ An expected field the caller did not observe COUNTS AS A MISMATCH. "We did not check"
 *   must never read the same as "it matched".
 * ⛔ An expectation that sets NO field throws `identity`. Compared field by field, `{}`
 *   matches every system there is, so a caller that built it by mistake (a wrong spread, a
 *   renamed key) would pass the guard on any vault and any account.
 */
export function compareIdentity(
  expected: Identity,
  observed: Identity,
): readonly IdentityMismatch[] {
  if (FIELDS.every((field) => expected[field] === undefined)) {
    throw new SiteError(
      'identity',
      'refusing to plan: the expected identity names no field, so it would match any system',
    );
  }
  const mismatches: IdentityMismatch[] = [];
  for (const field of FIELDS) {
    const want = expected[field];
    if (want === undefined) continue;
    const got = observed[field];
    if (got !== want) mismatches.push({ field, expected: want, observed: got });
  }
  return mismatches;
}

/** {@link compareIdentity}, throwing `identity` with one line per mismatch. */
export function assertIdentity(expected: Identity, observed: Identity): void {
  const mismatches = compareIdentity(expected, observed);
  if (mismatches.length === 0) return;
  throw new SiteError(
    'identity',
    'refusing to plan: the live system is not the one this site describes',
    mismatches.map(
      (m) =>
        `${m.field}: expected "${m.expected}", observed ${m.observed === undefined ? 'nothing' : `"${m.observed}"`}`,
    ),
  );
}
