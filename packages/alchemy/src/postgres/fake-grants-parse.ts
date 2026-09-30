/**
 * The statement parser half of the `Postgres.Grants` test fake: it understands EXACTLY the
 * ten statement shapes `grants-sql.ts` generates — `quoteIdent`'s quoting, one clause
 * order — and nothing else, so a quoting or clause-order bug in a builder trips the parser
 * instead of hiding behind lenient matching. The server-model half (entries, grant/revoke
 * semantics, the aclexplode-shaped reads) lives in `fake-grants-sql.ts`.
 *
 * ⛔ IT PARSES ITS OWN OUTPUT, NOT SQL IN GENERAL (`fake-sql.ts`'s own rule): every value
 *   the builders `quoteIdent` is read back through the same `"…""…"` unquoting, and every
 *   statement ends in exactly one of the accepted shapes or the parse refuses.
 */
export interface AclObject {
  readonly schema: string;
  readonly table?: string;
  readonly column?: string;
  readonly defaultFor?: string;
}

/** One parsed write statement, already reduced to what the model applies. */
export interface ParsedWrite {
  readonly kind: 'grant' | 'revoke';
  /** `REVOKE ALL ON ALL TABLES IN SCHEMA … FROM PUBLIC` — applied per known relation. */
  readonly allTables?: boolean;
  readonly object: AclObject;
  /** `'PUBLIC'` or a role name. */
  readonly grantee: string;
  /** Declared privilege words, lowercase, no `*` marks (the option clause carries the flag). */
  readonly words: ReadonlyArray<string>;
  readonly option: boolean;
}

const unquote = (raw: string): string => raw.replace(/""/g, '"');

const IDENT = String.raw`"((?:[^"]|"")*)"`;
const WORDS = String.raw`([a-z]+(?:, [a-z]+)*)`;
const GRANTEE = String.raw`(?:"((?:[^"]|"")*)"|PUBLIC)`;
const OPTION = String.raw`(?:( WITH GRANT OPTION))?`;

interface Pattern {
  readonly re: RegExp;
  readonly parse: (m: RegExpExecArray) => Omit<ParsedWrite, 'kind'>;
}

const role = (raw: string | undefined): string => (raw === undefined ? 'PUBLIC' : unquote(raw));

/** Ordered: a column grant/revoke must be tried before the table form its text starts like,
 * and the two default-privileges forms before the plain ones they begin as. */
const PATTERNS: ReadonlyArray<Pattern & { readonly kind: 'grant' | 'revoke' }> = [
  {
    kind: 'grant',
    re: new RegExp(
      `^ALTER DEFAULT PRIVILEGES FOR ROLE ${IDENT} IN SCHEMA ${IDENT} GRANT ${WORDS} ON TABLES TO ${GRANTEE}${OPTION}$`,
    ),
    parse: (m) => ({
      object: { schema: unquote(m[2] as string), defaultFor: unquote(m[1] as string) },
      grantee: role(m[4] as string | undefined),
      words: (m[3] as string).split(', '),
      option: m[5] !== undefined,
    }),
  },
  {
    kind: 'revoke',
    re: new RegExp(
      `^ALTER DEFAULT PRIVILEGES FOR ROLE ${IDENT} IN SCHEMA ${IDENT} REVOKE ALL ON TABLES FROM ${GRANTEE}$`,
    ),
    parse: (m) => ({
      object: { schema: unquote(m[2] as string), defaultFor: unquote(m[1] as string) },
      grantee: role(m[3] as string | undefined),
      words: [],
      option: false,
    }),
  },
  {
    kind: 'grant',
    re: new RegExp(`^GRANT ${WORDS} \\(${IDENT}\\) ON ${IDENT}\\.${IDENT} TO ${GRANTEE}${OPTION}$`),
    parse: (m) => ({
      object: {
        schema: unquote(m[3] as string),
        table: unquote(m[4] as string),
        column: unquote(m[2] as string),
      },
      grantee: role(m[5] as string | undefined),
      words: (m[1] as string).split(', '),
      option: m[6] !== undefined,
    }),
  },
  {
    kind: 'revoke',
    re: new RegExp(`^REVOKE ALL \\(${IDENT}\\) ON ${IDENT}\\.${IDENT} FROM ${GRANTEE}$`),
    parse: (m) => ({
      object: {
        schema: unquote(m[2] as string),
        table: unquote(m[3] as string),
        column: unquote(m[1] as string),
      },
      grantee: role(m[4] as string | undefined),
      words: [],
      option: false,
    }),
  },
  {
    kind: 'grant',
    re: new RegExp(`^GRANT ${WORDS} ON SCHEMA ${IDENT} TO ${GRANTEE}${OPTION}$`),
    parse: (m) => ({
      object: { schema: unquote(m[2] as string) },
      grantee: role(m[3] as string | undefined),
      words: (m[1] as string).split(', '),
      option: m[4] !== undefined,
    }),
  },
  {
    kind: 'grant',
    re: new RegExp(`^GRANT ${WORDS} ON ${IDENT}\\.${IDENT} TO ${GRANTEE}${OPTION}$`),
    parse: (m) => ({
      object: { schema: unquote(m[2] as string), table: unquote(m[3] as string) },
      grantee: role(m[4] as string | undefined),
      words: (m[1] as string).split(', '),
      option: m[5] !== undefined,
    }),
  },
  {
    kind: 'revoke',
    re: new RegExp(`^REVOKE ALL ON ${IDENT}\\.${IDENT} FROM ${GRANTEE}$`),
    parse: (m) => ({
      object: { schema: unquote(m[1] as string), table: unquote(m[2] as string) },
      grantee: role(m[3] as string | undefined),
      words: [],
      option: false,
    }),
  },
  {
    kind: 'revoke',
    re: new RegExp(`^REVOKE ALL ON SCHEMA ${IDENT} FROM ${GRANTEE}$`),
    parse: (m) => ({
      object: { schema: unquote(m[1] as string) },
      grantee: role(m[2] as string | undefined),
      words: [],
      option: false,
    }),
  },
  {
    kind: 'revoke',
    re: new RegExp(`^REVOKE ALL ON ALL TABLES IN SCHEMA ${IDENT} FROM ${GRANTEE}$`),
    parse: (m) => ({
      allTables: true,
      object: { schema: unquote(m[1] as string) },
      grantee: role(m[2] as string | undefined),
      words: [],
      option: false,
    }),
  },
];

/** `undefined` when the text is no statement this family generates — the model refuses it
 * rather than guessing (a parse miss on a GRANT-shaped text means a builder regressed). */
export const parseGrantStatement = (text: string): ParsedWrite | undefined => {
  for (const pattern of PATTERNS) {
    const m = pattern.re.exec(text);
    if (m === null) continue;
    return { kind: pattern.kind, ...pattern.parse(m) };
  }
  return undefined;
};
