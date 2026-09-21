/**
 * Bao.PkiRole's canonical form — the managed field set, normalised so both sides of a diff are
 * byte-comparable. Split from pki-role-form.ts for the 250-line cap when six fields were added
 * (2026-09-21); the reasoning below moved with the code, unchanged.
 *
 * ★ THE SIX FIELDS ADDED 2026-09-21 — require_cn, enforce_hostnames, key_usage,
 *   allowed_domains_template, no_store, generate_lease — WERE ALREADY BEING WRITTEN, just never
 *   declared. The role write is a full replace (pki-role.ts), and openbao v2.6.2
 *   builtin/logical/pki/path_roles.go pathRoleCreate (:1153-1196) builds each of them from
 *   `data.Get`, i.e. its schema default when the request omits it. So every write this resource
 *   ever made reset them — a hand-set `no_store` or a narrowed `key_usage` vanished behind a
 *   green plan. Their defaults below are OpenBao's own (schema :560-575, :690-720, :800-845), so a
 *   role this resource wrote reads back unchanged and plans `noop`.
 */
import { sha256 } from './digest.ts';
import { parseDuration, ttlSeconds } from './mount-form.ts';
import type { BaoPkiRoleProps } from './pki-role-form.ts';

/**
 * The managed field set, normalised so both sides of a diff are byte-comparable.
 *
 * ⚠️ KEY ORDER IS THE DIGEST. The props side and the live side are both built by the single
 *   canonical() literal below, so `JSON.stringify` emits the same key order for each. Two
 *   hand-written object literals would drift apart and produce a forever-diff nobody could
 *   read from the plan output.
 */
export interface BaoPkiRoleCanonical {
  allowBareDomains: boolean;
  allowGlobDomains: boolean;
  allowIpSans: boolean;
  allowLocalhost: boolean;
  allowSubdomains: boolean;
  allowWildcardCertificates: boolean;
  allowedDomains: readonly string[];
  allowedDomainsTemplate: boolean;
  clientFlag: boolean;
  cnValidations: readonly string[];
  enforceHostnames: boolean;
  extKeyUsage: readonly string[];
  generateLease: boolean;
  keyBits: number;
  keyType: string;
  keyUsage: readonly string[];
  /** ⚠️ `-1` means the duration prop did not parse — reconcile refuses rather than writing it. */
  maxTtlSeconds: number;
  noStore: boolean;
  requireCn: boolean;
  serverFlag: boolean;
  signatureBits: number;
  ttlSeconds: number;
}

/** ★ OpenBao's own `key_usage` default (path_roles.go:697-698) — what an omitted field becomes. */
export const DEFAULT_KEY_USAGE: readonly string[] = [
  'DigitalSignature',
  'KeyAgreement',
  'KeyEncipherment',
];

const sorted = (values: readonly string[]) => [...values].sort();

/** ⚠️ Case-folded for the COMPARE only; the write keeps the author's casing.
 *   Why, and what was never measured, is in the pki-role.ts header. `key_usage` gets the same
 *   treatment as `ext_key_usage`, for the same reason — REASONED, not measured. */
const foldedUsages = (values: readonly string[]) => sorted(values.map((v) => v.toLowerCase()));

/** The one literal that fixes key order for both sides of the diff. */
const canonical = (input: BaoPkiRoleCanonical): BaoPkiRoleCanonical => ({
  allowBareDomains: input.allowBareDomains,
  allowGlobDomains: input.allowGlobDomains,
  allowIpSans: input.allowIpSans,
  allowLocalhost: input.allowLocalhost,
  allowSubdomains: input.allowSubdomains,
  allowWildcardCertificates: input.allowWildcardCertificates,
  allowedDomains: sorted(input.allowedDomains),
  allowedDomainsTemplate: input.allowedDomainsTemplate,
  clientFlag: input.clientFlag,
  cnValidations: sorted(input.cnValidations),
  enforceHostnames: input.enforceHostnames,
  extKeyUsage: foldedUsages(input.extKeyUsage),
  generateLease: input.generateLease,
  keyBits: input.keyBits,
  keyType: input.keyType,
  keyUsage: foldedUsages(input.keyUsage),
  maxTtlSeconds: input.maxTtlSeconds,
  noStore: input.noStore,
  requireCn: input.requireCn,
  serverFlag: input.serverFlag,
  signatureBits: input.signatureBits,
  ttlSeconds: input.ttlSeconds,
});

const seconds = (text: string) => parseDuration(text) ?? -1;

export const canonicalFromProps = (props: BaoPkiRoleProps): BaoPkiRoleCanonical =>
  canonical({
    allowBareDomains: props.allowBareDomains ?? false,
    allowGlobDomains: props.allowGlobDomains ?? false,
    allowIpSans: props.allowIpSans ?? false,
    allowLocalhost: props.allowLocalhost ?? false,
    allowSubdomains: props.allowSubdomains ?? false,
    allowWildcardCertificates: props.allowWildcardCertificates ?? false,
    allowedDomains: props.allowedDomains,
    allowedDomainsTemplate: props.allowedDomainsTemplate ?? false,
    clientFlag: props.clientFlag ?? true,
    cnValidations: props.cnValidations ?? ['hostname'],
    enforceHostnames: props.enforceHostnames ?? true,
    extKeyUsage: props.extKeyUsage ?? [],
    generateLease: props.generateLease ?? false,
    keyBits: props.keyBits ?? 0,
    keyType: props.keyType ?? 'rsa',
    keyUsage: props.keyUsage ?? DEFAULT_KEY_USAGE,
    maxTtlSeconds: seconds(props.maxTtl),
    noStore: props.noStore ?? false,
    requireCn: props.requireCn ?? true,
    serverFlag: props.serverFlag ?? true,
    signatureBits: props.signatureBits ?? 0,
    ttlSeconds: seconds(props.ttl),
  });

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const int = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const list = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

/**
 * ⚠️ AN ABSENT NEW FIELD READS AS ITS ZERO VALUE, NOT ITS SCHEMA DEFAULT. A role read always carries
 *   the six new fields (ToResponseData, path_roles.go:1720-1780; `generate_lease` only when set,
 *   and getRole upgrades a missing one to false at :1034), so the fallback only answers a body
 *   that is not OpenBao's — and then "false"/"none" reads as drift rather than a false noop.
 */
export const canonicalFromLive = (live: Record<string, unknown>): BaoPkiRoleCanonical =>
  canonical({
    allowBareDomains: bool(live['allow_bare_domains'], false),
    allowGlobDomains: bool(live['allow_glob_domains'], false),
    allowIpSans: bool(live['allow_ip_sans'], false),
    allowLocalhost: bool(live['allow_localhost'], false),
    allowSubdomains: bool(live['allow_subdomains'], false),
    allowWildcardCertificates: bool(live['allow_wildcard_certificates'], false),
    allowedDomains: list(live['allowed_domains']),
    allowedDomainsTemplate: bool(live['allowed_domains_template'], false),
    clientFlag: bool(live['client_flag'], true),
    cnValidations: list(live['cn_validations']),
    enforceHostnames: bool(live['enforce_hostnames'], false),
    extKeyUsage: list(live['ext_key_usage']),
    generateLease: bool(live['generate_lease'], false),
    keyBits: int(live['key_bits'], 0),
    keyType: str(live['key_type'], 'rsa'),
    keyUsage: list(live['key_usage']),
    maxTtlSeconds: ttlSeconds(live['max_ttl']) ?? -1,
    noStore: bool(live['no_store'], false),
    requireCn: bool(live['require_cn'], false),
    serverFlag: bool(live['server_flag'], true),
    signatureBits: int(live['signature_bits'], 0),
    ttlSeconds: ttlSeconds(live['ttl']) ?? -1,
  });

export const digestOf = (form: BaoPkiRoleCanonical): string => sha256(JSON.stringify(form));
