import { mountPath, parseDuration } from './mount-form.ts';
import {
  type BaoPkiRoleCanonical,
  DEFAULT_KEY_USAGE,
  canonicalFromLive,
  canonicalFromProps,
  digestOf,
} from './pki-role-canonical.ts';

export type { BaoPkiRoleCanonical };

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
  /**
   * ★ THE SIX BELOW (added 2026-09-21) default to OpenBao's OWN values, not closed ones — a role this
   *   resource wrote before they were props carries exactly those, so it still plans `noop`. The
   *   write already sent them implicitly; see the header of pki-role-canonical.ts.
   */
  /** A request must carry a common_name. Default true. */
  requireCn?: boolean;
  /** Only valid host names in the CN and DNS SANs. Default true. */
  enforceHostnames?: boolean;
  /**
   * Key usages minus the `KeyUsage` prefix. Default `DigitalSignature, KeyAgreement,
   * KeyEncipherment`. ⚠️ `[]` is a real value — it removes every key usage — and is sent as such.
   */
  keyUsage?: readonly string[];
  /** Allowed domains may use identity templates (`{{identity.entity.name}}`). Default false. */
  allowedDomainsTemplate?: boolean;
  /**
   * Do not store issued certificates. Default false. ⛔ They can then be neither listed nor
   *   revoked. ⚠️ Implies `generateLease: false`; declaring both true is refused (see problems).
   */
  noStore?: boolean;
  /** Attach an OpenBao lease to every issued certificate. Default false — leases slow startup. */
  generateLease?: boolean;
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

/** ⚠️ Same rendering auth-role-form.ts uses, so `720h` and `2592000` read alike in a plan. */
const ttlText = (value: number) => {
  if (value < 0) return '';
  if (value !== 0 && value % 86400 === 0) return `${String(value / 86400)}d`;
  if (value !== 0 && value % 3600 === 0) return `${String(value / 3600)}h`;
  if (value !== 0 && value % 60 === 0) return `${String(value / 60)}m`;
  return `${String(value)}s`;
};

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
 * ⚠️ `key_usage` CANNOT BE OMITTED THAT WAY — its default is NOT empty — so it is always sent, and
 *   an empty declaration goes over as `""`. That encoding is now READ, not guessed: for a
 *   comma-string-slice field, go-secure-stdlib parseutil.ParseCommaStringSlice (:389-392)
 *   answers `""` with an empty list.
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
    require_cn: String(form.requireCn),
    enforce_hostnames: String(form.enforceHostnames),
    key_usage: (props.keyUsage ?? DEFAULT_KEY_USAGE).join(','),
    allowed_domains_template: String(form.allowedDomainsTemplate),
    no_store: String(form.noStore),
    generate_lease: String(form.generateLease),
  };
  const usages = props.extKeyUsage ?? [];
  if (usages.length > 0) body['ext_key_usage'] = usages.join(',');
  return body;
};

/** True when live already matches the declaration on every managed field. */
export const matches = (attributes: BaoPkiRoleAttributes, props: BaoPkiRoleProps) =>
  attributes.digest === digestOf(canonicalFromProps(props));

/**
 * Declarations reconcile must refuse rather than write. diff routes any of these to `update` so the
 * refusal is seen on the next deploy, never hidden behind a `noop`.
 *
 * ⚠️ `noStore` WITH `generateLease` IS NOT AN ERROR ON THE SERVER — pathRoleCreate stores
 *   generate_lease false and adds a warning (path_roles.go:1250-1256) — so the role would read back
 *   different from its declaration and plan `update` forever. Refused here instead.
 */
export const problems = (props: BaoPkiRoleProps): readonly string[] => {
  const found: string[] = [];
  if (props.allowedDomains.length === 0) {
    found.push(
      'allowedDomains is empty. With allow_any_name false that role can issue no certificate at all.',
    );
  }
  const bad = [
    ['ttl', props.ttl],
    ['maxTtl', props.maxTtl],
  ].filter(([, text]) => parseDuration(text ?? '') === undefined);
  if (bad.length > 0) {
    found.push(
      `${bad.map(([k, v]) => `${k ?? ''}=${v ?? ''}`).join(', ')} is not a duration OpenBao ` +
        'parses (expect 30m, 720h, 8760h or 0).',
    );
  }
  if (props.noStore === true && props.generateLease === true) {
    found.push(
      'noStore and generateLease are both true; OpenBao keeps no_store and drops the lease.',
    );
  }
  return found;
};
