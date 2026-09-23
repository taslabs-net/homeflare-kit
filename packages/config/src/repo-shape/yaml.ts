/**
 * The smallest YAML writer that renders a job's steps, and nothing else.
 *
 * ★ NOT A YAML LIBRARY, DELIBERATELY. A general serializer would take a dependency every
 *   consumer of `@homeflare/config` inherits, and it would strip the comments — which in
 *   this house are the product. The rendered workflows are written as text with holes;
 *   only the step lists, whose shape varies per repository, go through here.
 *
 * ⚠️ Bun.YAML.stringify EXISTS (`Object.keys(Bun.YAML)` is `["parse", "stringify"]`,
 *   measured against Bun 1.4.0 on 2026-09-23) but its output does not fit these rules:
 *   (a) a multi-line `run:` comes out as a double-quoted string with `\n` escapes, e.g.
 *   `run: "echo a\necho b\n"`, not a `|` block scalar; (b) `09:00` comes out UNQUOTED,
 *   e.g. `cron: 09:00`, the YAML 1.1 sexagesimal trap the `scalar()` comment below guards
 *   against; (c) a mapping key is followed by a trailing space, e.g. `"steps: \n  - ..."`;
 *   and (d) a plain JS object has nowhere to attach a comment, so it cannot carry one. The
 *   tests parse what this writes with `Bun.YAML.parse` and compare structures, so a
 *   malformed emission fails rather than shipping.
 */
import type { JobStep } from './shape.ts';

/** Two spaces per level, the house indent and GitHub's own. */
const INDENT = '  ';

function indent(depth: number): string {
  return INDENT.repeat(depth);
}

/**
 * ⛔ QUOTE ANYTHING YAML WOULD RE-READ AS SOMETHING ELSE. `09:00` is a sexagesimal number
 *   in YAML 1.1 and `on`/`no` are booleans; an unquoted value that looks like either
 *   reaches GitHub as the wrong type, and the symptom is a schedule that never fires
 *   rather than an error.
 */
const PLAIN = /^[A-Za-z0-9_./][A-Za-z0-9_ ./@:+-]*$/;
const YAML_KEYWORD =
  /^(y|Y|n|N|on|On|ON|no|No|NO|yes|Yes|YES|true|True|TRUE|false|False|FALSE|null|Null|NULL|~)$/;

function scalar(value: string | number): string {
  if (typeof value === 'number') return String(value);
  if (value === '') return "''";
  const plain =
    PLAIN.test(value) &&
    !YAML_KEYWORD.test(value) &&
    !value.includes(': ') &&
    !value.includes(' #') &&
    // ⚠️ A LEADING DIGIT PLUS A COLON IS A YAML 1.1 SEXAGESIMAL NUMBER, not a string:
    //   `09:00` would reach GitHub as an integer, and a schedule set to an integer
    //   simply never fires. `bun run build:web` is safe because it does not start with
    //   a digit, which is why this is narrower than "contains a colon".
    !/^\d.*:/.test(value) &&
    value.trimEnd() === value;
  return plain ? value : `'${value.replaceAll("'", "''")}'`;
}

function renderMapping(
  entries: Readonly<Record<string, string | number>>,
  depth: number,
): string[] {
  return Object.entries(entries).map(([key, value]) => `${indent(depth)}${key}: ${scalar(value)}`);
}

/**
 * Trim trailing `\n` characters the way `command.replace(/\n+$/, '')` used to, but
 * linear instead of backtracking — the same pattern as `normalizeBaseUrl` in
 * `packages/distilled-netbox/src/credentials.ts`. Exported so a test can compare it
 * against the old regex directly.
 *
 * ⚠️ Linear on purpose: a `/\n+$/` regex backtracks polynomially on a long run of
 *   "\n" that is not at the end (CodeQL js/polynomial-redos), and `command` here is
 *   repository-configured step text.
 */
export function trimTrailingNewlines(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 10) end--;
  return value.slice(0, end);
}

/**
 * ★ BLOCK SCALAR FOR EVERY MULTI-LINE `run:`. A folded or quoted form would join the
 *   lines, and a shell script whose `if` and `then` end up on one line is a syntax error
 *   at job time rather than at lint time. `|` keeps them exactly as written.
 */
function renderRun(command: string, depth: number): string[] {
  const lines = trimTrailingNewlines(command).split('\n');
  if (lines.length === 1) return [`${indent(depth)}run: ${scalar(lines[0] ?? '')}`];
  return [`${indent(depth)}run: |`, ...lines.map((line) => `${indent(depth + 1)}${line}`)];
}

/** One step, as the lines of a `steps:` list item at `depth`. */
export function renderStep(step: JobStep, depth: number): string[] {
  const lines: string[] = [];
  const body =
    step.uses === undefined
      ? renderRun(step.run ?? '', depth + 1)
      : [`${indent(depth + 1)}uses: ${step.uses}`];

  // ★ `name:` then `if:` then the body, because that is the order a reader scans: what
  //   this step is, whether it runs, what it does. All three are ordinary mapping keys
  //   to GitHub, so the order is for the person reading the diff, not the parser.
  const head: string[] = [];
  if (step.name !== undefined) head.push(`${indent(depth + 1)}name: ${scalar(step.name)}`);
  if (step.if !== undefined) head.push(`${indent(depth + 1)}if: ${scalar(step.if)}`);

  // ⚠️ The first line of the item carries the dash, whichever key it turns out to be —
  //   an unnamed, unconditional step still inlines its `run:` or `uses:` after the dash
  //   and lets any block body follow at its own indent.
  const [first = '', ...rest] = [...head, ...body];
  lines.push(`${indent(depth)}- ${first.trimStart()}`, ...rest);

  if (step.with !== undefined && Object.keys(step.with).length > 0) {
    lines.push(`${indent(depth + 1)}with:`, ...renderMapping(step.with, depth + 2));
  }
  if (step.env !== undefined && Object.keys(step.env).length > 0) {
    lines.push(`${indent(depth + 1)}env:`, ...renderMapping(step.env, depth + 2));
  }
  return lines;
}

/** A whole `steps:` list, already indented for a job at `depth`. */
export function renderSteps(steps: readonly JobStep[], depth: number): string {
  return steps.flatMap((step) => renderStep(step, depth)).join('\n');
}
