import { join } from 'node:path';
import { probe } from './report.ts';

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
 * 1-based lines whose string or template contains a host temp path.
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
    const prefix = ['/private/tmp', '/var/tmp', '/tmp'].find((path) =>
      text.startsWith(path, index),
    );
    if (prefix === undefined) return false;
    const before = index === 0 ? '' : (text[index - 1] ?? '');
    const after = text[index + prefix.length] ?? '';
    return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after);
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (ch === '\n') {
      line += 1;
      escaped = false;
      // ⚠️ A quote inside a regex can look like a string opener. Do not let it turn
      //   comments on later lines into literals; only templates stay open across lines.
      if (mode === 'line' || mode === 'sq' || mode === 'dq') mode = 'code';
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

/**
 * `/tmp`, `/private/tmp`, and `/var/tmp` path literals in tracked test files under `root`.
 * A `tmp-allow: <reason>` comment on the same line or the line above is an allowlist entry.
 * `changed` limits a push to its changed paths; without a known range, scan all tracked tests.
 */
export async function problemsInTmpLiterals(
  root: string,
  changed?: readonly string[],
): Promise<readonly string[]> {
  // ⛔ A directory walk enters ignored worktrees and vendor clones. Only the index tells
  //   us which files this repository owns; NUL separators preserve unusual filenames.
  const listed = await probe(['git', '-C', root, 'ls-files', '-z'], true);
  if (listed.code !== 0)
    throw new Error('could not enumerate tracked test files with git ls-files');
  const selected = changed === undefined ? undefined : new Set(changed);
  const files = listed.stdout
    .split('\0')
    .filter((rel) => isTestFile(rel) && (selected === undefined || selected.has(rel)));
  const problems: string[] = [];
  for (const rel of files) {
    let text: string;
    try {
      text = await Bun.file(join(root, rel)).text();
    } catch (error) {
      // ⚠️ The index includes unstaged deletions and paths absent in sparse checkouts.
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    const lines = text.split('\n');
    for (const lineNo of literalLines(text)) {
      const line = lines[lineNo - 1] ?? '';
      const prev = lineNo > 1 ? (lines[lineNo - 2] ?? '') : '';
      if (allowReason(line) !== undefined || allowReason(prev) !== undefined) continue;
      problems.push(
        `${rel}:${String(lineNo)}: host temp path literal (/tmp, /private/tmp, /var/tmp) escapes the TMPDIR guard — use os.tmpdir(), or add a \`tmp-allow: <reason>\` comment`,
      );
    }
  }
  return problems;
}
