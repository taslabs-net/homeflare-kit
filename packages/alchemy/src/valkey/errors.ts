/**
 * `Valkey` family's failures as typed tags (S21).
 *
 * ⛔ NONE OF THESE IS A STATUS-CODE OR MESSAGE MATCH. They are raised by this family's own code
 *   from facts it already checked — missing env vars, mismatched live state, failed read-back —
 *   never from sniffing a server error's text. Socket/protocol errors use their own tags in
 *   `transport.ts`.
 */
import * as Data from 'effect/Data';

/** The live instance does not match an asserted property. Like `Postgres.DatabaseDrift`, this
 * family asserts properties at create and refuses drift rather than silently issuing a
 * reconfiguration that could drop state. */
export class ValkeyInstanceDrift extends Data.TaggedError('ValkeyInstanceDrift')<{
  readonly instance: string;
  readonly prop: string;
  readonly declared: unknown;
  readonly live: unknown;
}> {
  override get message(): string {
    return (
      `Valkey.Instance "${this.instance}": ${this.prop} is declared as ` +
      `${JSON.stringify(this.declared)} but the live instance has ${JSON.stringify(this.live)}. ` +
      'Update the declaration to match the live value, or change it by hand and re-plan.'
    );
  }
}

/** `Valkey.Instance` found the instance unreachable or refused authentication when reading it.
 * `host` is optional because it is the connection layer's value (`connection.ts`), never a prop
 * this resource holds — a reconcile that only knows its own declaration names the port. */
export class ValkeyInstanceUnreachable extends Data.TaggedError('ValkeyInstanceUnreachable')<{
  readonly instance: string;
  readonly host?: string;
  readonly port: number;
}> {
  override get message(): string {
    return (
      `Valkey.Instance "${this.instance}" at ${this.host === undefined ? '' : `${this.host}:`}` +
      `${String(this.port)}: could not verify the instance. Check that the Quadlet container is ` +
      'running and the ACL/password is correct.'
    );
  }
}

/** An ACL LIST line could not be parsed. Neither the message nor error data retain the
 * raw line: error serialization must not expose its password hash. */
export class ValkeyAclParseError extends Data.TaggedError('ValkeyAclParseError')<{
  // No raw ACL data.
}> {
  override get message(): string {
    return (
      'Valkey.AclFile: cannot parse an ACL LIST line. The line is withheld from this message ' +
      'because it can carry a password hash.'
    );
  }
}

/** A declared ACL user is missing a referenced password; a user with no password can authenticate
 * as nobody, which would bypass isolation. */
export class ValkeyAclPasswordMissing extends Data.TaggedError('ValkeyAclPasswordMissing')<{
  readonly instance: string;
  readonly user: string;
  readonly variable: string;
}> {
  override get message(): string {
    return (
      `Valkey.AclFile "${this.instance}": ACL user "${this.user}" references environment ` +
      `variable ${this.variable}, which is missing or empty at call time.`
    );
  }
}

/** The stack's own connection password is a `{ fromEnv }` reference that resolved to nothing at
 * call time. Distinct from `ValkeyInstanceUnreachable` (nothing answered on the wire) and from
 * `ValkeyAclPasswordMissing` (a DECLARED ACL user's password): this one is the credential the
 * stack itself authenticates with to reach an instance. */
export class ValkeyAuthPasswordMissing extends Data.TaggedError('ValkeyAuthPasswordMissing')<{
  readonly username: string | undefined;
  readonly variable: string;
}> {
  override get message(): string {
    const who = this.username === undefined ? '' : ` as "${this.username}"`;
    return (
      `Valkey connection${who}: password environment variable ${this.variable} is missing or ` +
      'empty at call time. Render the secret into the deploying process environment and re-plan.'
    );
  }
}

/** The live ACL after a reconcile does not match the declaration on read-back — the write was lost
 * or a concurrent mutator changed it before we could verify. */
export class ValkeyAclReadbackFailed extends Data.TaggedError('ValkeyAclReadbackFailed')<{
  readonly instance: string;
  readonly user: string;
}> {
  override get message(): string {
    return (
      `Valkey.AclFile "${this.instance}": ACL reconciliation for "${this.user}" reported success, ` +
      'but readback contradicts the declared rules or removal. Re-plan.'
    );
  }
}

/** A `seat`-profile user's key prefix escapes its own keyspace. The seat profile exists to pin
 * each seat to keys beginning with its own name (`~<name>:…`); `keyPrefix` goes on the wire as
 * `~<keyPrefix>`, so `*` is every key and `grok:*` is another seat's. Refused before any write —
 * a `service` user is the profile that owns a whole instance. */
export class ValkeyAclSeatKeyPrefix extends Data.TaggedError('ValkeyAclSeatKeyPrefix')<{
  readonly instance: string;
  readonly user: string;
  readonly keyPrefix: string;
}> {
  override get message(): string {
    return (
      `Valkey.AclFile "${this.instance}": ACL user "${this.user}" declares key prefix ` +
      `"${this.keyPrefix}". A seat user is limited to "${this.user}:*"; a user that owns ` +
      'every key on the instance declares profile "service".'
    );
  }
}

/** A declaration names `default` or the connection username. `ACL SETUSER` `reset` would replace
 * the credential this kit authenticates with (`~* +@all`) with a profile that cannot run `ACL`,
 * and the next `ACL LIST` answers `NOPERM`. Refused before any write. */
export class ValkeyAclReservedUser extends Data.TaggedError('ValkeyAclReservedUser')<{
  readonly instance: string;
  readonly user: string;
}> {
  override get message(): string {
    return (
      `Valkey.AclFile "${this.instance}": refusing to manage ACL user "${this.user}". ` +
      'That name is `default` or the connection username. ACL SETUSER reset would replace the ' +
      'credential this kit authenticates with, and the next ACL LIST would answer NOPERM.'
    );
  }
}

/** A live or stored ACL user is keyed under one name but its line carries another — the parsed
 * `user` name disagrees with the record key this family stores it under. The record key is this
 * family's identity, so the mismatch means the ACL was changed by something else. */
export class ValkeyAclUserNameMismatch extends Data.TaggedError('ValkeyAclUserNameMismatch')<{
  readonly instance: string;
  readonly recordKey: string;
  readonly user: string;
}> {
  override get message(): string {
    return (
      `Valkey.AclFile "${this.instance}": ACL user "${this.user}" was found keyed under ` +
      `"${this.recordKey}". This family keys every user by its own name; re-plan or fix the ` +
      'ACL by hand on the instance.'
    );
  }
}

export type ValkeyError =
  | ValkeyInstanceDrift
  | ValkeyInstanceUnreachable
  | ValkeyAclParseError
  | ValkeyAclPasswordMissing
  | ValkeyAclReadbackFailed
  | ValkeyAclUserNameMismatch
  | ValkeyAclReservedUser
  | ValkeyAclSeatKeyPrefix
  | ValkeyAclMonitorKeyPrefix
  | ValkeyAclNameGlob
  | ValkeyAclChannelPatterns
  | ValkeyAclFileRendered
  | ValkeyAuthPasswordMissing;

/** A `monitor`-profile user was declared with a key prefix. The monitor profile exists for the
 * key-less `redis_exporter` identity (ct100#117): its rules carry `resetkeys`, and a `~` pattern
 * next to them would contradict the key-less shape the profile is fixed to. Refused before any
 * write. */
export class ValkeyAclMonitorKeyPrefix extends Data.TaggedError('ValkeyAclMonitorKeyPrefix')<{
  readonly instance: string;
  readonly user: string;
  readonly keyPrefix: string;
}> {
  override get message(): string {
    return (
      `Valkey.AclFile "${this.instance}": ACL user "${this.user}" declares profile "monitor" ` +
      `with key prefix "${this.keyPrefix}". The monitor profile is key-less (resetkeys); omit ` +
      'the keyPrefix.'
    );
  }
}

/** A username carries glob characters (`*`, `?`, `[`, `]`). Names are interpolated into key and
 * channel patterns (`~<name>:*`, `&<name>:*`), so a glob in the name would widen the patterns
 * the profile is fixed to — `seat*` would reach `seat2:*`. Refused before any write. */
export class ValkeyAclNameGlob extends Data.TaggedError('ValkeyAclNameGlob')<{
  readonly instance: string;
  readonly user: string;
  readonly chars: string;
}> {
  override get message(): string {
    return (
      `Valkey.AclFile "${this.instance}": ACL user "${this.user}" contains glob characters ` +
      `(${this.chars}). A name is interpolated into key and channel patterns, so a glob would ` +
      'widen the isolation the profile fixes. Use a glob-free name.'
    );
  }
}

/** The instance renders its ACL from a file (`--aclfile`, answered by `CONFIG GET aclfile`), so
 * the FILE is the source of truth and this family cannot manage it: the kit speaks RESP only, it
 * can neither write the file nor outlast the renderer that owns it (CT100: openbao-agent renders
 * `/etc/valkey/*-acl.conf` and mounts it read-only — a runtime `ACL SETUSER` there is reverted by
 * the next render/restart, measured 2026-09-30 as a WRONGPASS seat). Declare those users in the
 * rendering template instead, or use kit-owned runtime ACL management without a configured ACL file. */
export class ValkeyAclFileRendered extends Data.TaggedError('ValkeyAclFileRendered')<{
  readonly instance: string;
  readonly path: string;
}> {
  override get message(): string {
    return (
      `Valkey.AclFile "${this.instance}": the instance loads its ACL from "${this.path}" ` +
      '(CONFIG GET aclfile), so the file — not this family — is the source of truth. The kit ' +
      'speaks RESP only and can neither write that file nor survive the renderer that owns it; ' +
      'a runtime ACL SETUSER there is reverted on the next render or restart. Declare the users ' +
      'in the rendering template. Adoption also reconciles and is refused. ACL reads require ' +
      'ACL LIST permission, which CT100 rendered users do not have.'
    );
  }
}

/** A fixed profile cannot widen its channel boundary by declaration. */
export class ValkeyAclChannelPatterns extends Data.TaggedError('ValkeyAclChannelPatterns')<{
  readonly instance: string;
  readonly user: string;
}> {
  override get message(): string {
    return (
      `Valkey.AclFile "${this.instance}": invalid channel patterns for "${this.user}". ` +
      'Seats require <name>:*; monitors require no channels.'
    );
  }
}
