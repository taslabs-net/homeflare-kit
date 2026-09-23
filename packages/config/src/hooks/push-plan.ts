/**
 * What `pre-push` runs: the repository's own `check`, with the expensive lanes narrowed to
 * the push or left to CI.
 *
 * ★ IT READS `check` RATHER THAN NAMING TOOLS. `check` is the command CI runs, so the lanes
 *   here are that command's lanes — a repository that adds a step to `check` gets it in the
 *   hook with no change to this package. Hard-coding `tsc` and `bun test` would drift from
 *   whichever repository added a step first, and certify a push CI rejects.
 * ★ THREE THINGS CHANGE, AND ONLY THREE:
 *   1. every `bun test …` becomes `bun test … --changed=<base>` — Bun's own import-graph
 *      answer to "which test files can these changed files reach" (bun 1.4, measured
 *      2026-09-23: 11 changed files ran 2 of 246 test files in homeflare-kit);
 *   2. `build` and `smoke` scripts are skipped — minutes in a big workspace, and CI runs
 *      both on every pull request;
 *   3. everything else (lint, types, a `--check` script) runs exactly as `check` spells it.
 *      They are seconds, whole-program by nature, and deterministic.
 * ⛔ PURE. No git, no filesystem, no process: the whole contract is a function of the
 *   scripts table and the base, so the estate's real `check` shapes are pinned by a table
 *   test (tests/hooks-push-plan.test.ts) instead of by a live push.
 */

/** One step of the pre-push run. */
export type Lane =
  /** Run `command` through `sh -c` at the repository root. */
  | { readonly kind: 'run'; readonly label: string; readonly command: string }
  /** A test runner; `scoped` says whether it was narrowed to the push. */
  | {
      readonly kind: 'test';
      readonly label: string;
      readonly command: string;
      readonly scoped: boolean;
    }
  /** Not run here, and why. */
  | { readonly kind: 'skip'; readonly label: string; readonly why: string };

/**
 * ⚠️ BY NAME, AND ONLY THESE. A build in homeflare-kit is every package; a smoke test packs
 *   and installs tarballs. Both are CI jobs on every pull request, and neither says anything
 *   a type check and the reachable tests did not already say about a typical push.
 */
const LEFT_TO_CI = /^(build|smoke)(:|$)/;

/** Recursion guard: a script that names itself, directly or through another, stops here. */
const MAX_DEPTH = 8;

/**
 * Split a script on top-level `&&`, or return undefined when it is anything else.
 *
 * ⛔ UNDEFINED MEANS "RUN IT WHOLE". `||`, `;`, a pipe, a redirect, a background `&` or a
 *   substitution each change what the pieces mean together, and a hook that re-plumbed them
 *   would run something the repository never wrote. Quoted text is left alone, so
 *   `--path-ignore-patterns="homeflare-*\/**"` survives intact.
 */
export function andChain(script: string): readonly string[] | undefined {
  const parts: string[] = [];
  let quote: string | undefined;
  let current = '';
  for (let i = 0; i < script.length; i++) {
    const char = script[i] ?? '';
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '&' && script[i + 1] === '&') {
      parts.push(current.trim());
      current = '';
      i += 1;
      continue;
    }
    if ('|;&<>`'.includes(char) || (char === '$' && script[i + 1] === '(')) return undefined;
    current += char;
  }
  if (quote !== undefined) return undefined;
  parts.push(current.trim());
  return parts.some((part) => part === '') ? undefined : parts;
}

/** The script a segment names: `bun run x`, `npm run x`, or `npm test`. Else undefined. */
function scriptRef(segment: string, scripts: Readonly<Record<string, string>>): string | undefined {
  const words = segment.split(/\s+/);
  if (words.length === 2 && words[0] === 'npm' && words[1] === 'test') return 'test';
  const [runner, verb, name] = words;
  if (words.length !== 3 || verb !== 'run' || name === undefined) return undefined;
  if (runner !== 'bun' && runner !== 'npm') return undefined;
  return Object.hasOwn(scripts, name) ? name : undefined;
}

/** `bun test …` — the runner, not a script called `test`. */
const isBunTest = (segment: string): boolean => /^bun\s+test(\s|$)/.test(segment);

function testLane(segment: string, base: string | undefined): Lane {
  return base === undefined
    ? { kind: 'test', label: segment, command: segment, scoped: false }
    : { kind: 'test', label: segment, command: `${segment} --changed=${base}`, scoped: true };
}

function expand(
  script: string,
  scripts: Readonly<Record<string, string>>,
  base: string | undefined,
  depth: number,
): readonly Lane[] | undefined {
  const segments = andChain(script);
  if (segments === undefined || depth > MAX_DEPTH) return undefined;
  const lanes: Lane[] = [];
  for (const segment of segments) {
    if (isBunTest(segment)) {
      lanes.push(testLane(segment, base));
      continue;
    }
    const name = scriptRef(segment, scripts);
    if (name === undefined) {
      lanes.push({ kind: 'run', label: segment, command: segment });
      continue;
    }
    if (LEFT_TO_CI.test(name)) {
      lanes.push({ kind: 'skip', label: segment, why: 'CI runs it on every pull request' });
      continue;
    }
    const inner = expand(scripts[name] ?? '', scripts, base, depth + 1);
    if (inner !== undefined && inner.some((lane) => lane.kind !== 'run')) {
      // Something inside needs narrowing or skipping: open the script up.
      lanes.push(...inner);
    } else if (/^test(:|$)/.test(name)) {
      // ⚠️ A TEST SCRIPT WITH NO `bun test` IN IT RUNS IN FULL, AND SAYS SO — vitest with
      //   coverage thresholds (a narrowed run would fail them), `node --test`, anything piped.
      //   Narrowing it would mean rewriting a command this package does not understand.
      lanes.push({ kind: 'test', label: segment, command: segment, scoped: false });
    } else {
      // ★ A SCRIPT WITH NOTHING TO NARROW RUNS UNDER ITS OWN NAME. `bun run lint` keeps
      //   Bun's PATH handling and reads the way the repository wrote it.
      lanes.push({ kind: 'run', label: segment, command: segment });
    }
  }
  return lanes;
}

/**
 * The lanes `pre-push` runs for this `scripts` table.
 *
 * `base` is the commit the push is measured from; `undefined` runs every test lane in full
 * (an unknown base, or a push that changes what every test runs on).
 * ⚠️ AN EMPTY LIST MEANS NO `check` SCRIPT — the caller reports that; it is not a pass.
 */
export function planLanes(
  scripts: Readonly<Record<string, string>>,
  base: string | undefined,
): readonly Lane[] {
  const check = scripts['check'];
  if (check === undefined) return [];
  // ⚠️ A `check` THAT IS NOT A PLAIN `&&` CHAIN IS RUN WHOLE, tests and all, and reported
  //   as unscoped. No estate repository has one (surveyed 2026-09-23); the fallback exists so
  //   an unusual one is checked rather than skipped.
  const whole: Lane = {
    kind: 'test',
    label: 'bun run check',
    command: 'bun run check',
    scoped: false,
  };
  return expand(check, scripts, base, 0) ?? [whole];
}
