/**
 * `Unifi.FirewallPolicy`'s `matches` AND `driftOf` (B6) — both built on the ONE field list below,
 * the same `fieldDrift`-is-the-only-comparison shape `network-drift.ts`'s header explains (MEDIUM-4,
 * red team, 2026-09-26): `matches(attrs, props) === (driftOf(live, props).length === 0)` is true
 * BY CONSTRUCTION, never two hand-kept-in-sync comparisons.
 *
 * ⚠️ `stripNullish: true` ON EVERY FIELD BY DEFAULT (`drift.ts`'s `defaultEqual`) — same "UniFi's
 *   JSON answers `null`, a declaration omits" tolerance every other family here relies on.
 * ⛔ `connectionStateFilter` RUNS THROUGH `firewall-policy-form.ts`'s normalizer on BOTH sides
 *   before comparing — never applied to only `live` or only `declared` (the specific gap MEDIUM-4's
 *   own mutant found in `network-drift.ts`; see its header, and `acl-rule-drift.ts`'s own repeat of
 *   this same rule for `protocolFilter`/`enforcingDeviceFilter`).
 * ★ `action`/`destination`/`ipProtocolScope`/`schedule`/`source` compare with the plain default
 *   `equal` (whole-value `deepEqual`) — see `firewall-policy-form.ts`'s header for the accepted
 *   known gap this leaves in their own nested set-like arrays.
 */
import type * as firewall from '@distilled.cloud/unifi-network/firewall';
import { makeDriftOf } from './drift.ts';
import {
  type FirewallPolicyAttributes,
  type FirewallPolicyProps,
  attributesOf,
  normalizeConnectionStateFilter,
} from './firewall-policy-form.ts';

const fieldDrift = makeDriftOf<FirewallPolicyAttributes, FirewallPolicyProps>([
  { field: 'action', live: (a) => a.action, declared: (p) => p.action },
  {
    field: 'connectionStateFilter',
    live: (a) => normalizeConnectionStateFilter(a.connectionStateFilter),
    declared: (p) => normalizeConnectionStateFilter(p.connectionStateFilter),
  },
  { field: 'description', live: (a) => a.description, declared: (p) => p.description },
  { field: 'destination', live: (a) => a.destination, declared: (p) => p.destination },
  { field: 'enabled', live: (a) => a.enabled, declared: (p) => p.enabled },
  { field: 'ipProtocolScope', live: (a) => a.ipProtocolScope, declared: (p) => p.ipProtocolScope },
  { field: 'ipsecFilter', live: (a) => a.ipsecFilter, declared: (p) => p.ipsecFilter },
  { field: 'loggingEnabled', live: (a) => a.loggingEnabled, declared: (p) => p.loggingEnabled },
  { field: 'name', live: (a) => a.name, declared: (p) => p.name },
  { field: 'schedule', live: (a) => a.schedule, declared: (p) => p.schedule },
  { field: 'source', live: (a) => a.source, declared: (p) => p.source },
]);

export const matches = (
  attributes: FirewallPolicyAttributes,
  props: FirewallPolicyProps,
): boolean => fieldDrift(attributes, props).length === 0;

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`), so `homeflare-network`'s pre-import drift check never has to derive
 * `attributesOf` itself just to call this.
 */
export const driftOf = (live: firewall.FirewallPolicy, props: FirewallPolicyProps) =>
  fieldDrift(attributesOf(live, props), props);
