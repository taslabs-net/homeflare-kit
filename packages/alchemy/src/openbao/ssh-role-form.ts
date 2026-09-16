/**
 * The wire-and-form half of Bao.SshRole: normalisation, argv, and the equality that decides
 * whether a plan says `noop`. Split from ssh-role.ts for the 250-line cap.
 *
 * ⚠️ EVERY FIELD TYPE BELOW WAS MEASURED, not assumed — OpenBao v2.6.2, read from the live
 *   engine's own `sys/internal/specs/openapi`, schema `SshWriteRoleRequest`:
 *     `allowed_users`, `allowed_extensions`, `allowed_critical_options`, `allowed_domains`
 *         → `string`. ONE COMMA-SEPARATED STRING. Not a list, however much it reads like one.
 *     `default_extensions`, `default_critical_options`, `allowed_user_key_lengths`
 *         → `object`, `format: map`.
 *     `ttl`, `max_ttl`, `not_before_duration` → `integer`, SECONDS.
 *   A role read echoes exactly those types back, which is why csvList and extMap exist.
 */
import { sha256 } from './digest.ts';
import { parseDuration, ttlSeconds } from './mount-form.ts';

export interface BaoSshRoleProps {
  /** Role name, as `<mount>/roles/{name}` takes it. */
  name: string;
  /** Secrets engine mount, no trailing slash. Defaults to `ssh`; `ssh-host` also exists. */
  mount?: string;
  /** Principals a certificate may carry. `['*']` is OpenBao's wildcard. */
  allowedUsers: readonly string[];
  /** Principal used when a sign request does not name one. */
  defaultUser?: string;
  /** Sign user certificates. Defaults to false — OpenBao's own default. */
  allowUserCertificates?: boolean;
  /** Sign host certificates. Defaults to false — OpenBao's own default. */
  allowHostCertificates?: boolean;
  /** Host-cert roles only: the domains a host certificate may claim. */
  allowedDomains?: readonly string[];
  /** Host-cert roles only: allow `host.example.com` under an allowed `example.com`. */
  allowSubdomains?: boolean;
  /** Host-cert roles only: allow the bare allowed domain itself. */
  allowBareDomains?: boolean;
  /**
   * Extensions a REQUESTER may ask for — not the ones that get stamped on. `[]` means none
   * may be requested, which is what all three live roles carry; `['*']` allows any.
   */
  allowedExtensions?: readonly string[];
  /** Extensions stamped on every certificate, e.g. `{ 'permit-pty': '' }`. */
  defaultExtensions?: Readonly<Record<string, string>>;
  /** Critical options a requester may ask for — `force-command`, `source-address`. */
  allowedCriticalOptions?: readonly string[];
  /** Critical options stamped on every certificate. See the ⛔ on erasure in ssh-role.ts. */
  defaultCriticalOptions?: Readonly<Record<string, string>>;
  /** ⛔ Skeleton-key flag — read the ⛔ in ssh-role.ts before setting this true. */
  allowEmptyPrincipals?: boolean;
  /** Certificate lifetime, e.g. `4h`. ⛔ `0` is NOT "no expiry" — see ssh-role.ts. */
  ttl: string;
  /** Ceiling on a requested lifetime, e.g. `8h`. */
  maxTtl: string;
}

/**
 * Every prop resolved to the value the full-replace write will actually produce.
 *
 * ★ Derived rather than retyped: `Required` is the whole difference between the two, and a
 *   hand-copied twin is the kind of thing that silently loses a field in review.
 */
export type BaoSshRoleForm = Required<BaoSshRoleProps>;

/** ⛔ NO SECRET HERE — names, flags, TTLs and a digest. The CA key is out of scope. */
export interface BaoSshRoleAttributes extends Omit<BaoSshRoleForm, 'maxTtl' | 'ttl'> {
  /**
   * ⚠️ SECONDS, NOT A DURATION STRING. OpenBao stores seconds and a plan should show what is
   *   stored; `4h` in the props and 14400 here are the same role. Rendering seconds back
   *   into `4h` needs a table of unit rules that mount-form.ts and auth-role-form.ts each
   *   already carry a private copy of — a third copy is how the three drift apart.
   */
  ttlSeconds: number;
  maxTtlSeconds: number;
  /** Always `ca` on a healthy role. Stored so an otp/dynamic role reads as a mismatch. */
  keyType: string;
  /** SHA-256 of the managed fields — safe to persist; see policy.ts. */
  digest: string;
}

/** Mount path without a trailing slash; `ssh` when the caller did not say. */
export const mountOf = (mount: string | undefined) => (mount ?? 'ssh').replace(/\/+$/, '');

export const readPath = (mount: string | undefined, name: string) =>
  `${mountOf(mount)}/roles/${name}`;

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

/**
 * ⚠️ SETS, NOT SEQUENCES. OpenBao stores these as one comma-separated string and promises
 *   nothing about the order it hands back. Sorting and de-duplicating on BOTH sides is what
 *   stops every plan from reporting an update on a role nobody touched.
 */
export const csvList = (value: unknown): readonly string[] => {
  const parts = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : text(value).split(',');
  return [
    ...new Set(parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  ].sort();
};

/**
 * ⚠️ A MAP WITH NO PROMISED ORDER. Key order also decides the digest and the argv, so it is
 *   normalised once here and everything else reads the sorted copy.
 */
export const extMap = (value: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out;
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source).sort()) out[key] = text(source[key]);
  return out;
};

/** ⛔ Every default here is what the WRITE produces, not what felt sensible. */
export const resolve = (props: BaoSshRoleProps): BaoSshRoleForm => ({
  name: props.name,
  mount: mountOf(props.mount),
  allowedUsers: csvList(props.allowedUsers),
  defaultUser: props.defaultUser ?? '',
  allowUserCertificates: props.allowUserCertificates ?? false,
  allowHostCertificates: props.allowHostCertificates ?? false,
  allowedDomains: csvList(props.allowedDomains),
  allowSubdomains: props.allowSubdomains ?? false,
  allowBareDomains: props.allowBareDomains ?? false,
  allowedExtensions: csvList(props.allowedExtensions),
  defaultExtensions: extMap(props.defaultExtensions ?? {}),
  allowedCriticalOptions: csvList(props.allowedCriticalOptions),
  defaultCriticalOptions: extMap(props.defaultCriticalOptions ?? {}),
  allowEmptyPrincipals: props.allowEmptyPrincipals ?? false,
  ttl: props.ttl,
  maxTtl: props.maxTtl,
});

export const attributesOf = (
  form: BaoSshRoleForm,
  live: Record<string, unknown>,
): BaoSshRoleAttributes => {
  const attrs = {
    name: form.name,
    mount: form.mount,
    allowedUsers: csvList(live['allowed_users']),
    defaultUser: text(live['default_user']),
    allowUserCertificates: bool(live['allow_user_certificates'], false),
    allowHostCertificates: bool(live['allow_host_certificates'], false),
    allowedDomains: csvList(live['allowed_domains']),
    allowSubdomains: bool(live['allow_subdomains'], false),
    allowBareDomains: bool(live['allow_bare_domains'], false),
    allowedExtensions: csvList(live['allowed_extensions']),
    defaultExtensions: extMap(live['default_extensions']),
    allowedCriticalOptions: csvList(live['allowed_critical_options']),
    defaultCriticalOptions: extMap(live['default_critical_options']),
    allowEmptyPrincipals: bool(live['allow_empty_principals'], false),
    keyType: text(live['key_type']) || 'ca',
    ttlSeconds: ttlSeconds(live['ttl']) ?? 0,
    maxTtlSeconds: ttlSeconds(live['max_ttl']) ?? 0,
  };
  return { ...attrs, digest: sha256(JSON.stringify(attrs)) };
};

/**
 * ⛔ THE MAPS CROSS THE WIRE AS A JSON STRING, AND THAT IS THE CORRECT SHAPE. MEASURED with
 *   `bao write -output-curl-string` against the live v2.6.2 (no write was sent): the CLI
 *   puts every `k=v` value in the body as a string, so `default_extensions` leaves as
 *   `"{\"permit-pty\":\"\"}"` and never as an object. OpenBao's own OpenAPI types that field
 *   `object`/`format: map` — a `framework` TypeMap, which JSON-decodes a string value.
 *   ⚠️ THAT DECODE IS REASONED, NOT MEASURED: writing to the live engine was out of bounds,
 *   so the round trip was never executed. If a first deploy lands a role whose
 *   default_extensions came out EMPTY, this is the line that was wrong, and the fix is to
 *   send the map as a JSON object in writeBody rather than as this string — the HTTP body
 *   can now carry either.
 */
const mapValue = (map: Readonly<Record<string, string>>) => JSON.stringify(extMap(map));

/**
 * ⛔ EVERY MANAGED FIELD IS SENT ON EVERY WRITE, INCLUDING THE FALSE ONES. The role write is
 *   a full replace (see ssh-role.ts), so an omitted field is not "left alone" — it is reset.
 *   Sending the resolved form makes the body and the declaration the same statement. All
 *   strings, exactly the `k=v` pairs `bao write` sent, for `PUT <mount>/roles/<name>`.
 */
export const writeBody = (form: BaoSshRoleForm): Record<string, string> => ({
  key_type: 'ca',
  allowed_users: form.allowedUsers.join(','),
  default_user: form.defaultUser,
  allow_user_certificates: String(form.allowUserCertificates),
  allow_host_certificates: String(form.allowHostCertificates),
  allowed_domains: form.allowedDomains.join(','),
  allow_subdomains: String(form.allowSubdomains),
  allow_bare_domains: String(form.allowBareDomains),
  allowed_extensions: form.allowedExtensions.join(','),
  default_extensions: mapValue(form.defaultExtensions),
  allowed_critical_options: form.allowedCriticalOptions.join(','),
  default_critical_options: mapValue(form.defaultCriticalOptions),
  allow_empty_principals: String(form.allowEmptyPrincipals),
  ttl: form.ttl,
  max_ttl: form.maxTtl,
});

const sameList = (want: readonly string[], have: readonly string[]) =>
  want.length === have.length && want.every((entry, index) => entry === have[index]);

const sameMap = (
  want: Readonly<Record<string, string>>,
  have: Readonly<Record<string, string>>,
) => {
  const keys = Object.keys(want);
  return keys.length === Object.keys(have).length && keys.every((key) => have[key] === want[key]);
};

/**
 * Compare in seconds, never as text — `60m` and `1h` are the same role.
 * ⚠️ An unparseable prop yields undefined, which equals no number, so it reports drift
 *   rather than a false noop. `badDurations` is what turns that into a readable refusal.
 */
const sameTtl = (want: string, have: number) => parseDuration(want) === have;

/**
 * ⛔ AN UNPARSEABLE TTL IS A PLAN THAT NEVER GOES GREEN. parseDuration understands `0` and
 *   `<n>[smhd]` and nothing else. A prop like `4h30m` writes fine, reads back as 16200,
 *   fails to parse on the want side, and reports `update` forever — and a resource that is
 *   always dirty is one nobody reads the plan for any more.
 */
export const badDurations = (form: BaoSshRoleForm): readonly string[] =>
  (['ttl', 'maxTtl'] as const).filter((field) => parseDuration(form[field]) === undefined);

/**
 * True when live already matches the declaration on every managed field.
 * ⛔ NOTHING IS SKIPPED FOR BEING UNDEFINED. mount.ts and auth-role.ts can treat an absent
 *   prop as "don't care" because their writes are partial tunes; this one cannot, because
 *   the write resets whatever it omits. Comparing the resolved form is what keeps a
 *   hand-edited role from surviving forever behind a green plan.
 */
export const matches = (attributes: BaoSshRoleAttributes, form: BaoSshRoleForm) =>
  attributes.keyType === 'ca' &&
  sameList(form.allowedUsers, attributes.allowedUsers) &&
  attributes.defaultUser === form.defaultUser &&
  attributes.allowUserCertificates === form.allowUserCertificates &&
  attributes.allowHostCertificates === form.allowHostCertificates &&
  sameList(form.allowedDomains, attributes.allowedDomains) &&
  attributes.allowSubdomains === form.allowSubdomains &&
  attributes.allowBareDomains === form.allowBareDomains &&
  sameList(form.allowedExtensions, attributes.allowedExtensions) &&
  sameMap(form.defaultExtensions, attributes.defaultExtensions) &&
  sameList(form.allowedCriticalOptions, attributes.allowedCriticalOptions) &&
  sameMap(form.defaultCriticalOptions, attributes.defaultCriticalOptions) &&
  attributes.allowEmptyPrincipals === form.allowEmptyPrincipals &&
  sameTtl(form.ttl, attributes.ttlSeconds) &&
  sameTtl(form.maxTtl, attributes.maxTtlSeconds);
