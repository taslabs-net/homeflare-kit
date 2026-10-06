/**
 * Tests that read a changed file, which `bun test --changed` cannot see.
 *
 * 🔴 MEASURED 2026-10-06, bun 1.4.0: `bun test --changed=<base> extra.test.ts` prints
 *   "no test files are affected" and runs nothing. Positional paths do not union with
 *   `--changed`. A second `bun test` on the same lane runs the extra files, and `&&`
 *   still fails the push when either half fails.
 * ⛔ A NON-MODULE WITH NO MATCH STAYS ON `--changed`. That is today's behaviour: the
 *   push is not widened to the whole suite, and it is not failed for lack of a reader.
 *   `package.json` and the other full-suite names stay in `changesEverything`.
 */
import { join } from 'node:path';
import { type Lane } from './push-plan.ts';
import { fail, probe } from './report.ts';

/** What to add to a scoped test lane, and how many changed paths those files name. */
export type ReadSelection = {
  readonly files: readonly string[];
  readonly matchedPaths: number;
};

const MODULE_EXT = /\.(?:ts|tsx|js|mjs)$/;
const TEST_FILE = /\.test\.(?:ts|js)$/;

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

/** Tracked `*.test.ts` / `*.test.js`, never `node_modules`. `undefined` when git cannot list. */
async function trackedTests(root: string): Promise<readonly string[] | undefined> {
  const listed = await probe(['git', '-C', root, 'ls-files', '-z']);
  if (listed.code !== 0) return undefined;
  return listed.stdout.split('\0').filter((path) => {
    if (path === '' || !TEST_FILE.test(path)) return false;
    return !path.split('/').includes('node_modules');
  });
}

/**
 * Test files whose source names a changed non-module path.
 * No non-module paths, or none of them named: an empty selection, not a wider run.
 */
export async function testsReading(
  root: string,
  changed: readonly string[],
): Promise<ReadSelection> {
  const wanted = changed
    .filter((path) => !isModulePath(path))
    .map((path) => ({ path, needles: needlesFor(path) }))
    .filter((item) => item.needles.length > 0);
  if (wanted.length === 0) return { files: [], matchedPaths: 0 };

  const tests = await trackedTests(root);
  if (tests === undefined) {
    fail(
      'pre-push',
      'could not list tracked test files, so a test that reads a changed file might be skipped',
      'run git ls-files in this repository, then push again',
    );
  }

  const files: string[] = [];
  const matched = new Set<string>();
  for (const file of tests) {
    let text: string;
    try {
      text = await Bun.file(join(root, file)).text();
    } catch {
      fail(
        'pre-push',
        `could not read ${file}, so a test that reads a changed file might be skipped`,
        'restore that test file, then push again',
      );
    }
    let used = false;
    for (const item of wanted) {
      if (!item.needles.some((needle) => text.includes(needle))) continue;
      matched.add(item.path);
      used = true;
    }
    if (used) files.push(file);
  }
  return { files, matchedPaths: matched.size };
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
 */
export function withReadTests(lanes: readonly Lane[], files: readonly string[]): ReadLanePlan {
  if (files.length === 0) return { lanes, added: false };
  const extra = `bun test ${files.map(shQuote).join(' ')}`;
  let added = false;
  const next = lanes.map((lane) => {
    if (added || lane.kind !== 'test' || !lane.scoped) return lane;
    added = true;
    return { ...lane, command: `${lane.command} && ${extra}` };
  });
  return { lanes: added ? next : lanes, added };
}
