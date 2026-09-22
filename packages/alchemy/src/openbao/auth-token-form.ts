/**
 * The `token_*` fields every auth role shares — read once here for Bao.JwtRole and
 * Bao.KubernetesRole, so the two cannot disagree about what a token TTL is.
 *
 * ★ READ FROM openbao v2.6.2 sdk/helper/tokenutil/tokenutil.go:
 *   · TokenFields (:80-170) — `token_policies`, `token_bound_cidrs` are comma-string slices;
 *     `token_ttl`, `token_max_ttl`, `token_explicit_max_ttl`, `token_period` are duration-seconds;
 *     `token_no_default_policy` bool; `token_num_uses` int; `token_type` a string.
 *   · ParseTokenFields (:176-262) — EVERY field is `GetOk`: an omitted field KEEPS its stored value.
 *     So an update is a merge, and the only way to clear a stale value is to send the default.
 *     That is why every field below is sent on every write, resolved to its default.
 *   · PopulateTokenData (:265-284) — the read answers seconds for durations, `[]` for empty lists,
 *     and `token_type` as a word (sdk/logical/token.go: `default`, `service`, `batch`).
 * ⛔ NO SECRET HERE: policy names, CIDRs, TTLs.
 */
import { parseDuration, ttlSeconds } from './mount-form.ts';

export type BaoTokenType = 'batch' | 'default' | 'service';

export interface BaoTokenProps {
  /** Policies on tokens this role issues. Names only. */
  tokenPolicies: readonly string[];
  /** Token TTL (`15m`). Default `0` — the mount's default. */
  tokenTtl?: string;
  /** Token max TTL (`1h`). Default `0` — the mount's max. */
  tokenMaxTtl?: string;
  /** Hard ceiling that renewal cannot pass. Default `0` (none). */
  tokenExplicitMaxTtl?: string;
  /** Periodic tokens renew forever within this period. Default `0` (not periodic). */
  tokenPeriod?: string;
  /** Leave the `default` policy off. Default false. */
  tokenNoDefaultPolicy?: boolean;
  /** CIDRs a token may be USED from. Default none. */
  tokenBoundCidrs?: readonly string[];
  /** Uses before the token dies; `0` is unlimited. Default 0. */
  tokenNumUses?: number;
  /** Default `default` — the mount decides, which means service tokens unless it says otherwise. */
  tokenType?: BaoTokenType;
}

/** The token fields as seconds and sorted sets — both sides of a diff are built by `tokenForm`. */
export interface BaoTokenForm {
  tokenBoundCidrs: readonly string[];
  tokenExplicitMaxTtlSeconds: number;
  tokenMaxTtlSeconds: number;
  tokenNoDefaultPolicy: boolean;
  tokenNumUses: number;
  tokenPeriodSeconds: number;
  tokenPolicies: readonly string[];
  tokenTtlSeconds: number;
  tokenType: string;
}

const sortedSet = (values: readonly string[]) => [...new Set(values)].sort();

/**
 * ⚠️ A HOST CIDR READS BACK BARE. token_bound_cidrs is stored as sockaddr values, and a `/32` (or
 *   `/128`) host address renders without its mask. REASONED from go-sockaddr's String(), not
 *   measured — so the mask is dropped on BOTH sides, which can only hide a spelling difference.
 */
const cidr = (value: string) => value.trim().replace(/\/(32|128)$/, '');

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const seconds = (text: string | undefined) => parseDuration(text ?? '0') ?? -1;

/**
 * The token fields of an already-normalised form, in one fixed key order — what a role family's own
 * canonical literal spreads, so its digest cannot depend on how the object was assembled.
 */
export const tokenFields = (input: BaoTokenForm): BaoTokenForm => ({
  tokenBoundCidrs: input.tokenBoundCidrs,
  tokenExplicitMaxTtlSeconds: input.tokenExplicitMaxTtlSeconds,
  tokenMaxTtlSeconds: input.tokenMaxTtlSeconds,
  tokenNoDefaultPolicy: input.tokenNoDefaultPolicy,
  tokenNumUses: input.tokenNumUses,
  tokenPeriodSeconds: input.tokenPeriodSeconds,
  tokenPolicies: input.tokenPolicies,
  tokenTtlSeconds: input.tokenTtlSeconds,
  tokenType: input.tokenType,
});

/** The key order is fixed here, once, for both sides. */
const tokenForm = (input: BaoTokenForm): BaoTokenForm => ({
  tokenBoundCidrs: sortedSet(input.tokenBoundCidrs.map(cidr)),
  tokenExplicitMaxTtlSeconds: input.tokenExplicitMaxTtlSeconds,
  tokenMaxTtlSeconds: input.tokenMaxTtlSeconds,
  tokenNoDefaultPolicy: input.tokenNoDefaultPolicy,
  tokenNumUses: input.tokenNumUses,
  tokenPeriodSeconds: input.tokenPeriodSeconds,
  tokenPolicies: sortedSet(input.tokenPolicies),
  tokenTtlSeconds: input.tokenTtlSeconds,
  tokenType: input.tokenType,
});

export const tokenFormOfProps = (props: BaoTokenProps): BaoTokenForm =>
  tokenForm({
    tokenBoundCidrs: props.tokenBoundCidrs ?? [],
    tokenExplicitMaxTtlSeconds: seconds(props.tokenExplicitMaxTtl),
    tokenMaxTtlSeconds: seconds(props.tokenMaxTtl),
    tokenNoDefaultPolicy: props.tokenNoDefaultPolicy ?? false,
    tokenNumUses: props.tokenNumUses ?? 0,
    tokenPeriodSeconds: seconds(props.tokenPeriod),
    tokenPolicies: props.tokenPolicies,
    tokenTtlSeconds: seconds(props.tokenTtl),
    tokenType: props.tokenType ?? 'default',
  });

export const tokenFormOfLive = (live: Record<string, unknown>): BaoTokenForm =>
  tokenForm({
    tokenBoundCidrs: strings(live['token_bound_cidrs']),
    tokenExplicitMaxTtlSeconds: ttlSeconds(live['token_explicit_max_ttl']) ?? -1,
    tokenMaxTtlSeconds: ttlSeconds(live['token_max_ttl']) ?? -1,
    tokenNoDefaultPolicy: live['token_no_default_policy'] === true,
    tokenNumUses: typeof live['token_num_uses'] === 'number' ? live['token_num_uses'] : -1,
    tokenPeriodSeconds: ttlSeconds(live['token_period']) ?? -1,
    tokenPolicies: strings(live['token_policies']),
    tokenTtlSeconds: ttlSeconds(live['token_ttl']) ?? -1,
    tokenType: typeof live['token_type'] === 'string' ? live['token_type'] : '',
  });

/**
 * The token half of a role write — every field, defaults included (the merge ⚠️ above). Durations
 * go over as the author's own strings; lists as JSON arrays, which a comma-string-slice accepts.
 */
export const tokenBody = (props: BaoTokenProps): Record<string, unknown> => ({
  token_bound_cidrs: [...(props.tokenBoundCidrs ?? [])],
  token_explicit_max_ttl: props.tokenExplicitMaxTtl ?? '0',
  token_max_ttl: props.tokenMaxTtl ?? '0',
  token_no_default_policy: props.tokenNoDefaultPolicy ?? false,
  token_num_uses: props.tokenNumUses ?? 0,
  token_period: props.tokenPeriod ?? '0',
  token_policies: [...props.tokenPolicies],
  token_ttl: props.tokenTtl ?? '0',
  token_type: props.tokenType ?? 'default',
});

/** Refusals the token half can know without a server. */
export const tokenProblems = (props: BaoTokenProps): readonly string[] => {
  const found: string[] = [];
  const durations = {
    tokenExplicitMaxTtl: props.tokenExplicitMaxTtl,
    tokenMaxTtl: props.tokenMaxTtl,
    tokenPeriod: props.tokenPeriod,
    tokenTtl: props.tokenTtl,
  };
  for (const [field, text] of Object.entries(durations)) {
    if (seconds(text) < 0) found.push(`${field}=${text ?? ''} is not a duration (0 or <n>s|m|h|d)`);
  }
  const ttl = seconds(props.tokenTtl);
  const max = seconds(props.tokenMaxTtl);
  if (ttl > 0 && max > 0 && ttl > max) found.push('tokenTtl is longer than tokenMaxTtl');
  if (
    props.tokenType === 'batch' &&
    (seconds(props.tokenPeriod) > 0 || (props.tokenNumUses ?? 0) > 0)
  ) {
    found.push('a batch token cannot be periodic or use-limited (tokenutil.go:234-241)');
  }
  return found;
};
