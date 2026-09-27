/**
 * `Unifi.FirewallPolicyOrdering` — the ordered `before`/`afterSystemDefined` policy-id lists for
 * ONE `(sourceFirewallZoneId, destinationFirewallZoneId)` zone pair (`getFirewallPolicyOrdering`,
 * `GET /v1/sites/{siteId}/firewall/policies/ordering`), READ-ONLY (`policy.ts`). T5/I4's per-family
 * variant: `docs/unifi.md`'s own header named this "a future `Unifi.FirewallPolicyOrdering`" as a
 * separate, bigger PR (see `acl-rule-ordering.ts`'s header for the same forward reference, now
 * resolved) — this is that resource.
 *
 * ⚠️ NOT ONE OBJECT PER SITE, UNLIKE `acl-rule-ordering.ts` — the identity is the TRIPLE
 *   `(siteId, sourceFirewallZoneId, destinationFirewallZoneId)`, both zone ids passed as QUERY
 *   parameters on the same path every time (`firewall.ts`'s `GetFirewallPolicyOrderingRequest`).
 *   There is no "list every zone pair with an ordering" endpoint — a caller (a future Lane C import)
 *   has to already know which pairs exist, typically by walking `firewall.getFirewallPolicies`
 *   (T9's own 424-live-policy scale — B0b's `pageAll`, see `firewall-policy.test.ts`'s own decode
 *   proof) and grouping by each policy's `source.zoneId`/`destination.zoneId`. Nothing here performs
 *   that discovery — this resource is one already-known pair's ordering, same as
 *   `firewall-policy.ts`/`acl-rule.ts` are one already-known object's own fields.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as firewall from '@distilled.cloud/unifi-network/firewall';
import * as Effect from 'effect/Effect';
import {
  type FirewallPolicyOrderingAttributes,
  type FirewallPolicyOrderingProps,
  attributesOf,
  matches,
} from './firewall-policy-ordering-form.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';

export type {
  FirewallPolicyOrderingAttributes,
  FirewallPolicyOrderingProps,
} from './firewall-policy-ordering-form.ts';
export { declareFirewallPolicyOrdering, driftOf } from './firewall-policy-ordering-form.ts';

export interface UnifiFirewallPolicyOrdering extends Resource<
  'Unifi.FirewallPolicyOrdering',
  FirewallPolicyOrderingProps,
  FirewallPolicyOrderingAttributes,
  never,
  UnifiRequirements
> {}

export const UnifiFirewallPolicyOrdering = Resource<UnifiFirewallPolicyOrdering>(
  'Unifi.FirewallPolicyOrdering',
  { defaultRemovalPolicy: 'retain' },
);

/** `firewallPolicyOrdering('iot-to-external', props)` — `adopt(true)` piped on by default (H5); see
 *  `network.ts`. */
export const firewallPolicyOrdering = (id: string, props: FirewallPolicyOrderingProps) =>
  UnifiFirewallPolicyOrdering(id, props).pipe(adopt(true));

/** ★ EXPORTED for direct testing against a fake `Credentials` layer — see `network.ts`'s own. */
export const spec: UnifiSpec<
  FirewallPolicyOrderingProps,
  firewall.IntegrationFirewallPolicyOrderingDto,
  FirewallPolicyOrderingAttributes,
  firewall.GetFirewallPolicyOrderingError
> = {
  type: 'Unifi.FirewallPolicyOrdering',
  describe: (props) =>
    `sites/${props.siteId}/firewall/policies/ordering` +
    `?sourceFirewallZoneId=${props.sourceFirewallZoneId}` +
    `&destinationFirewallZoneId=${props.destinationFirewallZoneId}`,
  fetchLive: (props) =>
    firewall
      .getFirewallPolicyOrdering({
        siteId: props.siteId,
        sourceFirewallZoneId: props.sourceFirewallZoneId,
        destinationFirewallZoneId: props.destinationFirewallZoneId,
      })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  attributes: attributesOf,
  matches,
};

export const handlers = unifiHandlers(spec);

export const UnifiFirewallPolicyOrderingProvider = () =>
  Provider.effect(
    UnifiFirewallPolicyOrdering,
    Effect.succeed(UnifiFirewallPolicyOrdering.Provider.of(handlers)),
  );
