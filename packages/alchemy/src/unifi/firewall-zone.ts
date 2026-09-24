/**
 * `Unifi.FirewallZone` — one firewall zone on a UniFi Network site, READ-ONLY (`policy.ts`).
 *
 * ★ WHY FIREWALL ZONE IS IN THE FIRST IMPORT SET AND `Unifi.FirewallPolicy` IS NOT.
 *   `getFirewallZone`/`getFirewallZones` (`firewall.ts`) is a list+get pair over genuine,
 *   simply-shaped configuration: `{id, metadata, name, networkIds}`, four fields, no nested
 *   discriminated filter. `FirewallPolicy` (same file) is also list+get and also configuration,
 *   but its `source`/`destination`/`ipProtocolScope` fields carry several of `docs/unifi-api-notes.md`'s
 *   "converter-flattened discriminator variants" each, and `firewall/policies/ordering` replaces
 *   the whole ordered list — modelling those correctly is a bigger, separate PR (`network.ts`'s
 *   header note names it explicitly) rather than something to rush alongside this one.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as firewall from '@distilled.cloud/unifi-network/firewall';
import * as Effect from 'effect/Effect';
import {
  type FirewallZoneAttributes,
  type FirewallZoneProps,
  attributesOf,
  matches,
} from './firewall-zone-form.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';

export type { FirewallZoneAttributes, FirewallZoneProps } from './firewall-zone-form.ts';
export { declareFirewallZone } from './firewall-zone-form.ts';

export interface UnifiFirewallZone extends Resource<
  'Unifi.FirewallZone',
  FirewallZoneProps,
  FirewallZoneAttributes,
  never,
  UnifiRequirements
> {}

export const UnifiFirewallZone = Resource<UnifiFirewallZone>('Unifi.FirewallZone', {
  defaultRemovalPolicy: 'retain',
});

/** `firewallZone('lan', props)` — `adopt(true)` piped on by default (H5); see `network.ts`. */
export const firewallZone = (id: string, props: FirewallZoneProps) =>
  UnifiFirewallZone(id, props).pipe(adopt(true));

/** ★ EXPORTED for direct testing against a fake `Credentials` layer — see `network.ts`'s own. */
export const spec: UnifiSpec<
  FirewallZoneProps,
  firewall.FirewallZone,
  FirewallZoneAttributes,
  firewall.GetFirewallZoneError
> = {
  type: 'Unifi.FirewallZone',
  describe: (props) => `sites/${props.siteId}/firewall/zones/${props.firewallZoneId}`,
  fetchLive: (props) =>
    firewall
      .getFirewallZone({ siteId: props.siteId, firewallZoneId: props.firewallZoneId })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  attributes: attributesOf,
  matches,
};

export const handlers = unifiHandlers(spec);

export const UnifiFirewallZoneProvider = () =>
  Provider.effect(UnifiFirewallZone, Effect.succeed(UnifiFirewallZone.Provider.of(handlers)));
