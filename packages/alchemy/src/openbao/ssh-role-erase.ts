/**
 * Bao.SshRole's guard against its own full-replace write: the live fields a write would reset that
 * the declaration does not model. Split from ssh-role.ts, whose reconcile calls it.
 */
import { extMap } from './ssh-role-form.ts';

/**
 * Fields this resource deliberately does not model, mapped to the value OpenBao's own write
 * puts there when nobody says otherwise. The templating flags change how a principal is
 * DERIVED at signing time, which is a different kind of decision from which principals
 * exist; the rest are issuance mechanics. MEASURED against all three live roles — every one
 * of them sits on exactly these values, so the guard below fires on nothing that exists.
 */
const UNMANAGED_DEFAULTS: Readonly<Record<string, unknown>> = {
  algorithm_signer: 'default',
  allow_commas_in_identity_templates: false,
  allow_user_key_ids: false,
  allowed_domains_template: false,
  allowed_users_template: false,
  default_extensions_template: false,
  default_user_template: false,
  issuer_ref: 'default',
  key_id_format: '',
  not_before_duration: 30,
};

/**
 * ⚠️ ABSENT AND EMPTY BOTH COUNT AS "NEVER SET". A role this resource wrote omits these
 *   fields entirely, so a stricter test would refuse on the provider's own output and
 *   deadlock the update after next.
 */
const isDefault = (live: Record<string, unknown>, field: string) =>
  live[field] === undefined || live[field] === '' || live[field] === UNMANAGED_DEFAULTS[field];

/**
 * ⛔ THE FIELDS A WRITE WOULD SILENTLY DESTROY. Because the write is a full replace, a role
 *   someone tuned by hand — `allowed_user_key_lengths` (a minimum RSA size), a
 *   `key_id_format` the audit trail is grepped by, a `not_before_duration` widened to
 *   survive clock skew, a non-default issuer — loses all of it the moment this resource
 *   decides to update. A vanished key-length floor is a security regression that no plan
 *   output would ever mention, and a vanished backdating window breaks signing on exactly
 *   the skewed host it was added for. So reconcile refuses instead of writing.
 */
export const wouldErase = (live: Record<string, unknown>): readonly string[] => {
  const lost = Object.keys(UNMANAGED_DEFAULTS).filter((field) => !isDefault(live, field));
  if (Object.keys(extMap(live['allowed_user_key_lengths'])).length > 0) {
    lost.push('allowed_user_key_lengths');
  }
  return lost.sort();
};
