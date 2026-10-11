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
 * ⛔ THE WHOLE-OBJECT-PUT TRAP (packages/distilled-unifi-network/README.md) FIRES HERE, THROUGH `network-update.ts`;
 *   see its header. `updateNetwork` is a `PUT` that disables `dhcpGuarding`/`ipv4Configuration`/
 *   `ipv6Configuration` outright when the caller omits them, so the body is the raw live object
 *   plus only the fields the declaration changed since the last deploy — never props alone.
 *   This is the ONE family with a write path (Tim 2026-10-10, `policy.ts`); create/delete refuse.
 */
import { Resource } from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Provider from 'alchemy/Provider';
import * as networks from '@distilled.cloud/unifi-network/networks';
import * as Effect from 'effect/Effect';
import { type NetworkAttributes, type NetworkProps, attributesOf } from './network-form.ts';
import { driftOf, matches } from './network-drift.ts';
import { type ScopeError, checkNetworkWriteScope } from './network-scope.ts';
import { writeNetwork } from './network-update.ts';
import type { UnifiUpdateWouldBeNoop } from './policy.ts';
import type { UnifiRequirements, UnifiSpec } from './resource.ts';
import { unifiHandlers } from './resource.ts';
import type { AllowedWrite } from './wire-guard.ts';

type UpdateError = networks.UpdateNetworkError | UnifiUpdateWouldBeNoop | ScopeError;

export type { NetworkAttributes, NetworkProps } from './network-form.ts';
export { declareNetwork } from './network-form.ts';
// MEDIUM-4: `matches` moved here from `network-form.ts` — see network-drift.ts's own header. Not
// re-exported from this barrel file either, same as before the move: `spec.matches` below is the
// only consumer a provider needs.
export { driftOf } from './network-drift.ts';

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
 * `network('lan', props)` — `adopt(true)` piped on by default (H5). A cold first deploy against an
 * existing network can still only bind to it or refuse `OwnedBySomeoneElse` — the update path
 * needs prior Alchemy state (`update-reconcile.ts`), so it cannot fire on adoption. Piping
 * `adopt(true)` here picks the bind without a stack having to remember `--adopt`, mirroring
 * `discord/application-command.ts`'s `applicationCommand`.
 */
export const network = (id: string, props: NetworkProps) =>
  UnifiNetwork(id, props).pipe(adopt(true));

/**
 * ★ EXPORTED for direct testing against a fake `Credentials` layer (`fake-unifi.ts`), the same
 *   seam `netbox/prefix.ts`'s `spec` and `discord/application-command.ts`'s `spec` use — `handlers`
 *   bakes in `CredentialsFromEnv`, which resolves environment variables a test cannot repoint.
 */
/**
 * Every declarable key: `NetworkProps` minus the two identity ids. A test pins this against a
 * fully-populated `NetworkProps` literal so a new prop cannot be silently unpatchable.
 */
export const NETWORK_PATCH_KEYS: ReadonlyArray<keyof NetworkProps> = [
  'name',
  'enabled',
  'management',
  'vlanId',
  'dhcpGuarding',
  'cellularBackupEnabled',
  'internetAccessEnabled',
  'ipv4Configuration',
  'ipv6Configuration',
  'isolationEnabled',
  'mdnsForwardingEnabled',
  'zoneId',
  'deviceId',
];

/**
 * The only PUT that may pass for this row: its own `/v1/sites/<siteId>/networks/<networkId>` under
 * the configured base URL. ⛔ Built from the row's NEW props (the ids the write is about to use) and
 * compared by exact string against the request path, so no id can act as a pattern.
 */
export const networkAllowedWrite = (props: NetworkProps): AllowedWrite => ({
  method: 'PUT',
  tail: `/v1/sites/${props.siteId}/networks/${props.networkId}`,
});

export const spec: UnifiSpec<
  NetworkProps,
  networks.NetworkDetails,
  NetworkAttributes,
  networks.GetNetworkDetailsError,
  UpdateError
> = {
  type: 'Unifi.Network',
  describe: (props) => `sites/${props.siteId}/networks/${props.networkId}`,
  fetchLive: (props) =>
    networks
      .getNetworkDetails({ siteId: props.siteId, networkId: props.networkId })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  attributes: attributesOf,
  matches,
  update: {
    allowedWrite: networkAllowedWrite,
    patchKeys: NETWORK_PATCH_KEYS,
    driftOf,
    checkScope: checkNetworkWriteScope,
    write: writeNetwork,
  },
};

export const handlers = unifiHandlers(spec);

export const UnifiNetworkProvider = () =>
  Provider.effect(UnifiNetwork, Effect.succeed(UnifiNetwork.Provider.of(handlers)));
