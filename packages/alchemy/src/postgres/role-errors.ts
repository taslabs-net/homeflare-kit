/**
 * `Postgres.Role` failures as typed tags (S21).
 *
 * ⛔ NONE OF THESE IS A STATUS-CODE OR MESSAGE MATCH. Every one is raised from a fact the
 *   provider already checked (a byte count, a live catalog row, a missing environment variable,
 *   a vanished create) — never from sniffing a driver error's text. A `DROP ROLE` that the
 *   server refuses (the role still owns objects, `2B01 dependent_objects_still_exist`) surfaces
 *   as the `SqlError` the client raised, unclassified by this family.
 */
import * as Data from 'effect/Data';

/**
 * A role name would be silently truncated by the server (`NAMEDATALEN` 64, so 63 UTF-8 bytes is
 * the last one that survives whole) — refused at plan, before any statement runs.
 *
 * ⚠️ Same hazard as `PostgresDatabaseNameRefused`: `truncate_identifier` clips at 63 bytes and
 * emits only a NOTICE. A create would succeed against the truncated name; the next plan would
 * look for the original name and find nothing, looping forever.
 */
export class PostgresRoleNameRefused extends Data.TaggedError('PostgresRoleNameRefused')<{
  readonly name: string;
  readonly byteLength: number;
  readonly limit: number;
}> {
  override get message(): string {
    return (
      `Postgres.Role "${this.name}": ${String(this.byteLength)} UTF-8 bytes, over the ` +
      `${String(this.limit)}-byte limit (NAMEDATALEN 64, minus the terminator). PostgreSQL would ` +
      'accept the CREATE and silently truncate the name with only a NOTICE, so this plan refuses ' +
      'it instead of creating a role no later read will ever find again.'
    );
  }
}

/** A logical id's `name` changed. A role's name is its identity; this resource never replaces via
 * `DROP` then `CREATE` — role memberships, grants and owned objects would be lost, and the
 * seat-wiring shape depends on the group-role name staying stable. `ALTER ROLE … RENAME TO`
 * exists in PostgreSQL; this family does not drive it, so a rename is refused at plan and the
 * new name is declared as its own logical id. */
export class PostgresRoleRenameRefused extends Data.TaggedError('PostgresRoleRenameRefused')<{
  readonly from: string;
  readonly to: string;
}> {
  override get message(): string {
    return (
      `Postgres.Role: the declared name changed from "${this.from}" to "${this.to}". A ` +
      'rename is refused at plan — this provider never replaces a role (that is DROP then ' +
      'CREATE, which loses memberships, grants and ownerships). Declare a new logical id for ' +
      'the new name, and remove the old one once its objects have moved.'
    );
  }
}

/** The password prop names an environment variable that is unset or empty at reconcile time, on a
 * write that must send one (a create that declares it, or any reconcile while the variable is
 * set). Never a guess: a group role left with a stale or empty password is exactly the
 * unauthenticated path the refusal exists to prevent. */
export class PostgresRolePasswordEnvUnsetError extends Data.TaggedError(
  'PostgresRolePasswordEnvUnsetError',
)<{
  readonly role: string;
  readonly variable: string;
}> {
  override get message(): string {
    return (
      `Postgres.Role "${this.role}": password.fromEnv "${this.variable}" is unset or empty ` +
      'in the deploying process, but this create requires a password.'
    );
  }
}

/** The declared `validUntil` is not a timestamp this family can compare: ECMAScript cannot parse
 * it at all, or it names no time zone. Refused at plan, before any statement — see
 * `role-attrs.ts#validUntilRefusal` for the churn loop this prevents. */
export class PostgresRoleValidUntilRefused extends Data.TaggedError(
  'PostgresRoleValidUntilRefused',
)<{
  readonly role: string;
  readonly value: string;
  readonly reason: 'unparseable' | 'zone-free';
}> {
  override get message(): string {
    return (
      `Postgres.Role "${this.role}": validUntil "${this.value}" is ${this.reason === 'unparseable' ? 'not a timestamp this kit can parse' : 'missing its UTC designator or numeric offset'}. ` +
      'Declare an explicit-zone ISO 8601 value such as "2027-01-01T00:00:00Z" — PostgreSQL would ' +
      'read a zone-free value in the session time zone while the plan compares UTC, and the two ' +
      'would never agree.'
    );
  }
}

/** `CREATE ROLE` raised no error, but the immediate re-read still finds nothing (S10/S20).
 * Measured to have no real trigger in a correctly speaking client; still a typed failure the
 * caller can see and retry, never a defect that crashes the engine. */
export class PostgresRoleCreateVanished extends Data.TaggedError('PostgresRoleCreateVanished')<{
  readonly role: string;
}> {
  override get message(): string {
    return (
      `Postgres.Role "${this.role}": CREATE ROLE raised no error, but the role is still ` +
      'absent on the immediate re-read. Re-plan — this is not a state this provider expects to reach.'
    );
  }
}

export type PostgresRoleError =
  | PostgresRoleNameRefused
  | PostgresRoleRenameRefused
  | PostgresRoleValidUntilRefused
  | PostgresRolePasswordEnvUnsetError
  | PostgresRoleCreateVanished;
