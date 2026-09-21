/**
 * The form half of Bao.MfaTotpMethod — a TOTP login-MFA method, identified by its `method_name`.
 *
 * ★ READ FROM openbao v2.6.2 vault/identity/store.go:349-427 (fields) and vault/identity/mfa.go
 *   parseTOTPConfig (:662-741): `issuer` is required; `algorithm` is SHA1|SHA256|SHA512; `digits`
 *   6|8; `skew` 0|1; `period`, `key_size` above zero; `max_validation_attempts` 0 means the default
 *   of 5 (:35). EVERY field is `d.Get`, so a write resets whatever it omits — every one is sent.
 * ★ THE READ (login_mfa.go mfaConfigToMap :775-829) answers `period` in seconds and `algorithm` as
 *   its name; `name`, `id` and `namespace_path` ride along.
 * ⚠️ A CHANGED ALGORITHM, DIGITS OR PERIOD APPLIES TO NEW ENROLMENTS ONLY. Validation uses the
 *   parameters stored with each entity's own secret (login_mfa.go validateTOTP :1520-1545), so an
 *   enrolled admin keeps working — with the old parameters — until re-enrolled.
 * ⛔ NO SECRET: the method holds no key. Each entity's TOTP secret is generated per entity by
 *   `.../totp/generate` or `admin-generate`, which RETURNS it; this resource calls neither.
 */
import { sha256 } from './digest.ts';
import { parseDuration, ttlSeconds } from './mount-form.ts';

export type BaoTotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface BaoMfaTotpMethodProps {
  /** `method_name` — the declarative key, unique per namespace. ⛔ A rename is refused (mfa-totp.ts). */
  name: string;
  /** The issuer an authenticator app shows, e.g. `vault-example`. */
  issuer: string;
  /** Code lifetime. Default `30s`. */
  period?: string;
  /** Secret size in bytes. Default 20. */
  keySize?: number;
  /** QR code size in pixels; `0` for none. Default 200. */
  qrSize?: number;
  /** Default `SHA1` — the one every authenticator app supports. */
  algorithm?: BaoTotpAlgorithm;
  /** Default 6. */
  digits?: 6 | 8;
  /** Periods of clock skew accepted. Default 1. */
  skew?: 0 | 1;
  /** Failed codes before the entity is locked out of this method. Default 5. */
  maxValidationAttempts?: number;
}

export interface BaoMfaTotpCanonical {
  algorithm: string;
  digits: number;
  issuer: string;
  keySize: number;
  maxValidationAttempts: number;
  periodSeconds: number;
  qrSize: number;
  skew: number;
}

export interface BaoMfaTotpMethodAttributes extends BaoMfaTotpCanonical {
  /** The server-made UUID — what a Bao.MfaLoginEnforcement names in `mfaMethodIds`. */
  methodId: string;
  name: string;
  /** `''` for root, `team-a/` below it. */
  namespacePath: string;
  digest: string;
}

const canonical = (input: BaoMfaTotpCanonical): BaoMfaTotpCanonical => ({
  algorithm: input.algorithm,
  digits: input.digits,
  issuer: input.issuer,
  keySize: input.keySize,
  maxValidationAttempts: input.maxValidationAttempts,
  periodSeconds: input.periodSeconds,
  qrSize: input.qrSize,
  skew: input.skew,
});

export const canonicalFromProps = (props: BaoMfaTotpMethodProps): BaoMfaTotpCanonical =>
  canonical({
    algorithm: props.algorithm ?? 'SHA1',
    digits: props.digits ?? 6,
    issuer: props.issuer,
    keySize: props.keySize ?? 20,
    maxValidationAttempts: props.maxValidationAttempts ?? 5,
    periodSeconds: parseDuration(props.period ?? '30s') ?? -1,
    qrSize: props.qrSize ?? 200,
    skew: props.skew ?? 1,
  });

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : -1);
const text = (value: unknown) => (typeof value === 'string' ? value : '');

export const canonicalFromLive = (live: Record<string, unknown>): BaoMfaTotpCanonical =>
  canonical({
    algorithm: text(live['algorithm']),
    digits: num(live['digits']),
    issuer: text(live['issuer']),
    keySize: num(live['key_size']),
    maxValidationAttempts: num(live['max_validation_attempts']),
    periodSeconds: ttlSeconds(live['period']) ?? -1,
    qrSize: num(live['qr_size']),
    skew: num(live['skew']),
  });

export const attributesOf = (
  methodId: string,
  live: Record<string, unknown>,
): BaoMfaTotpMethodAttributes => {
  const form = canonicalFromLive(live);
  return {
    ...form,
    digest: sha256(JSON.stringify(form)),
    methodId,
    name: text(live['name']),
    namespacePath: text(live['namespace_path']),
  };
};

export const matches = (attributes: BaoMfaTotpMethodAttributes, props: BaoMfaTotpMethodProps) =>
  attributes.digest === sha256(JSON.stringify(canonicalFromProps(props)));

/** The upsert body — by `method_name`, never `method_id` (mfa-wire.ts). */
export const writeBody = (props: BaoMfaTotpMethodProps): Record<string, unknown> => {
  const form = canonicalFromProps(props);
  return {
    algorithm: form.algorithm,
    digits: form.digits,
    issuer: form.issuer,
    key_size: form.keySize,
    max_validation_attempts: form.maxValidationAttempts,
    method_name: props.name,
    period: props.period ?? '30s',
    qr_size: form.qrSize,
    skew: form.skew,
  };
};

/**
 * The diff's refusal for a changed name, or undefined when the name is unchanged. Never a
 * `replace`: the ⛔ on a rename in mfa-totp.ts says why.
 */
export const renameProblem = (from: string, to: string): string | undefined =>
  from === to
    ? undefined
    : `renaming from \`${from}\` would strand every enrolled secret. Declare the new method as a ` +
      'second resource, list both ids on the enforcement, enrol, then remove the old one ' +
      '(mfa-totp.ts).';

export const problems = (props: BaoMfaTotpMethodProps): readonly string[] => {
  const found: string[] = [];
  const form = canonicalFromProps(props);
  if (props.name.trim() === '') found.push('name is empty; it is the only key a declaration has');
  if (props.issuer.trim() === '') found.push('issuer is empty; the server requires one');
  if (form.periodSeconds <= 0)
    found.push(`period \`${props.period ?? ''}\` must be a duration above zero`);
  if (form.keySize <= 0) found.push('keySize must be above zero');
  if (form.maxValidationAttempts < 1)
    found.push('maxValidationAttempts must be at least 1 (0 reads back as 5)');
  return found;
};
