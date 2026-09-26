/**
 * `Unifi.DnsPolicy`'s wire shape — the declarable subset of `DNSPolicy`, and how a live read
 * becomes both plan attributes and a rendered declaration.
 *
 * ★ ONE FLAT DTO FOR EVERY DNS RECORD `type` (`A_RECORD`/`AAAA_RECORD`/`CNAME_RECORD`/
 *   `FORWARD_DOMAIN`/`MX_RECORD`/`SRV_RECORD`/`TXT_RECORD` — the pinned spec's `DNS policy` schema
 *   DOES discriminate on `type`, via `discriminator.mapping` to 7 variant DTOs; see
 *   `docs/unifi-dns-policy.md`'s "One flat DTO" section, corrected 2026-09-26). Unlike
 *   `access_control_acl_rules.ts`'s `sourceFilter`/`destinationFilter` or `firewall.ts`'s policy
 *   filters, NONE of `dns_policies.ts`'s fields were widened to `unknown` by the converter (T10) —
 *   `scripts/convert.ts` flattens the 7 variants into one struct instead, because no two variants
 *   collide on a field name, so every optional field still decodes as a plain scalar and there is
 *   no discriminated-variant trap here to flag or defer past this PR.
 *
 * ⚠️ PROPS MIRROR `UpdateDnsPolicyRequest`, NOT `DNSPolicy` — same split `network-form.ts` and
 *   `firewall-zone-form.ts` both use. `id` and `metadata` are server-derived (no writable field
 *   accepts either), so they are attributes-only, reported but never compared or declared.
 *   Everything else in `DnsPolicyProps` is exactly what `updateDnsPolicy`/`createDnsPolicy` would
 *   accept, even though this family never calls either.
 *
 * ⛔ NO ARRAY FIELD ANYWHERE IN THIS SHAPE. Every field below is a scalar (`string`/`number`/
 *   `boolean`), so none of `network-form.ts`'s/`firewall-zone-form.ts`'s `sortedSet` normalizing
 *   is needed — `deepEqual`'s default `stripNullish` handling (`drift.ts`) is the whole story.
 */
import type * as dnsPolicies from '@distilled.cloud/unifi-network/dns_policies';

/**
 * ⚠️ EVERY OPTIONAL FIELD SPELLS OUT `| undefined` ON PURPOSE (`exactOptionalPropertyTypes` —
 *   see `network-form.ts`'s own header for why `declareDnsPolicy` below needs it: it assigns a
 *   live optional field straight through, so the target type must admit an explicit `undefined`,
 *   not just omission).
 */
export interface DnsPolicyProps {
  siteId: string;
  dnsPolicyId: string;
  enabled: boolean;
  /** DNS record type: `A_RECORD`, `AAAA_RECORD`, `CNAME_RECORD`, `FORWARD_DOMAIN`, `MX_RECORD`,
   *  `SRV_RECORD` or `TXT_RECORD` (the discriminator's own mapping keys, see the header). */
  type: string;
  domain?: string | undefined;
  ipv6Address?: string | undefined;
  /** Time to live in seconds. */
  ttlSeconds?: number | undefined;
  ipv4Address?: string | undefined;
  targetDomain?: string | undefined;
  /** IP address of the DNS Server that the DNS query is forwarded to. */
  ipAddress?: string | undefined;
  mailServerDomain?: string | undefined;
  /** Priority. A lower number is preferred. */
  priority?: number | undefined;
  port?: number | undefined;
  /** Protocol used by the service. */
  protocol?: string | undefined;
  /** Domain of the server that is running the service. */
  serverDomain?: string | undefined;
  /** Service associated with this SRV record. */
  service?: string | undefined;
  /** Weight. A relative value applicable for records with the same priority. A lower number is
   *  preferred. */
  weight?: number | undefined;
  /** The text value associated with this TXT DNS record. Text can contain up to four
   *  255-character strings. Lines containing commas must be enclosed in double quotes ("). */
  text?: string | undefined;
}

export interface DnsPolicyAttributes {
  siteId: string;
  dnsPolicyId: string;
  enabled: boolean;
  type: string;
  domain: string | undefined;
  ipv6Address: string | undefined;
  ttlSeconds: number | undefined;
  ipv4Address: string | undefined;
  targetDomain: string | undefined;
  ipAddress: string | undefined;
  mailServerDomain: string | undefined;
  priority: number | undefined;
  port: number | undefined;
  protocol: string | undefined;
  serverDomain: string | undefined;
  service: string | undefined;
  weight: number | undefined;
  text: string | undefined;
  /** `metadata.origin` (e.g. `USER`) — server-derived, never declared; see
   *  `firewall-zone-form.ts`'s own `metadataOrigin` for the same split. */
  metadataOrigin: string;
}

export const attributesOf = (
  live: dnsPolicies.DNSPolicy,
  props: DnsPolicyProps,
): DnsPolicyAttributes => ({
  siteId: props.siteId,
  dnsPolicyId: live.id,
  enabled: live.enabled,
  type: live.type,
  domain: live.domain,
  ipv6Address: live.ipv6Address,
  ttlSeconds: live.ttlSeconds,
  ipv4Address: live.ipv4Address,
  targetDomain: live.targetDomain,
  ipAddress: live.ipAddress,
  mailServerDomain: live.mailServerDomain,
  priority: live.priority,
  port: live.port,
  protocol: live.protocol,
  serverDomain: live.serverDomain,
  service: live.service,
  weight: live.weight,
  text: live.text,
  metadataOrigin: live.metadata.origin,
});

/**
 * The declaration renderer (task spec: "given one live object, return the props a declaration
 * needs so its plan is noop"). A later import script feeds `getDnsPolicy`'s own response straight
 * in and writes the result into `alchemy.run.ts` as `dnsPolicy('<id>', declareDnsPolicy(live,
 * siteId))` — no field is invented or defaulted here beyond what `attributesOf` already reports,
 * so `matches(attributesOf(live, props), declareDnsPolicy(live, siteId))` is `true` by
 * construction (`dns-policy.test.ts` proves it) for any live object this SDK can decode.
 */
export const declareDnsPolicy = (live: dnsPolicies.DNSPolicy, siteId: string): DnsPolicyProps => ({
  siteId,
  dnsPolicyId: live.id,
  enabled: live.enabled,
  type: live.type,
  domain: live.domain,
  ipv6Address: live.ipv6Address,
  ttlSeconds: live.ttlSeconds,
  ipv4Address: live.ipv4Address,
  targetDomain: live.targetDomain,
  ipAddress: live.ipAddress,
  mailServerDomain: live.mailServerDomain,
  priority: live.priority,
  port: live.port,
  protocol: live.protocol,
  serverDomain: live.serverDomain,
  service: live.service,
  weight: live.weight,
  text: live.text,
});
