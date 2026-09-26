/**
 * `Unifi.AclRuleOrdering` — the ONE ordered list of user-defined ACL rule IDs for a site
 * (`getAclRuleOrdering`/`updateAclRuleOrdering`, `GET`/`PUT /v1/sites/{siteId}/acl-rules/ordering`),
 * READ-ONLY (`policy.ts`). T5's per-family variant of the ordering trap `docs/unifi-api-notes.md`
 * warns about for `Unifi.FirewallPolicyOrdering` (`firewall-policy-ordering.ts`, keyed per zone
 * pair rather than site-wide — see its own header for why): the endpoint replaces the WHOLE list
 * on a write, so a partial or resorted body would drop or reorder every OTHER rule too.
 * This family never writes at all, but its `matches`/`driftOf` (`acl-rule-ordering-form.ts`) are
 * still order-preserving, never `sortedSet`, so a future write path inherits a correct comparison
 * rather than one that has to be fixed alongside the first `update`.
 *
 * ★ ONE OBJECT PER SITE, NOT PER RULE — unlike `acl-rule.ts`, there is no per-object id in the
 *   wire response at all (`ACLRuleOrdering` is just `{ orderedAclRuleIds }`); the resource's own
 *   `id` (the stack-chosen string passed to `aclRuleOrdering(id, props)`) is a label the DECLARER
 *   picks, same as `firewallZone`/`network`, not something read back from the vendor.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as aclRules from '@distilled.cloud/unifi-network/access_control_acl_rules';
import * as Effect from 'effect/Effect';
import {
  type AclRuleOrderingAttributes,
  type AclRuleOrderingProps,
  attributesOf,
  matches,
} from './acl-rule-ordering-form.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';

export type { AclRuleOrderingAttributes, AclRuleOrderingProps } from './acl-rule-ordering-form.ts';
export { declareAclRuleOrdering, driftOf } from './acl-rule-ordering-form.ts';

export interface UnifiAclRuleOrdering extends Resource<
  'Unifi.AclRuleOrdering',
  AclRuleOrderingProps,
  AclRuleOrderingAttributes,
  never,
  UnifiRequirements
> {}

export const UnifiAclRuleOrdering = Resource<UnifiAclRuleOrdering>('Unifi.AclRuleOrdering', {
  defaultRemovalPolicy: 'retain',
});

/** `aclRuleOrdering('site-1', props)` — `adopt(true)` piped on by default (H5); see `network.ts`. */
export const aclRuleOrdering = (id: string, props: AclRuleOrderingProps) =>
  UnifiAclRuleOrdering(id, props).pipe(adopt(true));

/** ★ EXPORTED for direct testing against a fake `Credentials` layer — see `network.ts`'s own. */
export const spec: UnifiSpec<
  AclRuleOrderingProps,
  aclRules.ACLRuleOrdering,
  AclRuleOrderingAttributes,
  aclRules.GetAclRuleOrderingError
> = {
  type: 'Unifi.AclRuleOrdering',
  describe: (props) => `sites/${props.siteId}/acl-rules/ordering`,
  fetchLive: (props) =>
    aclRules
      .getAclRuleOrdering({ siteId: props.siteId })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  attributes: attributesOf,
  matches,
};

export const handlers = unifiHandlers(spec);

export const UnifiAclRuleOrderingProvider = () =>
  Provider.effect(UnifiAclRuleOrdering, Effect.succeed(UnifiAclRuleOrdering.Provider.of(handlers)));
