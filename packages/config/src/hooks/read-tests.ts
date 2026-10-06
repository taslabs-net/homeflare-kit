/**
 * Tests that read a changed file, which `bun test --changed` cannot see.
 *
 * 🔴 MEASURED 2026-10-06, bun 1.4.0: `bun test --changed=<base> extra.test.ts` prints
 *   "no test files are affected" and runs nothing. Positional paths do not union with
 *   `--changed`. A second `bun test` on the same lane runs the extra files, and `&&`
 *   still fails the push when either half fails.
 * 🔴 MEASURED 2026-10-06, bun 1.4.0: shell-quoting a selected path named
 *   `--test-name-pattern=splits|unused.test.ts` still leaves a bun option. One test
 *   named `splits` passed, the failing reader was filtered, and the lane exited 0.
 *   Every selected path is passed as `./<path>` so a leading dash stays a path.
 * ⛔ AN EDIT OF A NON-MODULE WITH NO MATCH STAYS ON `--changed`. An ADD (`git diff
 *   --diff-filter=A`) that no test names runs the suite in full: a directory listing
 *   or a short name is not a string in any test. `package.json` and the other
 *   full-suite names stay in `changesEverything`.
 */
import { dirname, isAbsolute, join, relative } from 'node:path';
import { type Lane } from './push-plan.ts';
import { fail, probe } from './report.ts';

/** What to add to a scoped test lane, and how many changed paths those files name. */
export type ReadSelection = {
  readonly files: readonly string[];
  readonly matchedPaths: number;
  /** Added non-module paths no test names. Non-zero: the caller runs the suite in full. */
  readonly unnamedAdds: number;
};

const MODULE_EXT = /\.(?:ts|tsx|js|mjs)$/;
const TEST_FILE = /\.test\.(?:ts|js)$/;
const MODULE_EXTS = ['.ts', '.tsx', '.js', '.mjs'] as const;

/** A `.ts` / `.tsx` / `.js` / `.mjs` file. Bun's import graph already covers these. */
function isModulePath(path: string): boolean {
  return MODULE_EXT.test(path);
}

/**
 * `README.md`, `index.*`, and `package.json` are too common to match by file name.
 * `package.json` also runs the suite in full — see `changesEverything`.
 */
function isGenericName(name: string): boolean {
  return name === 'README.md' || name === 'package.json' || name.startsWith('index.');
}

/**
 * Strings a test's source must contain: the repo-relative path, each ancestor
 * directory at least two segments deep (`src/hf-rag-vendor/`), and the file name
 * when it is specific enough to search for on its own.
 */
function needlesFor(path: string): readonly string[] {
  if (path === '') return [];
  const parts = path.split('/').filter((part) => part !== '');
  const name = parts.at(-1) ?? path;
  const needles: string[] = [path];
  for (let depth = parts.length - 1; depth >= 2; depth -= 1) {
    needles.push(`${parts.slice(0, depth).join('/')}/`);
  }
  if (name.length >= 8 && !isGenericName(name) && !needles.includes(name)) needles.push(name);
  return needles;
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Repo-relative `./` and `../` specifiers. Package and `node:` imports are not followed. */
function relativeSpecs(text: string): readonly string[] {
  const specs: string[] = [];
  for (const re of [/\bfrom\s+['"](\.[^'"]+)['"]/g, /\bimport\s+['"](\.[^'"]+)['"]/g]) {
    for (const match of text.matchAll(re)) {
      const spec = match[1];
      if (spec !== undefined) specs.push(spec);
    }
  }
  return specs;
}

/** A module path inside `root`, or undefined when the specifier leaves the repo. */
function inRepo(root: string, abs: string): string | undefined {
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  const path = rel.split('\\').join('/');
  if (path.split('/').includes('node_modules')) return undefined;
  if (!MODULE_EXT.test(path)) return undefined;
  return path;
}

/**
 * One hop, and only a file that exists. Extensionless specifiers try the module
 * extensions; a query or a hash is not a file we can read.
 */
async function resolveImport(
  root: string,
  fromFile: string,
  spec: string,
): Promise<string | undefined> {
  if (spec.includes('?') || spec.includes('#')) return undefined;
  const base = join(root, dirname(fromFile), spec);
  const candidates = MODULE_EXT.test(spec) ? [base] : MODULE_EXTS.map((ext) => `${base}${ext}`);
  for (const abs of candidates) {
    const path = inRepo(root, abs);
    if (path === undefined || !(await Bun.file(abs).exists())) continue;
    return path;
  }
  return undefined;
}

/** Tracked `*.test.ts` / `*.test.js`, never `node_modules`. `undefined` when git cannot list. */
async function trackedTests(root: string): Promise<readonly string[] | undefined> {
  const listed = await probe(['git', '-C', root, 'ls-files', '-z']);
  if (listed.code !== 0) return undefined;
  return listed.stdout.split('\0').filter((path) => {
    if (path === '' || !TEST_FILE.test(path)) return false;
    return !path.split('/').includes('node_modules');
  });
}

/** Paths added between `base` and `HEAD` (`git diff --diff-filter=A`). Fails closed. */
async function addedInRange(root: string, base: string): Promise<ReadonlySet<string>> {
  const listed = await probe([
    'git',
    '-C',
    root,
    'diff',
    '--name-only',
    '--diff-filter=A',
    '-z',
    base,
    'HEAD',
  ]);
  if (listed.code !== 0) {
    fail(
      'pre-push',
      'could not list added files, so a new file a test finds only by directory might be skipped',
      'run git diff --diff-filter=A in this repository, then push again',
    );
  }
  return new Set(listed.stdout.split('\0').filter((path) => path !== ''));
}

async function sourceText(root: string, path: string, cache: Map<string, string>): Promise<string> {
  const hit = cache.get(path);
  if (hit !== undefined) return hit;
  try {
    const text = await Bun.file(join(root, path)).text();
    cache.set(path, text);
    return text;
  } catch {
    fail(
      'pre-push',
      `could not read ${path}, so a test that reads a changed file might be skipped`,
      'restore that file, then push again',
    );
  }
}

/**
 * Text of repo-relative modules this test imports directly. Not their imports:
 * one hop, so a comment rewording in the test cannot hide a path the module names.
 */
async function importedSources(
  root: string,
  testFile: string,
  text: string,
  cache: Map<string, string>,
): Promise<readonly string[]> {
  const texts: string[] = [];
  for (const spec of relativeSpecs(text)) {
    const path = await resolveImport(root, testFile, spec);
    if (path === undefined || path === testFile) continue;
    texts.push(await sourceText(root, path, cache));
  }
  return texts;
}

/**
 * Test files whose source — or a module they import directly — names a changed
 * non-module path. No non-module paths: an empty selection. An added path that
 * no test names is counted in `unnamedAdds` so the caller can run the suite in full.
 */
export async function testsReading(
  root: string,
  changed: readonly string[],
  base: string,
): Promise<ReadSelection> {
  const wanted = changed
    .filter((path) => !isModulePath(path))
    .map((path) => ({ path, needles: needlesFor(path) }))
    .filter((item) => item.needles.length > 0);
  if (wanted.length === 0) return { files: [], matchedPaths: 0, unnamedAdds: 0 };

  const tests = await trackedTests(root);
  if (tests === undefined) {
    fail(
      'pre-push',
      'could not list tracked test files, so a test that reads a changed file might be skipped',
      'run git ls-files in this repository, then push again',
    );
  }
  const added = await addedInRange(root, base);
  const cache = new Map<string, string>();
  const files: string[] = [];
  const matched = new Set<string>();
  for (const file of tests) {
    const text = await sourceText(root, file, cache);
    const haystack = [text, ...(await importedSources(root, file, text, cache))];
    let used = false;
    for (const item of wanted) {
      if (!item.needles.some((needle) => haystack.some((part) => part.includes(needle)))) continue;
      matched.add(item.path);
      used = true;
    }
    if (used) files.push(file);
  }
  let unnamedAdds = 0;
  for (const item of wanted) {
    if (!matched.has(item.path) && added.has(item.path)) unnamedAdds += 1;
  }
  return { files, matchedPaths: matched.size, unnamedAdds };
}

/** The lanes to run, and whether a scoped `bun test` gained the extra files. */
export type ReadLanePlan = {
  readonly lanes: readonly Lane[];
  readonly added: boolean;
};

/**
 * Append one `bun test <files>` to the first scoped test lane.
 * ⛔ ONE APPEND, NOT ONE PER LANE. Two `bun test` lanes would otherwise run the same
 *   extra files twice. An unscoped lane already runs the suite in full, so `added`
 *   stays false and the caller does not claim files were added.
 * 🔴 `./` IS INSIDE THE QUOTES. Measured 2026-10-06: quoting alone does not stop bun
 *   from reading a leading dash as an option.
 */
export function withReadTests(lanes: readonly Lane[], files: readonly string[]): ReadLanePlan {
  if (files.length === 0) return { lanes, added: false };
  const extra = `bun test ${files.map((file) => shQuote(`./${file}`)).join(' ')}`;
  let added = false;
  const next = lanes.map((lane) => {
    if (added || lane.kind !== 'test' || !lane.scoped) return lane;
    added = true;
    return { ...lane, command: `${lane.command} && ${extra}` };
  });
  return { lanes: added ? next : lanes, added };
}
