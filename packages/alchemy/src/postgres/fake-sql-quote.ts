/**
 * The inverse of `quoteIdent` / `quoteStringLiteral` (`database-sql.ts`), for the fakes that
 * parse their own generated statement text. One place, so the database and role fakes can never
 * disagree about what a doubled quote means.
 */
export const unquoteIdent = (raw: string): string => raw.replace(/""/g, '"');

export const unquoteLiteral = (raw: string): string =>
  raw.replace(/\\\\/g, '\\').replace(/''/g, "'");

/** Decode one entire literal, rejecting trailing SQL. PG18 §4.1.2.2: only E strings
 * interpret backslashes when standard_conforming_strings is on. Deliberately tiny:
 * accepts generated escapes, not the server's octal/hex/unicode grammar. */
export const parseLiteral = (text: string, standardConformingStrings = true): string => {
  const escape = text.startsWith("E'") || !standardConformingStrings;
  const start = text.startsWith("E'") ? 2 : 1;
  if (text[start - 1] !== "'") throw new Error('fake-sql: expected literal');
  let value = '';
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") {
      if (text[i + 1] === "'") {
        value += "'";
        i += 1;
      } else if (i === text.length - 1) return value;
      else throw new Error('fake-sql: trailing SQL after literal');
    } else if (char === '\\' && escape) {
      i += 1;
      const next = text[i];
      if (next === undefined) throw new Error('fake-sql: unterminated escape');
      value +=
        ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[next] ?? next;
    } else value += char;
  }
  throw new Error('fake-sql: unterminated literal');
};
