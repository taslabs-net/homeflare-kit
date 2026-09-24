/**
 * Google Workspace credentials for the house — a lazy reference, never the key.
 *
 * ⛔ THE DISTILLED SDK'S OWN `Credentials` SERVICE TAKES ONE THING: an already-minted OAuth2
 *   bearer access token (`@distilled.cloud/google-workspace/Credentials` — read at
 *   `node_modules/@distilled.cloud/google-workspace/src/credentials.ts`, 2026-09-24: "API-compatible
 *   port of the distilled gcp credentials module … no ADC, no service-account signing, no refresh
 *   flow"). It has no service-account JSON shape and no domain-wide-delegation JWT exchange built
 *   in — minting the token is entirely outside the SDK's surface.
 *
 * ★ SO THE HOUSE PATTERN IS H8'S, UNCHANGED: a short-lived credential is minted from OpenBao and
 *   exported into the DEPLOY PROCESS's environment only, by a Bun wrapper the operator runs — the
 *   same shape the kit's Proxmox subpath already uses for its own OpenBao-sourced token. This
 *   family adds nothing that signs a JWT or talks to Google's token endpoint; that stays Tim's
 *   wrapper script, documented in the README, because building it here would be a second,
 *   hand-rolled auth flow next to the one the SDK already exposes (S23).
 *
 * ⛔ NEVER THE KEY. `GoogleWorkspaceKeyRef` below is a REFERENCE to where a service-account key
 *   lives — an OpenBao path, a delegated admin subject and the scopes the wrapper requests — not
 *   the key itself. Nothing in this family reads, parses or holds private key material; `describeKeyRef`
 *   is pure string formatting for docs and the census handoff header, and it is tested (below) to
 *   never accept or echo anything shaped like a key.
 *
 * Re-exported so a consumer imports one module for both the distilled service and the house
 * reference type: `import { CredentialsFromEnv, fromAccessToken, type GoogleWorkspaceKeyRef } from
 * '@homeflare/alchemy/google-workspace'`.
 */
export {
  type Config as GoogleWorkspaceConfig,
  Credentials,
  CredentialsFromEnv,
  fromAccessToken,
} from '@distilled.cloud/google-workspace/Credentials';

/** Env var the SDK's `CredentialsFromEnv` reads — the wrapper mints into THIS var, nothing else. */
export const GOOGLE_ACCESS_TOKEN_ENV = 'GOOGLE_ACCESS_TOKEN';
/** Optional — only meaningful if a resource ever needs to scope a call to a GCP project. */
export const GOOGLE_PROJECT_ID_ENV = 'GOOGLE_PROJECT_ID';

/**
 * Where the service-account key that a wrapper exchanges for `GOOGLE_ACCESS_TOKEN` lives —
 * documentation and typing only. A stack file may keep one of these next to its declarations so
 * the OpenBao path, delegated admin and scopes are reviewable in the same diff as the resources
 * they authorize — nothing here reads OpenBao or Google, and no field may hold a key, a token or
 * a private key fragment.
 */
export interface GoogleWorkspaceKeyRef {
  /** OpenBao KV path, e.g. `kv/google-workspace/service-accounts/directory-admin`. */
  readonly openBaoPath: string;
  /** The Workspace admin the service account impersonates via domain-wide delegation. */
  readonly delegatedAdmin: string;
  /** OAuth scopes the wrapper requests — keep this the least the declared resources need. */
  readonly scopes: readonly string[];
}

/** Substrings that must never appear in a `GoogleWorkspaceKeyRef` field — this is a reference. */
const KEY_SHAPED = /-----BEGIN|private_key|"type":\s*"service_account"/i;

/**
 * A one-line, key-free description for docs and the census handoff header. Throws rather than
 * formatting a ref whose fields look like they hold key material — a `GoogleWorkspaceKeyRef` is
 * a pointer, and this is the one place that assumption is checked instead of assumed.
 */
export const describeKeyRef = (ref: GoogleWorkspaceKeyRef): string => {
  for (const [field, value] of Object.entries(ref)) {
    const text = Array.isArray(value) ? value.join(',') : String(value);
    if (KEY_SHAPED.test(text)) {
      throw new Error(`GoogleWorkspaceKeyRef.${field} looks like key material, not a reference`);
    }
  }
  return (
    `service account at OpenBao:${ref.openBaoPath}, delegating as ${ref.delegatedAdmin}, ` +
    `scopes: ${ref.scopes.join(' ')}`
  );
};
