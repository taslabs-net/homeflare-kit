/**
 * CaddyConfig's props, attributes and validation — the pure half of the provider.
 *
 * ⛔ `caddyfile` IS NEVER A SECRET. Alchemy stores props unencrypted, so the whole Caddyfile sits in
 *   the state store and in every plan diff. Secrets reach Caddy as runtime placeholders
 *   (`{env.NAME}`, `{file./path}`) resolved from files a secret renderer writes — see
 *   caddyfile-tripwire.ts, which refuses the obvious literals.
 */
import { caddyfileSecretProblems } from './caddyfile-tripwire.ts';

export interface CaddyConfigProps {
  /**
   * The whole Caddyfile. Applied with `POST /load` (Content-Type `text/caddyfile`); it REPLACES the
   * running config. ⛔ Never a secret. ⚠️ `import` paths resolve against Caddy's working directory
   * (the API adapts with no file name), so keep them absolute.
   */
  caddyfile: string;
  /**
   * The file Caddy was started with (`caddy run --config <this>`), when the same Caddyfile is also
   * written there — `caddyWithFile()` sets it from its HostFile. Sent as
   * `Caddy-Config-Source-File` so a load keeps Caddy's SIGUSR1 reload-from-file working.
   */
  sourceFile?: string;
}

export interface CaddyConfigAttributes {
  /**
   * SHA-256 of the ADAPTED JSON Caddy reported after the last apply (digest.ts canonical form) —
   * never the config itself. Drift is the live config hashing to anything else.
   */
  configSha256: string;
  /** The admin endpoint the config was applied through (no credential; the API has none). */
  endpoint: string;
  /** The `sourceFile` prop as applied. */
  sourceFile?: string;
}

const absoluteNormalised = (path: string): boolean =>
  path.startsWith('/') &&
  !path.endsWith('/') &&
  !path.includes('\x00') &&
  !path
    .split('/')
    .slice(1)
    .some((part) => part === '' || part === '.' || part === '..');

export const configProblems = (props: CaddyConfigProps): string[] => {
  const found: string[] = [];
  /**
   * ⛔ AN EMPTY CADDYFILE IS NOT "NOTHING TO DO". It adapts to a config with no apps, and loading
   *   it stops every server Caddy runs — every site down, on a templating bug that rendered ''.
   *   Emptying Caddy is a deliberate act for a person at the admin API, not a declaration.
   *   Text that is not empty but serves nothing (only comments, only global options) is caught
   *   after `/adapt`, where it shows as no apps (config-lifecycle.ts servesNothing).
   */
  if (props.caddyfile.trim() === '') {
    found.push('caddyfile is empty — loading it would stop every site Caddy serves');
  }
  if (props.sourceFile !== undefined && !absoluteNormalised(props.sourceFile)) {
    found.push('sourceFile must be an absolute, normalised path');
  }
  found.push(...caddyfileSecretProblems(props.caddyfile));
  return found;
};
