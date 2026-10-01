/**
 * The inverse of `quoteIdent` / `quoteStringLiteral` (`database-sql.ts`), for the fakes that
 * parse their own generated statement text. One place, so the database and role fakes can never
 * disagree about what a doubled quote means.
 */
export const unquoteIdent = (raw: string): string => raw.replace(/""/g, '"');

export const unquoteLiteral = (raw: string): string => raw.replace(/''/g, "'");
