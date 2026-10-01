/**
 * A test lane's temp directory, and the "/tmp" literals that never land in it.
 *
 * ★ BUN 1.4.0, READ FROM SOURCE. `os.tmpdir()` (`src/js/node/os.ts`) on POSIX is
 *   `TMPDIR`, then `TMP`, then `TEMP`, then `/tmp`. `fs.mkdtemp` / `mkdtempSync`
 *   (`src/js/node/fs.ts`) append six characters to the prefix the caller passed. They
 *   do not read `TMPDIR`. `mkdtemp(join(tmpdir(), 'enables-cfg-'))` therefore lands
 *   inside this guard; `mkdtemp('/tmp/enables-cfg-')` does not.
 * ⛔ A HARDCODED `/tmp` ESCAPES. The guard only sees children of the directory it set
 *   as `TMPDIR`. A test that writes a path starting with `/tmp` creates that directory
 *   on the host tmpfs, the lane still exits 0, and the inode leak this exists for
 *   continues. `problemsInTmpLiterals` fails those lines unless a comment on the same
 *   line or the line above says `tmp-allow:` and gives a reason.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLane } from './report.ts';

/** One leaked name prefix and how many top-level entries share it. */
export type LeakPrefix = {
  readonly prefix: string;
  readonly count: number;
};

/** What `runInTmp` observed. `removed` is the guard directory, already deleted. */
export type TmpRun = {
  readonly code: number;
  readonly leaks: readonly LeakPrefix[];
  readonly removed: string;
};

/** Node and GNU mktemp both put six (or more) random characters after the caller's mark. */
const RANDOM_SUFFIX = /^(.*[-.])([A-Za-z0-9]{6,})$/;

/**
 * Group leftover entry names by the stable prefix before the random suffix.
 * `enables-cfg-AbCdEf` and `enables-cfg-GhIjKl` are one prefix, `enables-cfg-`, counted twice.
 */
export function leakPrefixes(names: readonly string[]): readonly LeakPrefix[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    const prefix = RANDOM_SUFFIX.exec(name)?.[1] ?? name;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count || (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
}

/** One prefix per line: `enables-cfg- 2`. */
export function formatLeaks(leaks: readonly LeakPrefix[]): string {
  return leaks.map((leak) => `${leak.prefix} ${String(leak.count)}`).join('\n');
}

/**
 * Run `command` at `root` with `TMPDIR` set to a fresh directory.
 * Always removes that directory, including when the lane fails or throws.
 */
export async function runInTmp(command: string, root: string): Promise<TmpRun> {
  const dir = await mkdtemp(join(tmpdir(), 'hf-tmp-guard-'));
  try {
    const code = await runLane(command, root, { TMPDIR: dir });
    let names: readonly string[] = [];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (!isEnoent(error)) throw error;
    }
    return { code, leaks: leakPrefixes(names), removed: dir };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST_NAME = /\.test\.[cm]?[jt]sx?$/;

function isTestFile(rel: string): boolean {
  if (!SOURCE.test(rel)) return false;
  if (TEST_NAME.test(rel)) return true;
  return /(^|\/)(tests|__tests__)\//.test(rel);
}

/** A non-empty reason in a comment. `tmp-allow:` with nothing after it does not count. */
function allowReason(line: string): string | undefined {
  const marker = line.indexOf('tmp-allow:');
  if (marker === -1) return undefined;
  const before = line.slice(0, marker);
  const commented =
    before.includes('//') || before.includes('/*') || before.trimStart().startsWith('*');
  if (!commented) return undefined;
  const reason = line
    .slice(marker + 'tmp-allow:'.length)
    .replace(/\*\/\s*$/, '')
    .trim();
  return reason === '' ? undefined : reason;
}

/**
 * 1-based lines whose string or template contains a `/tmp` path.
 * Comments are not literals. `not/tmp` is not a path. `/temporary` is not `/tmp`.
 */
function literalLines(text: string): readonly number[] {
  const found: number[] = [];
  let line = 1;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  let expr = 0;
  let escaped = false;
  const mark = (): void => {
    if (found.at(-1) !== line) found.push(line);
  };
  const isTmp = (index: number): boolean => {
    if (!text.startsWith('/tmp', index)) return false;
    const before = index === 0 ? '' : (text[index - 1] ?? '');
    const after = text[index + 4] ?? '';
    return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after);
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (ch === '\n') {
      line += 1;
      escaped = false;
      if (mode === 'line') mode = 'code';
      continue;
    }
    if (mode === 'line') continue;
    if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        i += 1;
      }
      continue;
    }
    if (mode === 'sq' || mode === 'dq' || (mode === 'tpl' && expr === 0)) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (
        (mode === 'sq' && ch === "'") ||
        (mode === 'dq' && ch === '"') ||
        (mode === 'tpl' && ch === '`')
      ) {
        mode = 'code';
        continue;
      }
      if (mode === 'tpl' && ch === '$' && next === '{') {
        expr = 1;
        mode = 'code';
        i += 1;
        continue;
      }
      if (isTmp(i)) mark();
      continue;
    }
    if (expr > 0 && ch === '}') {
      expr -= 1;
      if (expr === 0) mode = 'tpl';
      continue;
    }
    if (expr > 0 && ch === '{') {
      expr += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      mode = 'line';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      mode = 'block';
      i += 1;
      continue;
    }
    if (ch === "'") mode = 'sq';
    else if (ch === '"') mode = 'dq';
    else if (ch === '`') mode = 'tpl';
  }
  return found;
}

async function walk(dir: string, rel: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) await walk(join(dir, entry.name), child, out);
    else if (entry.isFile() && isTestFile(child)) out.push(child);
  }
}

/**
 * `/tmp` path literals in test files under `root`.
 * A `tmp-allow: <reason>` comment on the same line or the line above is an allowlist entry.
 */
export async function problemsInTmpLiterals(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  await walk(root, '', files);
  const problems: string[] = [];
  for (const rel of files) {
    const text = await Bun.file(join(root, rel)).text();
    const lines = text.split('\n');
    for (const lineNo of literalLines(text)) {
      const line = lines[lineNo - 1] ?? '';
      const prev = lineNo > 1 ? (lines[lineNo - 2] ?? '') : '';
      if (allowReason(line) !== undefined || allowReason(prev) !== undefined) continue;
      problems.push(
        `${rel}:${String(lineNo)}: "/tmp" path literal escapes the TMPDIR guard — use os.tmpdir(), or add a \`tmp-allow: <reason>\` comment`,
      );
    }
  }
  return problems;
}
