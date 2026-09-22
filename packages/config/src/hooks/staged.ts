/**
 * What git has staged, split by what the hook may safely touch.
 *
 * ⛔ A STAGED FILE THAT ALSO HAS UNSTAGED EDITS IS OFF LIMITS. Formatting it in place
 *   and running `git add` would sweep the contributor's work-in-progress into a commit
 *   they did not ask for — the single worst thing a hook can do. Those files are
 *   reported and checked, never rewritten.
 */
import { capture } from './report.ts';

/**
 * ⚠️ `.md` IS IN THIS LIST ON PURPOSE. House `oxfmt` formats markdown, so a hook that
 *   skipped it would let an unformatted changeset through and CI would fail a commit
 *   that looked clean locally. A hook must check what CI checks or it trains distrust.
 */
const FORMATTABLE = /\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md)$/;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

export type Staged = {
  /** Fully staged and formattable — safe to rewrite and restage. */
  readonly formattable: readonly string[];
  /** The subset of `formattable` that oxlint understands. */
  readonly code: readonly string[];
  /** Staged but also dirty in the worktree — checked, never rewritten. */
  readonly partial: readonly string[];
};

async function names(args: readonly string[]): Promise<readonly string[]> {
  const out = await capture(['git', ...args]);
  return out.split('\n').filter((line) => line.length > 0);
}

/** Classify the index. Deletions are excluded — there is nothing to format in them. */
export async function staged(): Promise<Staged> {
  const indexed = await names(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  const dirty = new Set(await names(['diff', '--name-only', '--diff-filter=ACMR']));
  const candidates = indexed.filter((file) => FORMATTABLE.test(file));

  return {
    formattable: candidates.filter((file) => !dirty.has(file)),
    code: candidates.filter((file) => !dirty.has(file) && CODE.test(file)),
    partial: candidates.filter((file) => dirty.has(file)),
  };
}

/**
 * Content fingerprints, so only the files a formatter actually changed get restaged.
 *
 * ★ WHY NOT RESTAGE EVERYTHING. `git add` on an untouched file is harmless but noisy:
 *   the hook would claim it rewrote files it left alone, and a hook that overstates
 *   what it did is one nobody reads.
 */
export async function fingerprints(files: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const out = new Map<string, string>();
  for (const file of files) {
    const handle = Bun.file(file);
    if (!(await handle.exists())) continue;
    out.set(file, String(Bun.hash(await handle.arrayBuffer())));
  }
  return out;
}
