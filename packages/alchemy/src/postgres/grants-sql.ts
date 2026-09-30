/**
 * The statements `Postgres.Grants` ever ISSUES: ten builders, one statement each. The READ
 * half lives in `grants-read.ts` (it goes through `aclexplode`, never `aclitem` text); this
 * file is writes only. Every free-form value is bound (`$n`) or `quoteIdent`ed, never
 * hand-concatenated.
 *
 * ⛔ NO `CASCADE`, EVER: a revoke whose grantee re-granted onward is refused by the server
 *   rather than silently removing a third role's grant (the declaration does not name that
 *   role). The refusal surfaces as the driver's own statement error; the operator adds the
 *   grant to their declaration or revokes by hand.
 * ⛔ A GRANT LIST UNDER ONE `WITH GRANT OPTION` OPTION CLAUSE GRANTS THE OPTION TO EVERY
 *   LISTED PRIVILEGE. The builders therefore throw on a MIXED list (some words marked `*`,
 *   some not): `planRepair` splits the words with `splitGrantWords` and issues two grants —
 *   the split is the only shape that cannot over-grant beyond the declaration.
 */
import { quoteIdent } from './database-sql.ts';

const splitParts = (
  words: ReadonlyArray<string>,
): { readonly parts: ReadonlyArray<string>; readonly anyOption: boolean } => {
  const parts: string[] = [];
  let optionCount = 0;
  for (const word of words) {
    if (word.endsWith('*')) optionCount += 1;
    parts.push(word.endsWith('*') ? word.slice(0, -1) : word);
  }
  if (optionCount > 0 && optionCount < words.length) {
    throw new Error(
      `grants-sql: a mixed grant-option list cannot be one GRANT statement: ${words.join(', ')}` +
        ' — split it with splitGrantWords first (one option clause grants the option to every word)',
    );
  }
  return { parts, anyOption: optionCount > 0 };
};

const optionClause = (anyOption: boolean): string => (anyOption ? ' WITH GRANT OPTION' : '');

/** `GRANT` on one relation. `words` are already validated lowercase declared words; a
 * trailing `*` (WITH GRANT OPTION) becomes the option clause — the list must share one
 * flag (see the header). */
export const grantTableSql = (
  schema: string,
  table: string,
  role: string,
  words: ReadonlyArray<string>,
): string => {
  const { parts, anyOption } = splitParts(words);
  return `GRANT ${parts.join(', ')} ON ${quoteIdent(schema)}.${quoteIdent(table)} TO ${quoteIdent(role)}${optionClause(anyOption)}`;
};

/** `GRANT` on one column of one relation. */
export const grantColumnSql = (
  schema: string,
  table: string,
  column: string,
  role: string,
  words: ReadonlyArray<string>,
): string => {
  const { parts, anyOption } = splitParts(words);
  return `GRANT ${parts.join(', ')} (${quoteIdent(column)}) ON ${quoteIdent(schema)}.${quoteIdent(table)} TO ${quoteIdent(role)}${optionClause(anyOption)}`;
};

/** `GRANT` on the schema itself (`USAGE` / `CREATE`). */
export const grantSchemaSql = (
  schema: string,
  role: string,
  words: ReadonlyArray<string>,
): string => {
  const { parts, anyOption } = splitParts(words);
  return `GRANT ${parts.join(', ')} ON SCHEMA ${quoteIdent(schema)} TO ${quoteIdent(role)}${optionClause(anyOption)}`;
};

/** `ALTER DEFAULT PRIVILEGES FOR ROLE <creator> IN SCHEMA <schema> GRANT … ON TABLES TO
 * <role>` — the creator is `forRole`, the grantee is always the resource's role. */
export const grantDefaultSql = (
  schema: string,
  forRole: string,
  role: string,
  words: ReadonlyArray<string>,
): string => {
  const { parts, anyOption } = splitParts(words);
  return `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(forRole)} IN SCHEMA ${quoteIdent(schema)} GRANT ${parts.join(', ')} ON TABLES TO ${quoteIdent(role)}${optionClause(anyOption)}`;
};

/** `REVOKE ALL ON <schema>.<table> FROM <role>` — the repair's first half for a drifted
 * table. Revoking a privilege the grantee does not hold is a silent no-op on the server, so
 * the repair's revoke is idempotent; what the server REFUSES is a revoke that would have to
 * cascade (see the header). */
export const revokeTableSql = (schema: string, table: string, role: string): string =>
  `REVOKE ALL ON ${quoteIdent(schema)}.${quoteIdent(table)} FROM ${quoteIdent(role)}`;

/** `REVOKE ALL (<column>) ON <schema>.<table> FROM <role>` — same reasoning as
 * {@link revokeTableSql}. */
export const revokeColumnSql = (
  schema: string,
  table: string,
  column: string,
  role: string,
): string =>
  `REVOKE ALL (${quoteIdent(column)}) ON ${quoteIdent(schema)}.${quoteIdent(table)} FROM ${quoteIdent(role)}`;

/** `REVOKE ALL ON SCHEMA <schema> FROM <role>` — the repair's first half for the schema's
 * own privileges. */
export const revokeSchemaSql = (schema: string, role: string): string =>
  `REVOKE ALL ON SCHEMA ${quoteIdent(schema)} FROM ${quoteIdent(role)}`;

/** `ALTER DEFAULT PRIVILEGES FOR ROLE <creator> IN SCHEMA <schema> REVOKE ALL ON TABLES
 * FROM <role>`. */
export const revokeDefaultSql = (schema: string, forRole: string, role: string): string =>
  `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(forRole)} IN SCHEMA ${quoteIdent(schema)} REVOKE ALL ON TABLES FROM ${quoteIdent(role)}`;

/** `REVOKE ALL ON SCHEMA <schema> FROM PUBLIC` — the `revokeFromPublic` half for the
 * schema itself. PUBLIC is the bare keyword (`aclitem`'s empty grantee, acl.h@REL_18_6
 * `ACL_ID_PUBLIC`). */
export const revokePublicSchemaSql = (schema: string): string =>
  `REVOKE ALL ON SCHEMA ${quoteIdent(schema)} FROM PUBLIC`;

/** `REVOKE ALL ON ALL TABLES IN SCHEMA <schema> FROM PUBLIC` — the `revokeFromPublic` half
 * for every relation in the schema, including PUBLIC's column privileges on those relations
 * (revoke.sgml@REL_18_6: revoking table privileges also revokes the corresponding column
 * privileges). */
export const revokePublicTablesSql = (schema: string): string =>
  `REVOKE ALL ON ALL TABLES IN SCHEMA ${quoteIdent(schema)} FROM PUBLIC`;
