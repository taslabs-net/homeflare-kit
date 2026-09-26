/**
 * `Unifi.AclRule` — one user-defined ACL rule on a UniFi Network site, READ-ONLY (`policy.ts`).
 * `Unifi.AclRuleOrdering` (`acl-rule-ordering.ts`) is the sibling resource for rule ORDER (T5) —
 * one per site, never this file's concern.
 *
 * ★ T11 GATE — see `dns-policy.ts`'s own header for the full closure-diff record: `Access Control
 *   (ACL Rules)` (7 ops, including `getAclRuleOrdering`/`updateAclRuleOrdering`) is
 *   byte-identical between 10.4.57 and 10.6.97, and unreachable from any of the 14 schemas that DID
 *   change. Full breakdown: `docs/unifi-acl-rule.md`.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as aclRules from '@distilled.cloud/unifi-network/access_control_acl_rules';
import * as Effect from 'effect/Effect';
import { type AclRuleAttributes, type AclRuleProps, attributesOf } from './acl-rule-form.ts';
import { matches } from './acl-rule-drift.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';

export type { AclRuleAttributes, AclRuleProps } from './acl-rule-form.ts';
export { declareAclRule } from './acl-rule-form.ts';
export { driftOf } from './acl-rule-drift.ts';

export interface UnifiAclRule extends Resource<
  'Unifi.AclRule',
  AclRuleProps,
  AclRuleAttributes,
  never,
  UnifiRequirements
> {}

export const UnifiAclRule = Resource<UnifiAclRule>('Unifi.AclRule', {
  defaultRemovalPolicy: 'retain',
});

/** `aclRule('block-iot-wan', props)` — `adopt(true)` piped on by default (H5); see `network.ts`. */
export const aclRule = (id: string, props: AclRuleProps) =>
  UnifiAclRule(id, props).pipe(adopt(true));

/** ★ EXPORTED for direct testing against a fake `Credentials` layer — see `network.ts`'s own. */
export const spec: UnifiSpec<
  AclRuleProps,
  aclRules.ACLRule,
  AclRuleAttributes,
  aclRules.GetAclRuleError
> = {
  type: 'Unifi.AclRule',
  describe: (props) => `sites/${props.siteId}/acl-rules/${props.aclRuleId}`,
  fetchLive: (props) =>
    aclRules
      .getAclRule({ siteId: props.siteId, aclRuleId: props.aclRuleId })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  attributes: attributesOf,
  matches,
};

export const handlers = unifiHandlers(spec);

export const UnifiAclRuleProvider = () =>
  Provider.effect(UnifiAclRule, Effect.succeed(UnifiAclRule.Provider.of(handlers)));
