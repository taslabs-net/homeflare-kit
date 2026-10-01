/**
 * The fixed ACL profiles this family can express, as the exact rule tokens the wire carries.
 *
 * ⛔ THE COMMAND ALLOW-LIST IS A FIXED PROFILE, NOT A PROP (see `acl-attrs.ts`). Every rule set
 *   here mirrors `homeflare-ct100/src/valkey-acl.ts` (ct100#117) token for token, measured on the
 *   9.1.1 scratch; a free-form rules prop would let a declaration widen itself and request
 *   `FLUSHALL` or `ACL SETUSER`, defeating the isolation the resource exists to enforce.
 *
 * ★ THE `monitor` PROFILE EXISTS BECAUSE CT100 CARRIES A KEY-LESS `monitor` USER FOR
 *   `redis_exporter` (ct100#117). Before it existed, `seat` and `service` were the only profiles,
 *   so `monitor` was undeclared on every CT100-style instance and reconcile DELETED it —
 *   exporter's connection closed (measured 2026-09-30). `MONITOR_COMMANDS` is exactly what
 *   `redis_exporter` v1.92.1 issues, measured: `client|setname`, `info`, `command|info`,
 *   `commandlog|len` (Valkey 8.1+), `config|get`, `latency|latest`, `latency|histogram`,
 *   `slowlog|get`, `slowlog|len`, plus `ping`. No keys (`resetkeys`), no channels
 *   (`resetchannels`), no `client|list` (this exporter version never sends it, so it is not
 *   granted).
 */
import type { ValkeyAclProfile, ValkeyAclUser } from './acl-attrs.ts';

/** The seat command allow-list — fixed, mirrored from `homeflare-ct100/src/valkey-acl.ts`. */
export const SEAT_COMMANDS =
  '+@read +@write +@string +@hash +@list +@set +@sortedset +@stream +@pubsub +@connection ' +
  '+@transaction -@dangerous -@admin -keys -flushall -flushdb -monitor -acl -config ' +
  '-shutdown -debug';

/** Commands that close keyspace/channel enumeration, measured as a leak without them
 * (seat-wiring-spec §5). */
const DENY = '-scan -randomkey -dbsize -pubsub';

/** What `redis_exporter` v1.92.1 needs and nothing else (ct100#117's `monitor` note). */
export const MONITOR_COMMANDS =
  '-@all +ping +client|setname +info +command|info +commandlog|len +config|get ' +
  '+latency|latest +latency|histogram +slowlog|get +slowlog|len';

/** The fixed rule sets, as the exact tokens sent after `reset`. */
export const SEAT_RULES: ReadonlyArray<string> = [...SEAT_COMMANDS.split(' '), ...DENY.split(' ')];
export const SERVICE_RULES: ReadonlyArray<string> = ['+@all', '-@dangerous', ...DENY.split(' ')];
export const MONITOR_RULES: ReadonlyArray<string> = MONITOR_COMMANDS.split(' ');

/** The rule set one profile carries. */
export const profileRules = (profile: ValkeyAclProfile): ReadonlyArray<string> =>
  profile === 'seat' ? SEAT_RULES : profile === 'service' ? SERVICE_RULES : MONITOR_RULES;

/**
 * The effective key prefix of one declared user.
 *
 * - `monitor` is key-less (ct100#117's `resetkeys`): it has no prefix, and a declaration that
 *   gives it one is refused (`ValkeyAclMonitorKeyPrefix`).
 * - `seat` is pinned to `<name>:*` — the CT100 template's `~${user}:*`; anything else is refused
 *   (`ValkeyAclSeatKeyPrefix`). The optional prop defaults to the pin.
 * - `service` owns the instance's declared prefix, `*` by default (LiteLLM's cache user on CT100
 *   declares `hf-litellm:*`).
 */
export const effectiveKeyPrefix = (user: ValkeyAclUser): string =>
  user.profile === 'monitor'
    ? ''
    : user.profile === 'seat'
      ? (user.keyPrefix ?? `${user.name}:*`)
      : (user.keyPrefix ?? '*');

/** The key patterns the declaration expects for one user, in the server's own echo form. */
export const declaredKeyPatterns = (user: ValkeyAclUser): ReadonlyArray<string> => {
  const prefix = effectiveKeyPrefix(user);
  return prefix === '' ? [] : [`~${prefix}`];
};

/**
 * The channel patterns the declaration expects for one user, in the server's own echo form.
 *
 * ★ CHANNELS COME FROM THE DECLARATION, NEVER `allchannels` (round-3 finding 2). `seat` gets
 *   `&<name>:*`, `service` gets `&<keyPrefix>` (ct100#117's litellm line: `&${namespace}:*`),
 *   `monitor` gets none. The old unconditional `allchannels` on `service` widened LiteLLM from
 *   `&hf-litellm:*` to every channel; the "mirrors the CT100 template" comment next to it was
 *   never true. A server normalises `&*` back to `allchannels` internally and echoes `&*`.
 */
export const declaredChannels = (user: ValkeyAclUser): ReadonlyArray<string> => {
  if (user.profile === 'monitor') return [];
  const prefix = effectiveKeyPrefix(user);
  return (user.channelPatterns ?? [prefix]).map((pattern) => `&${pattern}`);
};
