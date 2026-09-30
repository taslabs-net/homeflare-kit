/**
 * `Postgres.Role` props and attributes, and the plan-time checks that run before any statement.
 *
 * ⛔ EVERY ASSERTED PROP TRACES TO A REAL `CREATE ROLE` / `ALTER ROLE` OPTION AND A REAL CATALOG
 *   COLUMN. `role-provenance.test.ts` parses the committed fixtures (`create_role.sgml`,
 *   `alter_role.sgml`, `pg_authid.h`, `pg_auth_members.h`) and fails if that mapping breaks.
 * ⛔ NO PASSWORD VALUE AS A PROP (S25). `password` is declared as
 *   `{ fromEnv: 'PG_SEAT_WIDGET_PASSWORD' }`, never a string. The name lives in state; the value
 *   is resolved from the deploying process's environment at reconcile time, wrapped in
 *   `Redacted`, and quoted into the one statement that needs it.
 * ★ UNLIKE `Postgres.Database`, THIS FAMILY IS ALTER-CAPABLE: `LOGIN`/`NOLOGIN`,
 *   `INHERIT`/`NOINHERIT`, `CONNECTION LIMIT` and `VALID UNTIL` all have a safe atomic
 *   `ALTER ROLE` form (`alter_role.sgml`'s first synopsis variant), so a drifted live row is
 *   brought back to the declaration instead of refused.
 */
import type { FromEnv } from '../secrets/write-only.ts';

/** Re-exported for tests that operate on identifier byte length. */
export { POSTGRES_NAME_MAX_BYTES, nameByteRefusal, utf8ByteLength } from './database-attrs.ts';

/**
 * A declared `validUntil` must carry its own UTC designator (`Z`) or numeric offset (`+02:00`).
 *
 * ⛔ WHY A ZONE-FREE TIMESTAMP IS REFUSED AT PLAN. PostgreSQL reads `VALID UNTIL '2027-01-01'`
 *   as midnight in the SESSION's time zone; the deploying process parses the same string as UTC
 *   (ECMAScript's rule for date-only forms). The instants differ, so the value read back would
 *   never equal the declaration, and every plan would issue the same `ALTER ROLE … VALID UNTIL`
 *   forever — the exact silent loop this family refuses elsewhere. A string ECMAScript cannot
 *   parse at all reaches the same refusal; PostgreSQL would reject it too, only later and as an
 *   unclassified statement error.
 */
const VALID_UNTIL_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

export const validUntilRefusal = (
  value: string,
): { readonly reason: 'unparseable' | 'zone-free' } | undefined => {
  if (VALID_UNTIL_OFFSET.test(value)) return undefined;
  return { reason: Number.isNaN(Date.parse(value)) ? 'unparseable' : 'zone-free' };
};

/** Whether a declared `validUntil` and the live serialised value name the same instant. Both
 * sides are plan-checked parseable, so `NaN` cannot reach here. */
export const sameValidUntil = (declared: string, live: string | null): boolean =>
  live !== null && Date.parse(declared) === Date.parse(live);

/**
 * Declared properties of one role.
 *
 * `login` and `inherit` are required: the resource configures a LOGIN or NOLOGIN role with
 * INHERIT explicit, per the seat-wiring spec's group-role-per-seat shape (`NOLOGIN`, member of
 * `hf_agent`, owning its own schema). An undeclared boolean would silently adopt whatever the
 * live row already says — the opposite of idempotent.
 */
export interface PostgresRoleProps {
  /** At most 63 UTF-8 bytes — refused at plan/reconcile if larger (`PostgresRoleNameRefused`). */
  readonly name: string;
  /** `LOGIN` or `NOLOGIN` — maps to `pg_roles.rolcanlogin`. */
  readonly login: boolean;
  /** `CONNECTION LIMIT n`, `-1` for unlimited — maps to `pg_roles.rolconnlimit`. */
  readonly connectionLimit: number;
  /** `INHERIT` or `NOINHERIT` — maps to `pg_roles.rolinherit`. */
  readonly inherit: boolean;
  /**
   * `VALID UNTIL 'timestamp'` — maps to `pg_roles.rolvaliduntil`. ISO 8601 without a timezone is
   * accepted by PostgreSQL's `timestamptz` input (it is interpreted in the client's time zone);
   * an ISO 8601 string carrying `Z` is unambiguous, so the docs recommend declaring it. Omitted
   * means "leave the live value alone" — the resource never clears an expiry it did not declare.
   */
  readonly validUntil?: string;
  /**
   * The roles this role is a member of (`GRANT parent TO this`). Backed by `pg_auth_members`.
   * Compared when declared; omitted leaves live memberships untouched. Empty array means
   * "ensure none".
   */
  readonly memberOf?: readonly string[];
  /**
   * `PASSWORD '...'` by the NAME of the environment variable holding it. Omitted means "leave
   * the live password alone" (and `NOLOGIN` group roles need none). Required once, before the
   * first create that declares it, and on every later write while the variable is set — a value
   * the environment stopped providing is never guessed.
   */
  readonly password?: FromEnv;
}

/** Live attributes, read back after every reconcile. `passwordValue` is NEVER stored (S25). */
export interface PostgresRoleAttributes {
  readonly name: string;
  readonly oid: number;
  readonly login: boolean;
  readonly connectionLimit: number;
  readonly inherit: boolean;
  /** ISO 8601 (`...Z`), server-side serialised; `null` when the live row has no expiry. */
  readonly validUntil: string | null;
  /**
   * Parent role names, sorted. Empty array when the role is a member of nothing. Null means
   * "memberships were not declared on this resource", so the field is not asserted.
   */
  readonly memberOf: readonly string[] | null;
  /**
   * A seal of the last password value written, or `''` if none was ever written (`seal()` from
   * `secrets/write-only.ts`). Lets a later reconcile notice a rotated environment variable
   * without the state store holding anything a reader could replay.
   */
  readonly passwordSeal: string;
}
