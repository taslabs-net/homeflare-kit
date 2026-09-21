/**
 * Read PINNED values by key. Nothing here is computed; it only refuses unknown keys.
 *
 * ⛔ WHY THESE ARE NOT DERIVED — each is a replace or an outage if it ever follows a rule:
 *   - `names`: Workers, D1, KV, R2 and Durable Object names follow no rule, and a derived
 *     D1 name REPLACES the database, deleting its data.
 *   - `certificates`: hostnames on an adopted certificate. A change reissues it and revokes
 *     the one a host is still serving.
 *   - `adopted`: ids and names of objects that already exist (an LB pool, a WAF ruleset,
 *     Ceph and PBS names, PKI common names). Rendering one from a rule means a new object.
 *   - `policies` and `sshPrincipals`: explicit lists. A break-glass principal must never
 *     vanish because a network leg was renamed; `unknownPrincipals` checks them against
 *     the inventory instead of generating them from it.
 */
import { lookup } from './errors.ts';
import type { Site } from './schema.ts';

export interface Pins {
  /** A physical resource name, e.g. `pins.name('alerts.d1')`. */
  name(key: string): string;
  /** The hostnames on an adopted certificate. */
  certificate(key: string): readonly string[];
  /** An adopted object's id or name. */
  adopted(key: string): string;
  /** A policy list (emails, groups, CIDRs — whatever the enforcing repo reads). */
  policy(key: string): readonly string[];
  /** An SSH principal list. */
  principals(key: string): readonly string[];
}

export function pins(site: Site): Pins {
  const { pinned } = site;
  return {
    name: (key) => lookup('pinned name', pinned.names, key),
    certificate: (key) => lookup('pinned certificate', pinned.certificates, key),
    adopted: (key) => lookup('adopted id', pinned.adopted, key),
    policy: (key) => lookup('pinned policy list', pinned.policies, key),
    principals: (key) => lookup('pinned principal list', pinned.sshPrincipals, key),
  };
}
