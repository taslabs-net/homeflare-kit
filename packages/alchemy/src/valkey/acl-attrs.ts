/**
 * `Valkey.AclFile` props and attributes.
 *
 * ⛔ PASSWORDS BY REFERENCE, NEVER IN STATE. Each ACL user's password is a `{ fromEnv }` reference
 *   (see `secrets/write-only.ts`); the value exists only in the deploying process's memory and on
 *   the wire to the server. State stores a scrypt SEAL, so a later plan can check "is the value in
 *   my environment the one I wrote" without holding anything a reader could send to Valkey.
 * ★ THE KEY PREFIX IS THE ISOLATION. `~<name>:*` limits each seat to its own keyspace; a seat
 *   gets `WRITE` only where its job writes. The deny list (`-scan -randomkey -dbsize -pubsub`)
 *   closes keyspace/channel enumeration, matching `homeflare-ct100/src/valkey-acl.ts`.
 * ★ THE COMMAND ALLOW-LIST IS A FIXED PROFILE, NOT A PROP. `profile: 'seat'` carries the seat
 *   allow-list and pub/sub restricted to the user's own channel; `profile: 'service'` carries
 *   `+@all -@dangerous` and all channels, for the one consumer that owns a whole instance
 *   (LiteLLM's cache user on `:6380` mirrors `homeflare-ct100/src/valkey-acl.ts`'s template).
 *   There is deliberately no free-form rules prop: a declaration that could widen itself would let
 *   a seat request `FLUSHALL` or `ACL SETUSER` and defeat the isolation this resource enforces.
 */
import type { FromEnv } from '../secrets/write-only.ts';

/** Which fixed rule set a user carries. */
export type ValkeyAclProfile = 'seat' | 'service';

/** One ACL user, limited to a key prefix and a fixed command allow-list. */
export interface ValkeyAclUser {
  /** The username (matches the seat name). */
  readonly name: string;
  /** The key pattern this user may touch, sent as `~<keyPrefix>` — CT100's consuming template
   * binds each seat to `~<seat>:*` (`homeflare-ct100/src/valkey-acl.ts`); `*` is for the one
   * user that owns a whole instance (LiteLLM's cache user). */
  readonly keyPrefix: string;
  /** The fixed command allow-list the user carries (see the header; never a free-form list). */
  readonly profile: ValkeyAclProfile;
  /** The password, by the name of the environment variable holding it — never the value. */
  readonly password: FromEnv;
}

/** Declared properties of one instance's ACL file. */
export interface ValkeyAclFileProps {
  /** The instance the ACL file belongs to — matches the `Valkey.Instance` name. */
  readonly instance: string;
  /** The ACL users, keyed by username. Every non-default user the instance has must be here. */
  readonly users: Readonly<Record<string, ValkeyAclUser>>;
}

/** A single user's live ACL fields, parsed from `ACL LIST`. Every field except `passwordSeal`
 * comes from the server's own echo (measured semantics in `acl-form.ts`'s header), so `diff`
 * can see exactly what `reconcile`'s read-back asserts — a user widened or disabled outside
 * this stack must show up as an update, never as a silent no-op. */
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
   * neither fixed profile (something outside this stack edited them). */
  readonly profile: ValkeyAclProfile | 'unrecognized';
  /** The live `on` flag: a user this family declared but the host disabled is drift. */
  readonly on: boolean;
  /** The live `nopass` flag: a passwordless user authenticates as nobody and bypasses the
   * per-seat password boundary, so it is always drift for a user this family manages. */
  readonly nopass: boolean;
  /** Any password token (`#<hash>`, `>pw`, `<pw`) is present. Never the value. */
  readonly hasPassword: boolean;
  /** The scrypt seal of the last password written, or `''` when none was written yet. */
  readonly passwordSeal: string;
}

/** Live attributes read back after reconcile — the whole ACL, keyed by username. Never holds a
 * password value, only seals. */
export interface ValkeyAclFileAttributes {
  readonly instance: string;
  readonly users: Readonly<Record<string, ValkeyAclUserAttributes>>;
}
