/**
 * One credential per (target, role) for the life of a run, instead of one per API call.
 *
 * 🔴 THE MEASUREMENT THAT MADE THIS NECESSARY. A single `alchemy plan` plus `deploy` of the C1
 *   stack — 98 resources — left **760 API token entries in `/etc/pve/user.cfg`**, counted on node-b
 *   immediately afterwards. `mint()` asked OpenBao for a new credential on EVERY call, and each
 *   mint creates a real Proxmox token: read, diff, reconcile and read-back each got their own. They
 *   drain as the leases expire (760 down to 712 over five minutes), so nothing was broken — but
 *   `/etc/pve` is pmxcfs, a REPLICATED cluster filesystem, and every one of those mints is a write
 *   to it that all three nodes must agree on. Two plans in quick succession stack thousands.
 *
 * ⛔ AND ON PBS THE COST IS SECONDS, NOT BYTES. `pbs_grant.go` waits for PBS to honour a freshly
 *   granted ACL before handing the credential over — measured at about 4.5s, and unavoidable,
 *   because PBS caches its parsed ACL config. Per mint. The ten PBS resources in pbs.ts would pay
 *   that ten times over for credentials identical to each other.
 *
 * ★ SO THE FIX IS TO STOP THROWING AWAY A CREDENTIAL THAT IS STILL VALID. This is strictly FEWER
 *   credentials in existence at once, not more: the lease TTL is untouched, and a token that would
 *   have been minted and abandoned is simply never minted. It is the same reasoning
 *   `network-apply.ts` already applies by hand when it threads one lease through `pveWith` for its
 *   apply and its task poll.
 *
 * ⚠️ THE CACHE IS PROCESS-SCOPED AND THAT IS THE INTENDED LIFETIME. A plan or a deploy is one
 *   process; the next one starts cold. Nothing is written to disk, and a credential never outlives
 *   the run that minted it.
 *
 * ⛔ IT IS NOT A PERFORMANCE CACHE, SO IT MUST NEVER SERVE A CREDENTIAL THAT COULD DIE MID-CALL.
 *   The provision lease is 300s and a deploy can run longer than that. A credential handed out at
 *   t+299 would fail the call it was handed to, and the failure surfaces as a 401 — which `read`
 *   folds into "absent", which is how a plan comes to say CREATE for an object that exists. That is
 *   the exact class of bug this package found three times in one day, so the margin below is
 *   deliberately generous rather than tuned.
 *
 * ★ THE MECHANISM IS EFFECT'S OWN `Cache`, AND THE HAND-WRITTEN ONE IT REPLACED WAS WRONG IN
 *   EXACTLY THE PLACE A LIBRARY IS NOT. A TTL map alone still minted 89 credentials for 98
 *   resources, because Alchemy plans concurrently and every resource missed in the same instant;
 *   the in-flight map added to fix that got the first miss right and the failure path wrong. A
 *   waiter woken by a FAILED or uncacheable mint claimed the slot without looking again, the
 *   waiters overwrote each other's claims, and each one's cleanup deleted somebody else's — the
 *   thundering herd back through the error door (found in review 2026-09-14, confirmed by
 *   reading). `Cache.get` shares one pending lookup among concurrent callers by design. MEASURED
 *   with a probe before this was written: ten concurrent gets on equal-but-distinct key objects ran
 *   the lookup once; a zero time-to-live ran it again for the next caller; a failure reached all
 *   ten waiters and was not kept.
 */
import * as Cache from 'effect/Cache';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import {
  type ApiTarget,
  type BaoEnvironment,
  type PveCredential,
  type PveRole,
  mintTier,
} from './credentials.ts';
import { mint } from './mint.ts';

/**
 * Re-mint once a lease is inside this much of its end, in seconds.
 *
 * ⚠️ 60s AGAINST A 300s PROVISION LEASE MEANS A CACHED CREDENTIAL IS ONLY EVER HANDED OUT WITH AT
 *   LEAST A MINUTE LEFT. The slowest single call in this package is `network-apply`'s reload poll,
 *   and that mints its own lease deliberately — see the ⚠️ on `pveWith` there — so nothing using
 *   this cache comes near a minute.
 * ⚠️ A MOUNT REPORTING NO `lease_duration` IS NEVER CACHED: `leaseSeconds` is `0` and
 *   `timeToLive` answers zero. Not caching is always safe; caching a credential whose lifetime is
 *   unknown is not.
 */
const REMINT_MARGIN_SECONDS = 60;

/**
 * What a credential is cached under.
 *
 * ⛔ KEYED ON THE OPENBAO MOUNT AND TIER, NOT ON A MEMBER HOSTNAME OR ON `role` (M3, red team on
 *   K-T1). A PVE API token is cluster-wide — `user.cfg` is replicated — so node-b, node-c and
 *   node-d share one credential. Keying on `api` would mint three identical tokens when failover
 *   rotates members. `role` USED to be part of this key too, but the minted credential depends
 *   only on `(mount, scheme, tier)` — `role` only ever fed `mintTier` to re-derive the tier the
 *   key already carries — so `roles: { read: 'x', provision: 'x' }` (one tier for both roles, the
 *   shape `docs/credentials.md` itself recommends) used to open TWO cache entries and mint TWO
 *   byte-for-byte interchangeable tokens for what is provably one credential. Dropping `role`
 *   collapses that back to one entry without changing the default case, where `tier === role`
 *   already.
 * ★ THE MOUNT CANNOT COLLIDE ACROSS CLUSTERS: `proxmox-c1`, `proxmox-c2` and `pbs-c1` are
 *   distinct OpenBao mounts with distinct policies; two estates never share a mount name.
 * ★ A PLAIN OBJECT IS A SAFE KEY BECAUSE EFFECT COMPARES KEYS STRUCTURALLY — two separately built
 *   literals with the same fields are one entry, which the probe above measured.
 *
 * ⛔ `tier` IS THE KEY, NOT `role` (K-T1). `targetForKey` below has to RECONSTRUCT a target from
 *   the key alone (it does not keep the caller's original `ApiTarget` around), and a
 *   `PveTarget.roles` override lives on THAT original target, not on `role` — so without `tier`
 *   in the key, every `leased()` call for an overridden role would resolve its override once at
 *   the first `keyOf`, then reuse whatever `targetForKey` happens to reconstruct on a cache miss,
 *   and TWO DIFFERENT overrides sharing one `{mount, scheme}` (e.g. one consumer's default `read`
 *   tier and another's `roles: {read: 'x'}` override, same mount) would collide into ONE cache
 *   entry and hand each other's credential to the wrong caller. Resolving the tier at `keyOf` —
 *   where the real target is still in hand — and keying on it closes that: two different tiers
 *   are two different entries, always.
 */
export type LeaseKey = {
  readonly mount: string;
  readonly scheme: ApiTarget['scheme'];
  readonly tier: string;
};

/**
 * ⚠️ EXPORTED FOR THE TEST (I1, red team on K-T1). This is the one line the whole PR exists
 *   for — `tier: mintTier(target, role)` is what makes an overridden `PveTarget.roles` reach the
 *   cached path at all. Nothing else in this file's test suite calls `keyOf` or `leased`
 *   directly, so without this export a regression here (e.g. reverting to `tier: role`) passed
 *   the whole suite silently.
 */
export const keyOf = (target: ApiTarget, role: PveRole): LeaseKey => ({
  mount: target.mount,
  scheme: target.scheme,
  tier: mintTier(target, role),
});

/**
 * How long a freshly minted credential may be handed out again.
 *
 * ⛔ ZERO FOR A FAILURE, FOR AN UNKNOWN LIFETIME AND FOR A LEASE INSIDE THE MARGIN. Zero means "do
 *   not keep": the callers already waiting on THIS mint still receive its result, and the next
 *   caller mints again. Keeping a failure would turn one refused mint into a refused run.
 * ⚠️ EXPORTED FOR THE TEST. The margin is the whole safety property, so it is pinned from both
 *   sides of its edge without waiting four minutes of wall clock.
 */
export const timeToLive = (exit: Exit.Exit<PveCredential, unknown>): Duration.Duration =>
  Exit.isSuccess(exit) && exit.value.leaseSeconds > REMINT_MARGIN_SECONDS
    ? Duration.seconds(exit.value.leaseSeconds - REMINT_MARGIN_SECONDS)
    : Duration.zero;

/**
 * A lease cache over any mint.
 *
 * ⚠️ ONE BEHAVIOUR CHANGED WITH THE MOVE TO `Cache`, DELIBERATELY. Callers waiting on a mint that
 *   FAILS now receive that failure, where the hand-written version had each of them mint again.
 *   They asked in the same instant for the same credential, and a plan with one failed resource
 *   fails either way — so the change is in how many errors the output lists, not in the outcome,
 *   and a sealed vault is asked once rather than ninety-eight times.
 * ★ `requireServicesAt: 'lookup'` IS WHAT LETS IT BE BUILT ONCE, AT IMPORT. The mint needs an
 *   `HttpClient`; that requirement moves to each `get`, where every caller already has one.
 * ⚠️ EXPORTED FOR THE TEST, which hands it a counting mint instead of calling OpenBao.
 */
export const makeLeases = <E, R>(mintFor: (key: LeaseKey) => Effect.Effect<PveCredential, E, R>) =>
  Cache.makeWith(mintFor, { capacity: 64, requireServicesAt: 'lookup', timeToLive });

/**
 * ⛔ CARRIES `key.tier` BACK IN AS A `roles` OVERRIDE (K-T1), SO `mint`'S OWN `mintTier` CALL
 *   REPRODUCES THE SAME TIER `keyOf` ALREADY RESOLVED. This target is synthetic — it is never the
 *   caller's real `PveTarget` (`members`/`api` are throwaway placeholders `mint` never reads) —
 *   and, since M3 dropped `role` from `LeaseKey`, it no longer even knows which semantic role
 *   produced `key.tier`. It doesn't need to: `roles: { read: key.tier }` plus always minting with
 *   the fixed role `'read'` (below) makes `mintTier(targetForKey(key), 'read') === key.tier`
 *   unconditionally, because `mintTier` only ever consults the ONE role it's called with. Which
 *   role the ORIGINAL caller asked for is irrelevant here — `keyOf` already folded that into
 *   `key.tier` before this function ever sees the key.
 * ⚠️ THE PBS BRANCH MINTS WITH `key.tier` ITSELF AS THE ROLE, NOT `'read'`. A `PbsTarget` has no
 *   `roles` override (see `credentials.ts`'s ⛔ on `PbsTarget`), so `mintTier` for `scheme:'pbs'`
 *   always returns its `role` argument unchanged — meaning `key.tier` for a PBS key IS the literal
 *   role name (`'read'`/`'provision'`) `keyOf` recorded. Passing anything else here would ask
 *   OpenBao for the wrong tier.
 * ⚠️ EXPORTED FOR THE TEST, which checks that round trip directly rather than only through the
 *   cache's externally visible behaviour.
 */
export const targetForKey = (key: LeaseKey): ApiTarget =>
  key.scheme === 'pbs'
    ? { api: 'https://pbs.invalid/api2/json', mount: key.mount, scheme: 'pbs' }
    : { members: [], mount: key.mount, roles: { read: key.tier }, scheme: 'pve' };

/**
 * ⚠️ EXPORTED FOR THE TEST (second red-team pass on K-T1). `targetForKey`'s own tests call
 *   `mintTier(targetForKey(key), 'read')` to check the round trip, which hand-reproduces this
 *   function's fixed choice of `'read'` as the pve mint role rather than exercising it — change
 *   that choice here and those tests keep passing while a live cache miss mints the wrong tier.
 *   Testing this function directly (against a fake OpenBao) pins the choice itself.
 *
 * ⚠️ `env` DEFAULTS TO `process.env`, SAME AS `mint` ITSELF (credentials.ts) — the cache's real
 *   caller below (`Effect.runSync(makeLeases(mintForKey))`) always calls this with one argument,
 *   so the default is what production runs on. The parameter exists only so the test can pass a
 *   fake OpenBao's address without touching the real environment.
 */
export const mintForKey = (key: LeaseKey, env: BaoEnvironment = process.env) =>
  mint(targetForKey(key), key.scheme === 'pbs' ? (key.tier as PveRole) : 'read', env);

const leases = Effect.runSync(makeLeases(mintForKey));

/**
 * A credential for `role` on `target`: a still-valid lease when one is kept, one shared mint when
 * not.
 *
 * ★ client.ts is the one place that decides to use the cache. `mint` stays exported and unchanged
 *   for the caller that reasons about identity rather than cost — network-apply.ts.
 */
export const leased = (target: ApiTarget, role: PveRole) => Cache.get(leases, keyOf(target, role));
