/**
 * `Unifi.DnsPolicy`'s `matches` AND `driftOf` (B6) — both built on the ONE field list below, the
 * same `fieldDrift`-is-the-only-comparison shape `network-drift.ts`'s own header explains (MEDIUM-4,
 * red team, 2026-09-26): `matches(attrs, props) === (driftOf(live, props).length === 0)` is true
 * BY CONSTRUCTION, never two hand-kept-in-sync comparisons.
 *
 * ★ NO CUSTOM `equal` ANYWHERE. Every field is a scalar and `drift.ts`'s `defaultEqual`
 *   (`deepEqual` with `stripNullish: true`) already gives UniFi's `null`-for-unset-optional
 *   reality the same tolerance `network-drift.ts`/`firewall-zone-form.ts` rely on — see
 *   `dns-policy-form.ts`'s own header for why no field here needs a set/order normalizer.
 */
import type * as dnsPolicies from '@distilled.cloud/unifi-network/dns_policies';
import { makeDriftOf } from './drift.ts';
import { type DnsPolicyAttributes, type DnsPolicyProps, attributesOf } from './dns-policy-form.ts';

const fieldDrift = makeDriftOf<DnsPolicyAttributes, DnsPolicyProps>([
  { field: 'enabled', live: (a) => a.enabled, declared: (p) => p.enabled },
  { field: 'type', live: (a) => a.type, declared: (p) => p.type },
  { field: 'domain', live: (a) => a.domain, declared: (p) => p.domain },
  { field: 'ipv6Address', live: (a) => a.ipv6Address, declared: (p) => p.ipv6Address },
  { field: 'ttlSeconds', live: (a) => a.ttlSeconds, declared: (p) => p.ttlSeconds },
  { field: 'ipv4Address', live: (a) => a.ipv4Address, declared: (p) => p.ipv4Address },
  { field: 'targetDomain', live: (a) => a.targetDomain, declared: (p) => p.targetDomain },
  { field: 'ipAddress', live: (a) => a.ipAddress, declared: (p) => p.ipAddress },
  {
    field: 'mailServerDomain',
    live: (a) => a.mailServerDomain,
    declared: (p) => p.mailServerDomain,
  },
  { field: 'priority', live: (a) => a.priority, declared: (p) => p.priority },
  { field: 'port', live: (a) => a.port, declared: (p) => p.port },
  { field: 'protocol', live: (a) => a.protocol, declared: (p) => p.protocol },
  { field: 'serverDomain', live: (a) => a.serverDomain, declared: (p) => p.serverDomain },
  { field: 'service', live: (a) => a.service, declared: (p) => p.service },
  { field: 'weight', live: (a) => a.weight, declared: (p) => p.weight },
  { field: 'text', live: (a) => a.text, declared: (p) => p.text },
]);

export const matches = (attributes: DnsPolicyAttributes, props: DnsPolicyProps): boolean =>
  fieldDrift(attributes, props).length === 0;

/**
 * Per-field live-vs-declared drift straight from one live read — the task's own API
 * (`driftOf(live, props)`), so `homeflare-network`'s pre-import drift check never has to derive
 * `attributesOf` itself just to call this.
 */
export const driftOf = (live: dnsPolicies.DNSPolicy, props: DnsPolicyProps) =>
  fieldDrift(attributesOf(live, props), props);
