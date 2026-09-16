/**
 * House oxfmt is a COPY — the format has no `extends`.
 *
 * ⛔ IDENTITY WAS THE WRONG GATE. Measured 2026-09-16: a Worker/TanStack app that
 *   copied the preset verbatim would format vendor OpenAPI YAML, generated trees,
 *   TanStack routeTree files and openapi.json, and rewrite 154 files to singleQuote.
 *   Generated OpenAPI is an artefact; a quote flip there is a false diff, not style.
 *
 * ★ Extra `ignorePatterns` are therefore allowed. House style keys are not. Dropping
 *   a house ignore is still drift — that is how generated files get rewritten.
 */

export type OxfmtConfig = {
  readonly printWidth?: number;
  readonly useTabs?: boolean;
  readonly singleQuote?: boolean;
  readonly semi?: boolean;
  readonly ignorePatterns?: readonly string[];
  readonly [key: string]: unknown;
};

const STYLE_KEYS = ['printWidth', 'useTabs', 'singleQuote', 'semi'] as const;

/**
 * Problems in a project's `.oxfmtrc.json` against the house preset.
 * Empty means the copy still carries house style, and at least the house ignores.
 */
export function problemsInOxfmt(preset: OxfmtConfig, theirs: OxfmtConfig): readonly string[] {
  const problems: string[] = [];

  for (const key of STYLE_KEYS) {
    if (theirs[key] !== preset[key]) {
      problems.push(
        `.oxfmtrc.json: ${key} differs from @homeflare/config — re-copy it, or say why it differs`,
      );
    }
  }

  const local = new Set(theirs.ignorePatterns ?? []);
  for (const pattern of preset.ignorePatterns ?? []) {
    if (!local.has(pattern)) {
      problems.push(
        `.oxfmtrc.json: missing house ignore ${pattern} — generated files would be rewritten`,
      );
    }
  }

  return problems;
}
