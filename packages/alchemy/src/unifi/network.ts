/**
 * `Unifi.Network` — one network on a UniFi Network site, READ-ONLY (`policy.ts`).
 *
 * ★ WHY NETWORK IS IN THE FIRST IMPORT SET. `getNetworkDetails`/`getNetworksOverviewPage`
 *   (`../../distilled-unifi-network/src/services/networks.ts`) is a list+get pair over
 *   genuine configuration — VLAN, DHCP guarding, IPv4/IPv6 addressing, isolation — not runtime
 *   state like a connected client, a device statistic or a hotspot voucher. It is also the SDK
 *   package's own README recommendation for a first read/adopt-only resource, alongside `Site`
 *   (skipped here — no `getSite`, only the list operation, so it fails this task's own "both a
 *   list and a get" bar) and `FirewallZone`/`FirewallPolicy` (`firewall-zone.ts` ships
 *   `FirewallZone`; `FirewallPolicy`'s several discriminated filter variants and its
 *   list-replacing ordering endpoint are a bigger, separate PR).
 *
 * ⛔ THE WHOLE-OBJECT-PUT TRAP (`docs/unifi-api-notes.md`) NEVER FIRES HERE, BY CONSTRUCTION.
 *   `updateNetwork` is a `PUT` that disables `dhcpGuarding`/`ipv4Configuration`/`ipv6Configuration`
 *   outright when the caller omits them — the exact failure mode a read-only family cannot cause,
 *   because `resource.ts`'s `reconcile` never calls `updateNetwork` at all. Recorded here for
 *   whoever adds the write path this docs note anticipates: read-merge-write the WHOLE object,
 *   never a props-only body.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as networks from '@distilled.cloud/unifi-network/networks';
import * as Effect from 'effect/Effect';
import {
  type NetworkAttributes,
  type NetworkProps,
  attributesOf,
  matches,
} from './network-form.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';

export type { NetworkAttributes, NetworkProps } from './network-form.ts';
export { declareNetwork } from './network-form.ts';

export interface UnifiNetwork extends Resource<
  'Unifi.Network',
  NetworkProps,
  NetworkAttributes,
  never,
  UnifiRequirements
> {}

export const UnifiNetwork = Resource<UnifiNetwork>('Unifi.Network', {
  defaultRemovalPolicy: 'retain',
});

/**
 * `network('lan', props)` — `adopt(true)` piped on by default (H5). This family never writes, so
 * the only thing a first deploy against an existing network could ever do is bind to it or refuse
 * `OwnedBySomeoneElse`; piping `adopt(true)` here picks the former without a stack having to
 * remember `--adopt`, mirroring `discord/application-command.ts`'s `applicationCommand`.
 */
export const network = (id: string, props: NetworkProps) =>
  UnifiNetwork(id, props).pipe(adopt(true));

/**
 * ★ EXPORTED for direct testing against a fake `Credentials` layer (`fake-unifi.ts`), the same
 *   seam `netbox/prefix.ts`'s `spec` and `discord/application-command.ts`'s `spec` use — `handlers`
 *   bakes in `CredentialsFromEnv`, which resolves environment variables a test cannot repoint.
 */
export const spec: UnifiSpec<
  NetworkProps,
  networks.NetworkDetails,
  NetworkAttributes,
  networks.GetNetworkDetailsError
> = {
  type: 'Unifi.Network',
  describe: (props) => `sites/${props.siteId}/networks/${props.networkId}`,
  fetchLive: (props) =>
    networks
      .getNetworkDetails({ siteId: props.siteId, networkId: props.networkId })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  attributes: attributesOf,
  matches,
};

export const handlers = unifiHandlers(spec);

export const UnifiNetworkProvider = () =>
  Provider.effect(UnifiNetwork, Effect.succeed(UnifiNetwork.Provider.of(handlers)));
