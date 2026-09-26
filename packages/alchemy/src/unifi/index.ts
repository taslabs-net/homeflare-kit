/**
 * UniFi Network providers for Alchemy — READ-ONLY, by Tim's rule (2026-09-24; `policy.ts`).
 *
 * ⛔ THIS BARREL IS THE PUBLIC API, SMALLER THAN THE DIRECTORY. `resource.ts`'s generic engine
 *   and each `*-form.ts`'s wire helpers are internals a provider needs but a consumer should
 *   not depend on — mirrors `../netbox/index.ts`.
 */
export { UNIFI_READ_ONLY_POLICY, UnifiWriteRefused, type UnifiWriteAction } from './policy.ts';
export { UnifiNonGetRequest, type UnifiRequirements, type UnifiSpec } from './resource.ts';
export type { FieldDrift } from './drift.ts';
export {
  UnifiNetwork,
  UnifiNetworkProvider,
  declareNetwork,
  network,
  type NetworkAttributes,
  type NetworkProps,
  // B6: renamed here, not in `network.ts` — `network-form.ts`'s `matches`/`attributesOf` name the
  // same function identically per family (never barrel-exported); `driftOf` IS barrel-exported, so
  // it needs a name unique across both families the moment it leaves `network.ts`.
  driftOf as networkDriftOf,
} from './network.ts';
export {
  UnifiFirewallZone,
  UnifiFirewallZoneProvider,
  declareFirewallZone,
  firewallZone,
  type FirewallZoneAttributes,
  type FirewallZoneProps,
  driftOf as firewallZoneDriftOf,
} from './firewall-zone.ts';
export { providers } from './providers.ts';
