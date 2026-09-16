import { sha256 } from './digest.ts';

/** Mount path without a trailing slash — props and `sys/mounts/<path>` use this shape. */
export const mountPath = (path: string) => path.replace(/\/+$/, '');

const DURATION = /^(\d+)([smhd])$/;

/** Parse a Vault duration string (`15m`, `768h`, `0`) to seconds. */
export const parseDuration = (text: string): number | undefined => {
  const trimmed = text.trim();
  if (trimmed === '0') return 0;
  const match = DURATION.exec(trimmed);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  switch (match[2]) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    default:
      return undefined;
  }
};

/** Seconds from live JSON (`2764800`) or a duration prop (`768h`). */
export const ttlSeconds = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return parseDuration(value);
  return undefined;
};

export interface BaoMountProps {
  /** Mount path without trailing slash, as `sys/mounts/<path>` takes it. */
  path: string;
  /** Secrets engine type, e.g. `kv`, `pki`, `openbao-plugin-secrets-cloudflare`. */
  type: string;
  /** Human description — tuned via `sys/mounts/<path>/tune`, as apply-roles.py describe_mounts does. */
  description?: string;
  /** Default lease TTL, e.g. `768h`. */
  defaultLeaseTtl?: string;
  /** Max lease TTL, e.g. `8760h`. */
  maxLeaseTtl?: string;
  /** KV only — sent as `options.version` on enable, as `-version=2` was. Immutable after create. */
  version?: 1 | 2;
}

export interface BaoMountAttributes {
  path: string;
  type: string;
  description: string;
  defaultLeaseTtl: string;
  maxLeaseTtl: string;
  /** SHA-256 of the managed fields — safe to persist; see policy.ts. */
  digest: string;
}

const configOf = (live: Record<string, unknown>) =>
  typeof live['config'] === 'object' && live['config'] !== null
    ? (live['config'] as Record<string, unknown>)
    : {};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const ttlProp = (seconds: number | undefined, fallback = '') => {
  if (seconds === undefined) return fallback;
  if (seconds % 86400 === 0) return `${String(seconds / 86400)}d`;
  if (seconds % 3600 === 0) return `${String(seconds / 3600)}h`;
  if (seconds % 60 === 0) return `${String(seconds / 60)}m`;
  return `${String(seconds)}s`;
};

export const attributesOf = (
  props: BaoMountProps,
  live: Record<string, unknown>,
): BaoMountAttributes => {
  const config = configOf(live);
  const defaultLeaseTtl = ttlProp(ttlSeconds(config['default_lease_ttl']));
  const maxLeaseTtl = ttlProp(ttlSeconds(config['max_lease_ttl']));
  const attrs = {
    path: mountPath(props.path),
    type: text(live['type']) || props.type,
    description: text(live['description']),
    defaultLeaseTtl,
    maxLeaseTtl,
  };
  return { ...attrs, digest: sha256(JSON.stringify(attrs)) };
};

/** `sys/mounts/<path>` — read, enable and disable all address the mount here. */
export const readPath = (path: string) => `sys/mounts/${mountPath(path)}`;

/**
 * ★ NO TRAILING SLASH NEEDED ON THE WIRE. `bao secrets tune` appended one itself; the server's
 *   route `mounts/(?P<path>.+?)/tune$` captures the bare path and `sanitizePath` appends the slash
 *   OpenBao stores in sys/mounts (openbao v2.6.2 vault/logical_system_paths.go:4248,
 *   vault/logical_system.go:4825-4833).
 */
export const tunePath = (path: string) => `${readPath(path)}/tune`;

/**
 * The enable body. `-version=2` on the CLI became `options.version = "2"` (openbao v2.6.2
 * command/secrets_enable.go:278 into api MountInput.Options), so that is what is sent.
 *
 * ⚠️ DESCRIPTION AND TTLs ARE NOT SENT HERE. reconcile tunes them straight after the enable,
 *   exactly as the CLI path did, so a create and an update converge through the same call.
 */
export const enableBody = (props: BaoMountProps): Record<string, unknown> =>
  props.version === 2 ? { options: { version: '2' }, type: props.type } : { type: props.type };

/**
 * The tune body — only the fields the declaration names.
 *
 * ★ AN OMITTED FIELD IS LEFT ALONE. The server reads an absent TTL as "" and keeps the mount's
 *   current value for "" (vault/logical_system.go:1614-1630), and applies `description` only when
 *   present (:1725). The CLI sent unset TTL flags as "" and set description only when given
 *   (command/secrets_tune.go Visit), so omitting them is the same request.
 */
export const tuneBody = (props: BaoMountProps): Record<string, string> => {
  const body: Record<string, string> = {};
  if (props.description !== undefined) body['description'] = props.description;
  if (props.defaultLeaseTtl !== undefined) body['default_lease_ttl'] = props.defaultLeaseTtl;
  if (props.maxLeaseTtl !== undefined) body['max_lease_ttl'] = props.maxLeaseTtl;
  return body;
};

const sameTtl = (want: string | undefined, have: string) => {
  if (want === undefined) return true;
  const wantSeconds = ttlSeconds(want);
  const haveSeconds = ttlSeconds(have);
  return wantSeconds !== undefined && wantSeconds === haveSeconds;
};

/** True when live already matches the declaration on every managed field. */
export const matches = (attributes: BaoMountAttributes, props: BaoMountProps) =>
  attributes.type === props.type &&
  (props.description === undefined || attributes.description === props.description) &&
  sameTtl(props.defaultLeaseTtl, attributes.defaultLeaseTtl) &&
  sameTtl(props.maxLeaseTtl, attributes.maxLeaseTtl);

export const wantsTune = (props: BaoMountProps) =>
  props.description !== undefined ||
  props.defaultLeaseTtl !== undefined ||
  props.maxLeaseTtl !== undefined;
