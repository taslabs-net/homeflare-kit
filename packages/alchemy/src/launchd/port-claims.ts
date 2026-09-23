/**
 * Port collision refusal for a stack's own launchd jobs — pure: no host, no network, and
 * runtime-portable (no `Bun.*`, no `node:*`), so a future Linux consumer (systemd units, under
 * `/linux`) can import it unchanged.
 *
 * ★ KEYS ON THE PORT NUMBER ALONE, NOT A NEW RULE. `portClaimProblems` below matches the estate's
 *   existing port-collision strictness — address and protocol never read — deliberately: a looser
 *   or stricter rule here would be a second, inconsistent source of truth for jobs migrating off a
 *   host's own port registry (still enforcing that same strictness until a job leaves it). What
 *   this trades away — a wildcard bind beside a specific one on the same port both succeed,
 *   silently splitting traffic — is measured in docs/launchd-ports.md, not assumed.
 * ★ IN THE STACK PROGRAM, NOT A PROVIDER — same shape as `catalogBinary()` (../release/catalog.ts).
 *   Two reasons, both structural to Alchemy 2.0.0-beta.79: Alchemy never diffs a first `create`
 *   whose props still hold an unresolved `Output`, and every mini job's `programArguments` carries
 *   a `HostFile` config digest as an `Output` — so a provider-side check would miss the very first
 *   deploy of every job. And a provider never sees its sibling resources, so it could not compare
 *   one job's port against another's even if props were resolved. A plain function called from the
 *   stack's own `Effect.gen` body sees every claim the stack passes, before anything is applied.
 * ⚠️ IT SEES ONLY WHAT THE STACK PASSES. A job the stack forgets to add to its claim list is
 *   invisible to this check — there is no argv-parsing or host inspection here to catch that, and
 *   adding one would be guessing at a job's own config shape. docs/launchd-ports.md says what this
 *   cannot see, in full.
 */
import * as Data from 'effect/Data';

/** One job's claim on one port. `address` is informational only — the key is `port` alone. */
export interface PortClaim {
  /** Whose claim this is, for the refusal message: a job id or label, never empty. */
  readonly owner: string;
  readonly port: number;
  /** What the job binds, if the stack knows it. Omitted claims still collide by port number. */
  readonly address?: string;
}

const describeAddress = (address: string | undefined): string => address ?? 'unspecified address';

const describeOwner = (owner: string): string => (owner === '' ? '(empty owner)' : owner);

/**
 * Everything wrong with a set of claims; empty when none collide. ★ KEYS ON `port` ALONE, exactly
 *   like `lib-ports.nix`'s `assertNoCollision` — see the file header for why.
 */
export const portClaimProblems = (claims: readonly PortClaim[]): string[] => {
  const found: string[] = [];
  const byPort = new Map<number, PortClaim[]>();
  for (const claim of claims) {
    if (!Number.isSafeInteger(claim.port) || claim.port < 1 || claim.port > 65535) {
      found.push(
        `${describeOwner(claim.owner)}: port must be an integer from 1 to 65535, got ${String(claim.port)}`,
      );
    }
    if (claim.owner === '') {
      found.push(`a claim on port ${String(claim.port)} has an empty owner`);
    }
    const list = byPort.get(claim.port) ?? [];
    list.push(claim);
    byPort.set(claim.port, list);
  }
  for (const [port, list] of byPort) {
    if (list.length < 2) continue;
    // One owner naming the same port more than once — flagged the first time it repeats.
    const seen = new Set<string>();
    for (const claim of list) {
      if (claim.owner === '') continue; // already reported above
      if (seen.has(claim.owner)) {
        found.push(`${claim.owner} claims port ${String(port)} more than once`);
      }
      seen.add(claim.owner);
    }
    // Two different owners on the same port number — the collision the registry exists to catch.
    const distinctOwners = [...new Set(list.map((claim) => claim.owner).filter((o) => o !== ''))];
    if (distinctOwners.length > 1) {
      const described = list
        .map((claim) => `${describeOwner(claim.owner)} (${describeAddress(claim.address)})`)
        .join(' and ');
      found.push(`port ${String(port)} is claimed by more than one owner: ${described}`);
    }
  }
  return found;
};

/** The declaration itself: a bad port, an empty owner, or two owners sharing one port number. */
export class PortRefused extends Data.TaggedError('PortRefused')<{
  readonly message: string;
}> {}

/**
 * Refuse a colliding set of claims, or do nothing. ⛔ THROWS `PortRefused` — exactly like
 *   `catalogBinary()`, this is a DEFECT in a stack program's `Effect.gen` body, not a typed failure
 *   a caller can `Effect.catchTag` on: gap 10 of docs/release-binary-upstream.md applies here
 *   unchanged (measured the same way, in port-claims.test.ts). The plan still fails before anything
 *   is applied; the error itself is just not a typed channel yet.
 */
export const claimPorts = (claims: readonly PortClaim[]): void => {
  const problems = portClaimProblems(claims);
  if (problems.length > 0) {
    throw new PortRefused({
      message: `Launchd ports: ${problems.join('; ')}. Nothing was declared.`,
    });
  }
};
