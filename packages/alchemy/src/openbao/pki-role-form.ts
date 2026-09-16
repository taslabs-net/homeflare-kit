import { sha256 } from './digest.ts';
import { mountPath, parseDuration, ttlSeconds } from './mount-form.ts';

/** ★ MEASURED: the OpenAPI enum for `key_type` is exactly these four, lowercase. */
export type BaoPkiKeyType = 'any' | 'ec' | 'ed25519' | 'rsa';

/** ★ MEASURED: live roles carry `["hostname"]` or the default `["email","hostname"]`. */
export type BaoPkiCnValidation = 'disabled' | 'email' | 'hostname';

export interface BaoPkiRoleProps {
  /** Role name, as `pki/roles/{name}` takes it. */
  name: string;
  /** Mount holding the engine. Defaults to `pki` — the only PKI mount live today. */
  mount?: string;
  /**
   * Domains this role may issue for.
   *
   * ⛔ AN EMPTY LIST IS REFUSED IN reconcile, NOT WRITTEN. With `allow_any_name` false — the
   *   default, and what all eight live roles use — a role with no allowed domains can issue
   *   nothing, so a mistyped or unresolved prop would quietly brick every renewal under it.
   */
  allowedDomains: readonly string[];
  /** Permit `foo.<allowed domain>`. Default false. */
  allowSubdomains?: boolean;
  /** Permit the allowed domain itself as the CN. Default false. */
  allowBareDomains?: boolean;
  /** Treat `*` inside an allowed domain as a glob. Default false. */
  allowGlobDomains?: boolean;
  /**
   * Default certificate lifetime, as a duration string (`720h`).
   *
   * ⚠️ WRITTEN AS A DURATION, READ BACK AS SECONDS — `ttl` and `max_ttl` both carry
   *   `format: seconds` in the OpenAPI and come back as integers (`2592000`). The prop
   *   string reaches `bao write` verbatim; the compare happens in seconds. See canonical().
   */
  ttl: string;
  /** Ceiling on a requested lifetime, as a duration string (`8760h`). */
  maxTtl: string;
  /** Key algorithm. Default `rsa` — OpenBao's own default. */
  keyType?: BaoPkiKeyType;
  /** Key size; `0` means "engine default for keyType". rsa 2048/3072/4096, ec 224/256/384/521. */
  keyBits?: number;
  /** Flag certificates for TLS server auth. ⚠️ OpenBao defaults this TRUE. */
  serverFlag?: boolean;
  /** Flag certificates for TLS client auth. ⚠️ OpenBao defaults this TRUE. */
  clientFlag?: boolean;
  /** Extended key usages minus the `ExtKeyUsage` prefix (`ServerAuth`). Empty on all 8 live roles. */
  extKeyUsage?: readonly string[];
  /** Permit IP SANs. ⚠️ OpenBao defaults TRUE; this resource defaults FALSE — see pki-role.ts. */
  allowIpSans?: boolean;
  /** Permit `localhost`/`localdomain` CNs. ⚠️ OpenBao TRUE, this resource FALSE. */
  allowLocalhost?: boolean;
  /** Permit wildcard CNs. ⚠️ OpenBao TRUE, this resource FALSE. */
  allowWildcardCertificates?: boolean;
  /** CN validations to run. ⚠️ OpenBao `["email","hostname"]`, this resource `["hostname"]`. */
  cnValidations?: readonly BaoPkiCnValidation[];
  /** Signature hash bits; `0` auto-detects from key length. One live role pins 256. */
  signatureBits?: number;
}

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
  clientFlag: boolean;
  cnValidations: readonly string[];
  extKeyUsage: readonly string[];
  keyBits: number;
  keyType: string;
  /** ⚠️ `-1` means the duration prop did not parse — reconcile refuses rather than writing it. */
  maxTtlSeconds: number;
  serverFlag: boolean;
  signatureBits: number;
  ttlSeconds: number;
}

export interface BaoPkiRoleAttributes extends BaoPkiRoleCanonical {
  name: string;
  mount: string;
  /** Human rendering of ttlSeconds — the compare uses the seconds, this is for the plan. */
  ttl: string;
  maxTtl: string;
  /** SHA-256 of the canonical form — safe to persist; see policy.ts. */
  digest: string;
}

const sorted = (values: readonly string[]) => [...values].sort();

/** ⚠️ Case-folded for the COMPARE only; the write keeps the author's casing.
 *   Why, and what was never measured, is in the pki-role.ts header. */
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
  clientFlag: input.clientFlag,
  cnValidations: sorted(input.cnValidations),
  extKeyUsage: foldedUsages(input.extKeyUsage),
  keyBits: input.keyBits,
  keyType: input.keyType,
  maxTtlSeconds: input.maxTtlSeconds,
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
    clientFlag: props.clientFlag ?? true,
    cnValidations: props.cnValidations ?? ['hostname'],
    extKeyUsage: props.extKeyUsage ?? [],
    keyBits: props.keyBits ?? 0,
    keyType: props.keyType ?? 'rsa',
    maxTtlSeconds: seconds(props.maxTtl),
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

export const canonicalFromLive = (live: Record<string, unknown>): BaoPkiRoleCanonical =>
  canonical({
    allowBareDomains: bool(live['allow_bare_domains'], false),
    allowGlobDomains: bool(live['allow_glob_domains'], false),
    allowIpSans: bool(live['allow_ip_sans'], false),
    allowLocalhost: bool(live['allow_localhost'], false),
    allowSubdomains: bool(live['allow_subdomains'], false),
    allowWildcardCertificates: bool(live['allow_wildcard_certificates'], false),
    allowedDomains: list(live['allowed_domains']),
    clientFlag: bool(live['client_flag'], true),
    cnValidations: list(live['cn_validations']),
    extKeyUsage: list(live['ext_key_usage']),
    keyBits: int(live['key_bits'], 0),
    keyType: str(live['key_type'], 'rsa'),
    maxTtlSeconds: ttlSeconds(live['max_ttl']) ?? -1,
    serverFlag: bool(live['server_flag'], true),
    signatureBits: int(live['signature_bits'], 0),
    ttlSeconds: ttlSeconds(live['ttl']) ?? -1,
  });

/** ⚠️ Same rendering auth-role-form.ts uses, so `720h` and `2592000` read alike in a plan. */
const ttlText = (value: number) => {
  if (value < 0) return '';
  if (value !== 0 && value % 86400 === 0) return `${String(value / 86400)}d`;
  if (value !== 0 && value % 3600 === 0) return `${String(value / 3600)}h`;
  if (value !== 0 && value % 60 === 0) return `${String(value / 60)}m`;
  return `${String(value)}s`;
};

export const digestOf = (form: BaoPkiRoleCanonical) => sha256(JSON.stringify(form));

export const rolePath = (props: { name: string; mount?: string }) =>
  `${mountPath(props.mount ?? 'pki')}/roles/${props.name}`;

export const attributesOf = (
  props: BaoPkiRoleProps,
  live: Record<string, unknown>,
): BaoPkiRoleAttributes => {
  const form = canonicalFromLive(live);
  return {
    ...form,
    name: props.name,
    mount: mountPath(props.mount ?? 'pki'),
    ttl: ttlText(form.ttlSeconds),
    maxTtl: ttlText(form.maxTtlSeconds),
    digest: digestOf(form),
  };
};

/**
 * ⚠️ ARRAYS GO OVER AS COMMA-JOINED STRINGS. `allowed_domains` and `ext_key_usage` are
 *   documented as "a comma-separated string or list"; `cn_validations` is not, so its
 *   splitting is REASONED, not measured. reconcile re-reads and re-compares after every
 *   write, so a value that arrived unsplit fails loudly instead of landing wrong.
 *
 * ⚠️ TTLs GO OVER AS THE AUTHOR'S OWN DURATION STRING, never as a re-rendered one — so this
 *   never has to know whether OpenBao's parser accepts the `d` suffix ttlText() produces for
 *   display. Rendering is for humans; the wire only ever sees what was declared.
 *
 * ★ `ext_key_usage` is OMITTED when empty rather than sent as `ext_key_usage=`. The write
 *   replaces the whole role, so an absent field already lands on the `[]` default, and
 *   omitting sidesteps how an empty value would be encoded.
 *
 * ★ THE BODY FOR `PUT <mount>/roles/<name>`, ALL STRINGS — the same `k=v` pairs `bao write` sent.
 */
export const writeBody = (props: BaoPkiRoleProps): Record<string, string> => {
  const form = canonicalFromProps(props);
  const body: Record<string, string> = {
    allowed_domains: form.allowedDomains.join(','),
    allow_bare_domains: String(form.allowBareDomains),
    allow_glob_domains: String(form.allowGlobDomains),
    allow_subdomains: String(form.allowSubdomains),
    allow_ip_sans: String(form.allowIpSans),
    allow_localhost: String(form.allowLocalhost),
    allow_wildcard_certificates: String(form.allowWildcardCertificates),
    cn_validations: form.cnValidations.join(','),
    client_flag: String(form.clientFlag),
    server_flag: String(form.serverFlag),
    key_type: form.keyType,
    key_bits: String(form.keyBits),
    signature_bits: String(form.signatureBits),
    ttl: props.ttl,
    max_ttl: props.maxTtl,
  };
  const usages = props.extKeyUsage ?? [];
  if (usages.length > 0) body['ext_key_usage'] = usages.join(',');
  return body;
};

/** True when live already matches the declaration on every managed field. */
export const matches = (attributes: BaoPkiRoleAttributes, props: BaoPkiRoleProps) =>
  attributes.digest === digestOf(canonicalFromProps(props));
