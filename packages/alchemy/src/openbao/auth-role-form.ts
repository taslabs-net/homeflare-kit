import { sha256 } from './digest.ts';
import { parseDuration, ttlSeconds } from './mount-form.ts';

export interface BaoAuthRoleProps {
  /** AppRole name, as `auth/approle/role/{name}` takes it. */
  name: string;
  /** Policies bound to tokens minted through this role. Names only — never a secret. */
  tokenPolicies: readonly string[];
  /** Token TTL, e.g. `15m`. */
  tokenTtl: string;
  /** Token max TTL, e.g. `1h`. */
  tokenMaxTtl: string;
  /** Secret ID TTL — `0` means non-expiring, as reconcile.sh and apply-consumers.py set. */
  secretIdTtl: string;
  /** Whether login requires a secret_id. Defaults to true when omitted on write. */
  bindSecretId?: boolean;
  /** `0` means unlimited uses — the shape reconcile.sh writes for headless roles. */
  secretIdNumUses?: number;
}

export interface BaoAuthRoleAttributes {
  name: string;
  tokenPolicies: readonly string[];
  tokenTtl: string;
  tokenMaxTtl: string;
  secretIdTtl: string;
  bindSecretId: boolean;
  secretIdNumUses: number;
  /** SHA-256 of the managed fields — safe to persist; see policy.ts. */
  digest: string;
}

const policiesOf = (live: Record<string, unknown>): readonly string[] => {
  const raw = live['token_policies'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is string => typeof entry === 'string')
    .slice()
    .sort();
};

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const int = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const ttlText = (seconds: number | undefined, fallback = '') => {
  if (seconds === undefined) return fallback;
  if (seconds % 86400 === 0) return `${String(seconds / 86400)}d`;
  if (seconds % 3600 === 0) return `${String(seconds / 3600)}h`;
  if (seconds % 60 === 0) return `${String(seconds / 60)}m`;
  return `${String(seconds)}s`;
};

export const attributesOf = (
  props: BaoAuthRoleProps,
  live: Record<string, unknown>,
): BaoAuthRoleAttributes => {
  const attrs = {
    name: props.name,
    tokenPolicies: policiesOf(live),
    tokenTtl: ttlText(ttlSeconds(live['token_ttl'])),
    tokenMaxTtl: ttlText(ttlSeconds(live['token_max_ttl'])),
    secretIdTtl: ttlText(ttlSeconds(live['secret_id_ttl']), '0'),
    bindSecretId: bool(live['bind_secret_id'], true),
    secretIdNumUses: int(live['secret_id_num_uses'], 0),
  };
  return { ...attrs, digest: sha256(JSON.stringify(attrs)) };
};

export const readPath = (name: string) => `auth/approle/role/${name}`;

/**
 * The body for `PUT auth/approle/role/<name>`.
 *
 * ★ ALL STRINGS, EXACTLY THE `k=v` PAIRS `bao write` USED TO SEND — see `baoWrite` in bao-http.ts.
 */
export const writeBody = (props: BaoAuthRoleProps): Record<string, string> => {
  const body: Record<string, string> = {
    token_policies: props.tokenPolicies.join(','),
    token_ttl: props.tokenTtl,
    token_max_ttl: props.tokenMaxTtl,
    secret_id_ttl: props.secretIdTtl,
  };
  if (props.bindSecretId !== undefined) body['bind_secret_id'] = String(props.bindSecretId);
  if (props.secretIdNumUses !== undefined) {
    body['secret_id_num_uses'] = String(props.secretIdNumUses);
  }
  return body;
};

const samePolicies = (want: readonly string[], have: readonly string[]) =>
  want.length === have.length && want.every((policy, index) => policy === have[index]);

const sameTtl = (want: string, have: string) => {
  const wantSeconds = parseDuration(want);
  const haveSeconds = ttlSeconds(have);
  return wantSeconds !== undefined && wantSeconds === haveSeconds;
};

/** True when live already matches the declaration on every managed field. */
export const matches = (attributes: BaoAuthRoleAttributes, props: BaoAuthRoleProps) => {
  const wantPolicies = props.tokenPolicies.slice().sort();
  return (
    samePolicies(wantPolicies, attributes.tokenPolicies) &&
    sameTtl(props.tokenTtl, attributes.tokenTtl) &&
    sameTtl(props.tokenMaxTtl, attributes.tokenMaxTtl) &&
    sameTtl(props.secretIdTtl, attributes.secretIdTtl) &&
    (props.bindSecretId === undefined || attributes.bindSecretId === props.bindSecretId) &&
    (props.secretIdNumUses === undefined || attributes.secretIdNumUses === props.secretIdNumUses)
  );
};
