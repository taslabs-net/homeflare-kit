/**
 * Auth-method shape — path, type, description, lease TTLs. METADATA ONLY.
 *
 * ⛔ NO SECRET IN PROPS. Enabling `approle` (or jwt/oidc) is a mount, not a credential.
 *   Role ids, OIDC client secrets, and secret_ids stay out of Alchemy state.
 */
import { sha256 } from './digest.ts';
import { mountPath, ttlSeconds } from './mount-form.ts';

export interface BaoAuthMethodProps {
  /** Auth path without trailing slash, as `sys/auth/<path>` takes it. */
  path: string;
  /** Auth method type, e.g. `approle`, `jwt`, `oidc`. */
  type: string;
  /** Human description — sent on enable and on tune, as configure-engines does. */
  description?: string;
  /** Default lease TTL, e.g. `768h`. */
  defaultLeaseTtl?: string;
  /** Max lease TTL, e.g. `8760h`. */
  maxLeaseTtl?: string;
}

export interface BaoAuthMethodAttributes {
  path: string;
  type: string;
  description: string;
  defaultLeaseTtl: string;
  maxLeaseTtl: string;
  /** SHA-256 of the managed fields — safe to persist; see policy.ts. */
  digest: string;
}

/** Auth path without a trailing slash — listing keys are `${path}/`. */
export const authPath = (path: string) => mountPath(path);

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
  props: BaoAuthMethodProps,
  live: Record<string, unknown>,
): BaoAuthMethodAttributes => {
  const config = configOf(live);
  const attrs = {
    path: authPath(props.path),
    type: text(live['type']) || props.type,
    description: text(live['description']),
    defaultLeaseTtl: ttlProp(ttlSeconds(config['default_lease_ttl'])),
    maxLeaseTtl: ttlProp(ttlSeconds(config['max_lease_ttl'])),
  };
  return { ...attrs, digest: sha256(JSON.stringify(attrs)) };
};

/** `sys/auth/<path>` — read, enable and disable all address the method here. */
export const readPath = (path: string) => `sys/auth/${authPath(path)}`;

/**
 * ★ SAME TUNE ROUTE SHAPE AS SECRETS MOUNTS. `bao auth tune` hits
 *   `sys/auth/<path>/tune` (openbao v2.6.2 api/sys_auth.go TuneAuth).
 */
export const tunePath = (path: string) => `${readPath(path)}/tune`;

/**
 * The enable body. configure-engines POSTed `{ type, description }` for approle.
 *
 * ⚠️ TTLs ARE NOT SENT HERE. reconcile tunes them after enable, same as Bao.Mount.
 */
export const enableBody = (props: BaoAuthMethodProps): Record<string, string> => {
  const body: Record<string, string> = { type: props.type };
  if (props.description !== undefined) body['description'] = props.description;
  return body;
};

/** Tune body — only the fields the declaration names. An omitted field is left alone. */
export const tuneBody = (props: BaoAuthMethodProps): Record<string, string> => {
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
export const matches = (attributes: BaoAuthMethodAttributes, props: BaoAuthMethodProps) =>
  attributes.type === props.type &&
  (props.description === undefined || attributes.description === props.description) &&
  sameTtl(props.defaultLeaseTtl, attributes.defaultLeaseTtl) &&
  sameTtl(props.maxLeaseTtl, attributes.maxLeaseTtl);

export const wantsTune = (props: BaoAuthMethodProps) =>
  props.description !== undefined ||
  props.defaultLeaseTtl !== undefined ||
  props.maxLeaseTtl !== undefined;
