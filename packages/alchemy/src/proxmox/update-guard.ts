/**
 * Whether an update has anything to write — decided ONCE for every PVE and PBS family.
 *
 * ⛔ AN ADOPTED ROW IS RECONCILED EVEN WHEN ITS DIFF SAID `noop`, SO THIS GUARD IS WHAT MAKES
 *   ADOPTION FREE. alchemy beta.79 Plan.ts sets `forceUpdateAfterAdoption` after the cold-start
 *   probe and turns a `noop` diff into an update; Apply.ts then calls `reconcile` for the
 *   `adopted` action exactly as for `update`. The plan prints `adopted` either way, so nothing on
 *   screen tells a matching object from a drifting one. docs/adopt-verify.md has the table of
 *   what each family does on that path.
 *
 * 🔴 THE FAMILY THAT DID NOT HAVE IT. `Proxmox.CephPool` wrote its own reconcile and PUT the
 *   declared set whenever the pool existed, so adopting a pool that already matched sent
 *   `setpool` and forked a worker on the live cluster (found 2026-09-21 by tracing every family).
 *   resource.ts and pbs-datastore.ts each had the guard inline; three copies of one predicate is
 *   how the fourth family forgets it, so it lives here and all three call it.
 *
 * ★ `matches` IS THE SAME PREDICATE `diff` USES, so "the diff said noop" and "reconcile writes
 *   nothing" cannot disagree. A field left OUT of `matches` is one the family does not manage, so
 *   its drift is not this write's to repair.
 *
 * ⚠️ AN EMPTY FORM IS ALSO NOT A WRITE. `updateForm` can legitimately answer `{}` — a storage
 *   declaring only `storage`, `type` and its locator has no mutable field at all — and PUTting an
 *   empty body is a pointless write at best and a 400 that reads as a broken provider at worst.
 *   (Moved here from resource.ts with the guard it explains.)
 */
export const formToSend = <Attributes, Props, Form extends object>(
  matches: (attributes: Attributes, props: Props) => boolean,
  live: Attributes,
  props: Props,
  form: Form,
): Form | undefined => (matches(live, props) || Object.keys(form).length === 0 ? undefined : form);
