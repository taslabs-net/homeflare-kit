/**
 * One-hop imports of a tracked test, read only from inside the repository.
 *
 * ⛔ A LEXICAL PATH IS NOT CONTAINMENT. Measured 2026-10-06: `relative()` accepts
 *   `src/link.ts` while that symlink's realpath is outside the repo or under
 *   `node_modules` / `.git`, and `Bun.file().text()` follows it. Every candidate
 *   is realpath'd and refused unless the result stays inside the repo root and
 *   outside those directories.
 * ⛔ THE READ IS CAPPED. One import over 256 KiB, or 8 MiB of imports together,
 *   stops the scan. The caller runs the suite in full. The reason is a count —
 *   a path is not printed, and the over-limit body is not read.
 */
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fail } from './report.ts';

const MODULE_EXT = /\.(?:ts|tsx|js|mjs)$/;
const MODULE_EXTS = ['.ts', '.tsx', '.js', '.mjs'] as const;
const PER_FILE = 256 * 1024;
const AGGREGATE = 8 * 1024 * 1024;

/** How far an import read got when it passed the cap. Counts only. */
export type ImportReadLimit = {
  readonly files: number;
  readonly bytes: number;
};

export function importLimitNote(limit: ImportReadLimit): string {
  return `${String(limit.files)} imported file(s), ${String(limit.bytes)} bytes, over the 256 KiB / 8 MiB read limit — tests in full`;
}

export type ReadSession = {
  readonly rootReal: string;
  readonly cache: Map<string, string>;
  bytes: number;
  files: number;
};

export async function openReadSession(root: string): Promise<ReadSession | undefined> {
  try {
    return { rootReal: await realpath(root), cache: new Map(), bytes: 0, files: 0 };
  } catch {
    return undefined;
  }
}

export type Haystack =
  | { readonly kind: 'texts'; readonly texts: readonly string[] }
  | { readonly kind: 'limit'; readonly limit: ImportReadLimit };

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

function blocked(path: string): boolean {
  const parts = path.split('/');
  return parts.includes('node_modules') || parts.includes('.git');
}

/** Repo-relative path after realpath, or undefined when it leaves the repo. */
async function contained(rootReal: string, abs: string): Promise<string | undefined> {
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    return undefined;
  }
  const rel = relative(rootReal, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  const path = rel.split('\\').join('/');
  if (blocked(path) || !MODULE_EXT.test(path)) return undefined;
  return path;
}

async function resolveImport(
  rootReal: string,
  fromFile: string,
  spec: string,
): Promise<string | undefined> {
  if (spec.includes('?') || spec.includes('#')) return undefined;
  const base = join(rootReal, dirname(fromFile), spec);
  const candidates = MODULE_EXT.test(spec) ? [base] : MODULE_EXTS.map((ext) => `${base}${ext}`);
  for (const abs of candidates) {
    const path = await contained(rootReal, abs);
    if (path !== undefined) return path;
  }
  return undefined;
}

/** Read `path` only when its real path is still inside the repo. Does not return on failure. */
async function readContained(session: ReadSession, path: string): Promise<string> {
  const hit = session.cache.get(path);
  if (hit !== undefined) return hit;
  const checked = await contained(session.rootReal, join(session.rootReal, path));
  if (checked === undefined) {
    fail(
      'pre-push',
      'a file to read does not stay inside the repository, so its contents were not used',
      'remove the symlink that leaves the repository, node_modules, or .git, then push again',
    );
  }
  try {
    const text = await Bun.file(join(session.rootReal, checked)).text();
    session.cache.set(checked, text);
    return text;
  } catch {
    fail(
      'pre-push',
      `could not read ${checked}, so a test that reads a changed file might be skipped`,
      'restore that file, then push again',
    );
  }
}

function trip(session: ReadSession, size: number): ImportReadLimit {
  session.files += 1;
  session.bytes += size;
  return { files: session.files, bytes: session.bytes };
}

/**
 * The test's own text plus modules it imports directly.
 * `limit` means the scan stopped; the caller runs the suite in full.
 */
export async function haystack(session: ReadSession, testFile: string): Promise<Haystack> {
  const text = await readContained(session, testFile);
  const texts: string[] = [text];
  for (const spec of relativeSpecs(text)) {
    const path = await resolveImport(session.rootReal, testFile, spec);
    if (path === undefined || path === testFile) continue;
    const hit = session.cache.get(path);
    if (hit !== undefined) {
      texts.push(hit);
      continue;
    }
    const size = Bun.file(join(session.rootReal, path)).size;
    if (size > PER_FILE || session.bytes + size > AGGREGATE) {
      return { kind: 'limit', limit: trip(session, size) };
    }
    session.files += 1;
    session.bytes += size;
    texts.push(await readContained(session, path));
  }
  return { kind: 'texts', texts };
}
