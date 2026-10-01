/**
 * `Postgres.Grants`' failures as typed tags, following the `Postgres.Schema` pattern (S21).
 *
 * ⛔ NONE OF THESE IS A STATUS-CODE OR MESSAGE MATCH. Every one is raised by this family's
 *   own code from a fact it already checked (a byte count, a vocabulary, a live catalog
 *   row, a re-planned statement list) — never from sniffing a driver error's text. The one
 *   driver error this family EXPECTS (a grant naming a relation or column that does not
 *   exist, a revoke that would need CASCADE) propagates as the raw `SqlError` on purpose:
 *   the docs page names the cases.
 */
import * as Data from 'effect/Data';

/** A declared privilege word is outside the vocabulary its prop draws from — e.g. `TRUNCATE`
 * on a column grant (table-wide only at REL_18_6) or `EXECUTE` anywhere (this family never
 * leaves the table/schema/column words). */
export class PostgresGrantsPrivilegeRefused extends Data.TaggedError(
  'PostgresGrantsPrivilegeRefused',
)<{
  readonly prop: string;
  readonly word: string;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: "${this.prop}" declares "${this.word}", which is not in the vocabulary ` +
      'PostgreSQL 18 grants on that object class (see grants-attrs.ts for the three sets, traced ' +
      'to acl.h at REL_18_6). Column grants take select/insert/update/references only — TRUNCATE, ' +
      'TRIGGER and MAINTAIN are table-wide.'
    );
  }
}

/** A declared name would be silently truncated (same rule as `PostgresDatabaseNameRefused`):
 * roles, schemas, tables and columns are all `NameData`. */
export class PostgresGrantsNameRefused extends Data.TaggedError('PostgresGrantsNameRefused')<{
  readonly name: string;
  readonly byteLength: number;
  readonly limit: number;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: the name "${this.name}" is ${String(this.byteLength)} UTF-8 bytes, over the ` +
      `${String(this.limit)}-byte limit (NAMEDATALEN 64, minus the terminator). PostgreSQL would ` +
      'accept the statement and silently truncate the name with only a NOTICE, so this plan refuses ' +
      'it instead of granting on an object no later read will ever find again.'
    );
  }
}

/** Two declaration entries name the same object (one table twice, one column pair twice,
 * one `forRole` twice) — silently merging them would hide which entry the operator meant.
 * The same refusal fires when one word list declares a base word both plain and
 * `*`-marked: the server keeps ONE aclitem per grantee per grantor, so those two states
 * can never both hold and the set would never converge. */
export class PostgresGrantsDuplicateObject extends Data.TaggedError(
  'PostgresGrantsDuplicateObject',
)<{
  readonly prop: string;
  readonly name: string;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: "${this.prop}" declares "${this.name}" twice. Merge the entries into one — ` +
      'the declaration must state each object at most once, and each privilege word in exactly one ' +
      'form: plain, or WITH GRANT OPTION (`select` and `select*` cannot both hold, the server keeps ' +
      'one aclitem per grantee per grantor).'
    );
  }
}

/** A logical id's `role`, `database` or `schema` changed. Those three name WHAT the grant set
 * is about; changing one is a different grant set, not an edit of this one. */
export class PostgresGrantsRetargetRefused extends Data.TaggedError(
  'PostgresGrantsRetargetRefused',
)<{
  readonly prop: string;
  readonly from: string;
  readonly to: string;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: the declared ${this.prop} changed from "${this.from}" to "${this.to}". A ` +
      'retarget is refused at plan — declare a new logical id for the new target and delete the old ' +
      'one (its retain policy keeps the grants until a destroy revokes them).'
    );
  }
}

/** The declaration's `database` differs from the database the provider's connection actually
 * opened. Every statement this family issues runs in the CONNECTION's database; granting in
 * the wrong one would succeed silently and read back as drift forever. */
export class PostgresGrantsDatabaseMismatch extends Data.TaggedError(
  'PostgresGrantsDatabaseMismatch',
)<{
  readonly declared: string;
  readonly connected: string;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: the declaration names database "${this.declared}" but the provider's ` +
      `connection opened "${this.connected}". Every GRANT/REVOKE runs in the connected database — ` +
      'fix the declaration or point the providers layer at the database the grants belong to.'
    );
  }
}

/** `reconcile` refuses to repair into a schema the catalogs do not have: grants belong to an
 * existing container (`Postgres.Schema` creates one; this family never creates anything). */
export class PostgresGrantsSchemaMissing extends Data.TaggedError('PostgresGrantsSchemaMissing')<{
  readonly schema: string;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: schema "${this.schema}" is not in pg_namespace. Grants are written into a ` +
      'schema that already exists — declare a Postgres.Schema (or create it by hand) before the ' +
      'grant set that scopes to it.'
    );
  }
}

/** The grantee role, or a default-privileges `forRole` creator, is not in `pg_roles` —
 * checked before any statement runs, the way `Postgres.Schema` checks its `AUTHORIZATION`
 * owner. */
export class PostgresGrantsRoleMissing extends Data.TaggedError('PostgresGrantsRoleMissing')<{
  readonly role: string;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: role "${this.role}" is not in pg_roles. GRANT and ALTER DEFAULT PRIVILEGES ` +
      'would fail against it — create the role (a group role per seat, membership owned by a human) ' +
      'before declaring its grants.'
    );
  }
}

/** A declared table is not a relation in the schema. The resource refuses before any
 * statement, because a GRANT/REVOKE on a missing relation would surface as a raw 42P01
 * after earlier statements had already landed — and the state row would stay `creating`. */
export class PostgresGrantsTableMissing extends Data.TaggedError('PostgresGrantsTableMissing')<{
  readonly schema: string;
  readonly table: string;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: table "${this.schema}"."${this.table}" does not exist. The declaration ` +
      'names a relation before it is created; create the table (or fix the name) before granting.'
    );
  }
}

/** A declared column is not an attribute of its table. The resource refuses before any
 * statement, matching the table-missing guard. */
export class PostgresGrantsColumnMissing extends Data.TaggedError('PostgresGrantsColumnMissing')<{
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: column "${this.column}" of "${this.schema}"."${this.table}" does not ` +
      'exist. Declare the column (or fix its name) before granting on it.'
    );
  }
}

/** The repair ran clean, but the immediate re-read (S10) still plans statements: a grant this
 * family cannot revoke survived (its grantor still holds the grant option, or the executing
 * role is neither the owner nor that grantor). Re-planning forever would hide it as silent
 * drift, so it fails loud with the surviving statements. */
export class PostgresGrantsRepairRefused extends Data.TaggedError('PostgresGrantsRepairRefused')<{
  readonly schema: string;
  readonly role: string;
  readonly remaining: ReadonlyArray<string>;
}> {
  override get message(): string {
    return (
      `Postgres.Grants: the repair on schema "${this.schema}" for role "${this.role}" re-read as ` +
      `still drifted; these statements would run again: ${this.remaining.join(' ; ')}. A grant made ` +
      'by another role survives this resource\u2019s REVOKE (only its grantor or the object\u2019s ' +
      'owner can revoke it) — revoke it as that grantor or the owner, or declare the privilege so ' +
      'the set matches.'
    );
  }
}

export type PostgresGrantsError =
  | PostgresGrantsPrivilegeRefused
  | PostgresGrantsNameRefused
  | PostgresGrantsDuplicateObject
  | PostgresGrantsRetargetRefused
  | PostgresGrantsDatabaseMismatch
  | PostgresGrantsSchemaMissing
  | PostgresGrantsRoleMissing
  | PostgresGrantsTableMissing
  | PostgresGrantsColumnMissing
  | PostgresGrantsRepairRefused;
