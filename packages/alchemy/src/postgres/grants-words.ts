/**
 * The vocabulary primitives of `Postgres.Grants`: the aclexplode row as it crosses the
 * wire, the word it encodes, the word set a read answers — and the `relkind` vocabulary
 * the PUBLIC-tables clear is scoped to. Pure — no client, no `Effect` — so the reads
 * (`grants-read.ts`), the plans (`grants-plan.ts`, `grants-diff.ts`) and the test fake
 * (`fake-grants-read.ts`) all share one definition of what a word is.
 */
/** One aclexplode row as it crosses the wire: lowercase declared word with `*` appended
 * when the privilege carries WITH GRANT OPTION (`is_grantable`). */
export interface AclRow {
  readonly public: boolean;
  readonly privilege: string;
  readonly grantable: boolean;
}

/** Lowercase word, `*` appended when the privilege carries WITH GRANT OPTION. */
export const encodeWord = (row: {
  readonly privilege: string;
  readonly grantable: boolean;
}): string => `${row.privilege.toLowerCase()}${row.grantable ? '*' : ''}`;

/** Union of one grantee's distinct words over all its aclexplode rows, sorted — two reads
 * of the same state must compare equal, which the re-run-is-a-no-op rule needs. */
export const wordsOf = (rows: ReadonlyArray<AclRow>, wantPublic: boolean): ReadonlyArray<string> =>
  [...new Set(rows.filter((row) => row.public === wantPublic).map(encodeWord))].sort();

/** The relkinds `GRANT/REVOKE … ON ALL TABLES IN SCHEMA` covers — every pg_class relation
 * class except sequences (`S`), composite types (`c`) and indexes (`i`), per
 * `revoke.sgml@REL_18_6` ("ALL TABLES also affects views and foreign tables") and measured
 * on PG 18.6. */
export const PUBLIC_REVOCABLE_RELKINDS: ReadonlyArray<string> = ['r', 'v', 'm', 'f', 'p'];

export const relkindIsPublicRevocable = (relkind: string): boolean =>
  PUBLIC_REVOCABLE_RELKINDS.includes(relkind);
