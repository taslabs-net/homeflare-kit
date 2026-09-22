/**
 * The wire body for a `Netbox.Prefix`, and the comparison that decides whether it needs writing.
 *
 * ★ EXTRACTED SO IT CAN BE TESTED WITHOUT A SERVER. `body` and `matches` are where a NetBox
 *   resource either converges or quietly destroys something, and both are pure functions of the
 *   props — so they belong somewhere a test can call them with a literal, the way the Proxmox
 *   families keep their `*-form.ts` beside the resource.
 */
import type { PrefixAttributes, PrefixProps, PrefixStatus } from './prefix.ts';

/** ⚠️ NetBox's own default when the property is omitted, copied from the schema, not assumed. */
const DEFAULT_STATUS: PrefixStatus = 'active';

/**
 * The fields an undeclared prop still settles, because NetBox itself would.
 *
 * ⛔ FREE TEXT IS NOT IN HERE, AND THE LINE IS NOT COSMETIC. `status`, `is_pool` and
 *   `mark_utilized` have vendor defaults in the schema — omitting one genuinely means "the
 *   default", so settling it says what NetBox would have done anyway. `description` and
 *   `comments` have no such default: the schema's `''` is the absence of a value, not a decision.
 *   Treating "I did not mention it" as "set it to empty" is how a declaration that says nothing
 *   about prose ERASES prose somebody wrote.
 */
export const settled = (props: PrefixProps) => ({
  isPool: props.isPool ?? false,
  markUtilized: props.markUtilized ?? false,
  status: props.status ?? DEFAULT_STATUS,
});

/**
 * ⛔ THE BODY IS BUILT ONCE AND USED FOR BOTH CREATE AND UPDATE, so a field cannot be settable on
 *   one path and forgotten on the other — the failure mode that makes a resource converge on
 *   create and drift forever after.
 *
 * 🔴 AN UNDECLARED FIELD THAT NETBOX DOES NOT DEFAULT IS OMITTED, NEVER SENT EMPTY OR NULL. This
 *   resource shipped sending `description: ''` whenever the prop was absent. On a fresh create
 *   that is invisible — the field was empty anyway. ⛔ ON AN ADOPT IT IS DATA LOSS: NetBox is the
 *   estate's record of DECISIONS, so the description on an existing prefix is usually the only
 *   written trace of why that range exists, and the first deploy that adopted it would have
 *   PATCHed it to empty. `matches` would have reported drift, the plan would have said `update`,
 *   and the diff would have read as converging a declaration rather than deleting a sentence.
 * ★ THE TELL WAS ALREADY IN THIS FILE: foreign keys were omitted for exactly this reason while
 *   free text was not. An inconsistency between two fields with the same hazard is the bug.
 * ⚠️ THE COST IS THAT PROSE CANNOT BE CLEARED BY OMISSION — clearing it is `description: ''`,
 *   written on purpose, which is the readable way to say a destructive thing.
 */
export const prefixBody = (props: PrefixProps): Record<string, unknown> => {
  const fixed = settled(props);
  const out: Record<string, unknown> = {
    is_pool: fixed.isPool,
    mark_utilized: fixed.markUtilized,
    prefix: props.prefix,
    status: fixed.status,
  };
  if (props.description !== undefined) out['description'] = props.description;
  if (props.comments !== undefined) out['comments'] = props.comments;
  if (props.vrf !== undefined) out['vrf'] = props.vrf;
  if (props.tenant !== undefined) out['tenant'] = props.tenant;
  if (props.vlan !== undefined) out['vlan'] = props.vlan;
  return out;
};

/**
 * Whether the live object already says what the declaration says.
 *
 * ⛔ EVERY FIELD `prefixBody` OMITS IS ALSO UNCOMPARED HERE, AND THE TWO MUST MOVE TOGETHER. A
 *   comparison against a field the body does not send reports drift no write can fix: the plan
 *   says `update`, the PATCH omits the field, and the next plan says `update` again — forever.
 *   An undeclared prop means "not mine", in both directions.
 * ⚠️ `vrf` IS ABSENT ON PURPOSE. It is identity, not settings: `identifies` has already proved
 *   this row is in the declared VRF, and a prefix's VRF cannot be edited into another one here.
 */
export const prefixMatches = (attributes: PrefixAttributes, props: PrefixProps): boolean => {
  const fixed = settled(props);
  return (
    attributes.status === fixed.status &&
    attributes.isPool === fixed.isPool &&
    attributes.markUtilized === fixed.markUtilized &&
    (props.description === undefined || attributes.description === props.description) &&
    (props.comments === undefined || attributes.comments === props.comments) &&
    (props.tenant === undefined || attributes.tenant === props.tenant) &&
    (props.vlan === undefined || attributes.vlan === props.vlan)
  );
};
