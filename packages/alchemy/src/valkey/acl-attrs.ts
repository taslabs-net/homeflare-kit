/**
 * `Valkey.AclFile` props attributes.
 *
 * ⛔ PASSWORDS BY REFERENCE, NEVER IN STATE. Each ACL user's password is a `{ fromEnv }` reference
 *   (see `secrets/write-only.ts`); the value exists only in the deploying process's memory and on
 *   the wire to the server. State stores an scrypt SEAL, so a later plan can check "is the value
 *   in my environment the one I wrote" without holding anything a reader could send to Valkey.
 * ★ THE KEY PREFIX IS THE ISOLATION. `~<name>:*` limits a seat to its own keyspace; a seat
 *   gets `WRITE` only where its job writes. The deny list (`-scan -randomkey -dbsize -pubsub`)
 *   closes keyspace/channel enumeration, matching `homeflare-ct100/src/valkey-acl.ts`.
 * ★ THE COMMAND ALLOW-LIST IS A FIXED PROFILE, NOT A PROP. `profile: 'seat'` carries the seat
 *   allow-list with pub/sub restricted to the user's own channel; `profile: 'service'` carries
 *   `+@all -@dangerous` with channels from the declaration, for one consumer that owns the whole
 *   instance (LiteLLM's cache user on `:6380`); `profile: 'monitor'` carries the key-less,
 *   channel-less `redis_exporter` rule set (ct100#117). It is deliberately no free-form rules
 *   prop: a declaration could widen itself, which would let a seat request `FLUSHALL` or
 *   `ACL SETUSER` and defeat the isolation the resource enforces.
 */
import type { FromEnv } from '../secrets/write-only.ts';

/** The fixed rule set a user carries. */
export type ValkeyAclProfile = 'seat' | 'service' | 'monitor';

/** One ACL user, limited to a key prefix and a fixed command allow-list. */
export interface ValkeyAclUser {
  /** The username (matches the seat name). */
  readonly name: string;
  /**
   * The key pattern the user may touch, sent as `~<keyPrefix>`. Optional: a `seat` defaults to
   * exactly `<name>:*` — CT100's template (`homeflare-ct100/src/valkey-acl.ts`) — and a
   * `service` defaults to `*` (the whole instance; LiteLLM's cache user declares `hf-litellm:*`).
   * A `monitor` must not carry one — it is key-less (`resetkeys`), so a declared prefix is
   * refused (`ValkeyAclMonitorKeyPrefix`).
   */
  readonly keyPrefix?: string;
  /** Channel globs without `&`. Defaults to the key prefix. Seats must keep `<name>:*`;
   * monitors must have none. Services may declare a separate channel namespace. */
  readonly channelPatterns?: ReadonlyArray<string>;
  /** The fixed allow-list this user carries. */
  readonly profile: ValkeyAclProfile;
  /** The password, by reference. */
  readonly password: FromEnv;
}

/** The ACL users of one instance. */
export interface ValkeyAclFileProps {
  /** The instance the ACL file belongs to — matches the `Valkey.Instance` name. */
  readonly instance: string;
  /** The ACL users, keyed by username. */
  readonly users: Readonly<Record<string, ValkeyAclUser>>;
  /**
   * ★ EXCLUSIVE OWNERSHIP IS OPT-IN, OFF BY DEFAULT (round-3 finding 1). `true` means this
   *   declaration is the ONLY writer of the instance's ACL: reconcile `ACL DELUSER`s every user
   *   it did not declare. `false` — the default — leaves undeclared users (CT100's key-less
   *   `monitor` for `redis_exporter`, an operator's debugging user) untouched and reports them
   *   with a warning, because reconcile cannot know what a template renderer or a human still
   *   needs. The measured incident: reconcile deleted CT100's `monitor` and closed the
   *   exporter's connection.
   */
  readonly exclusive?: boolean;
}

/** One user's live ACL fields, parsed from `ACL LIST`. Every field except `passwordSeal`
 * comes from the server's own echo (measured semantics in `acl-form.ts`'s header), so `diff`
 * can see exactly what `reconcile`'s read-back asserts — a user widened or disabled outside the
 * stack must show up as an update, never as a silent no-op. */
export interface ValkeyAclUserAttributes {
  readonly name: string;
  /** The first live key pattern without its `~`, or `''` when the user has none. */
  readonly keyPrefix: string;
  /** Any live key pattern beyond the first, `~`-stripped. This family declares exactly one
   * pattern per user, so a non-empty list means the ACL was widened outside the stack. */
  readonly extraKeyPatterns: ReadonlyArray<string>;
  /** The live channel patterns as the server echoes them (`&claude:*`; `&*` is all channels;
   * an empty list — the bare `resetchannels` marker — means no channel access at all). */
  readonly channelPatterns: ReadonlyArray<string>;
  /** The profile the live rule set was recognised as — `unrecognized` when the rules match
   * neither fixed profile (something outside the stack edited them). */
  readonly profile: ValkeyAclProfile | 'unrecognized';
  /** The live `on` flag: a user this family declared but the host disabled is drift. */
  readonly on: boolean;
  /** The live `nopass` flag: a passwordless user authenticates as nobody, which bypasses the
   * per-seat password boundary, so it always drifts for a user this family manages. */
  readonly nopass: boolean;
  /** Any password token (`#<hash>`, `>pw`, `<pw`) present. Never the value. */
  readonly hasPassword: boolean;
  /** The scrypt seal of the password the family last wrote, threaded from state. */
  readonly passwordSeal: string;
}

/** The live ACL attributes of one instance. */
export interface ValkeyAclFileAttributes {
  readonly instance: string;
  readonly users: Readonly<Record<string, ValkeyAclUserAttributes>>;
}
