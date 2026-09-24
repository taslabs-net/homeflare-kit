/**
 * UniFi Network providers for Alchemy — READ-ONLY, by Tim's rule (2026-09-24; `policy.ts`).
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, SMALLER THAN THE DIRECTORY. `resource.ts`'s generic engine
 *   and each `*-form.ts`'s wire helpers are internals a provider needs but a consumer should
 *   not depend on — mirrors `../netbox/index.ts`.
 */
export { UNIFI_READ_ONLY_POLICY, UnifiWriteRefused, type UnifiWriteAction } from './policy.ts';
export type { UnifiRequirements, UnifiSpec } from './resource.ts';
export {
  UnifiNetwork,
  UnifiNetworkProvider,
  declareNetwork,
  network,
  type NetworkAttributes,
  type NetworkProps,
} from './network.ts';
export {
  UnifiFirewallZone,
  UnifiFirewallZoneProvider,
  declareFirewallZone,
  firewallZone,
  type FirewallZoneAttributes,
  type FirewallZoneProps,
} from './firewall-zone.ts';
export { providers } from './providers.ts';
